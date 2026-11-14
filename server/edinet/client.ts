import { readBoundedBody } from './boundedBody.ts'
import { parseDocumentList, type ListedDocument } from './documents.ts'
import { UserFacingError } from './errors.ts'
import { DOC_ID, isRealDate } from './patterns.ts'

/** EDINET API(Version 2)。接続先はここだけに固定し、ほかのホストには決して接続しない */
export const EDINET_API_BASE = 'https://api.edinet-fsa.go.jp/api/v2'

/** 利用規約は「短時間における大量のアクセス」を禁じている。回数の基準は無いので、余裕を持って間隔を空ける */
const DEFAULT_MIN_INTERVAL_MS = 1_100
const DEFAULT_TIMEOUT_MS = 30_000
/** 制限(429)やキーの拒否(401・403)を示されたあと、送信を止める時間 */
const DEFAULT_COOLDOWN_MS = 10 * 60_000
/** 1 つの書類(CSV の zip)の大きさの上限 */
const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024
/** 制限や拒否を示す HTTP ステータス */
const BACKOFF_STATUSES: readonly number[] = [401, 403, 429]

/** 画面に出してよい、API 呼び出しの失敗。API キーや URL を含めない */
export class EdinetApiError extends UserFacingError {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'EdinetApiError'
    this.status = status
  }
}

export interface EdinetClientOptions {
  readonly apiKey: string
  readonly fetchImpl?: typeof fetch
  readonly minIntervalMs?: number
  readonly timeoutMs?: number
  readonly cooldownMs?: number
  /** 待つ関数(テストで差し替える)。signal が中止されたら、待つのをやめて例外を投げる */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly now?: () => number
}

export interface EdinetClient {
  /** 指定した日(YYYY-MM-DD)に提出された書類の一覧 */
  readonly listDocuments: (date: string, signal?: AbortSignal) => Promise<ListedDocument[]>
  /** 書類(有価証券報告書など)の CSV の zip */
  readonly downloadCsvZip: (docID: string, signal?: AbortSignal) => Promise<Uint8Array>
}

/** 中止されたら、すぐに待つのをやめる(切断したあとも、間隔の分だけ「実行中」のまま残らないように) */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function httpErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'EDINET が API キーを受け付けませんでした。キーが正しいか、再発行されていないか確認してください。'
  }
  if (status === 404) return '指定した書類が見つかりませんでした。'
  if (status === 429) return 'EDINET へのアクセスが多すぎるため、制限されました。しばらくしてからやり直してください。'
  if (status >= 500) return 'EDINET 側で問題が起きています。しばらくしてからやり直してください。'
  return `EDINET から想定外の応答がありました(HTTP ${status})。`
}

/** JSON のエラー応答(statusCode と message を持つ)の、ステータス。エラーでなければ null */
function jsonErrorStatus(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  const code = record.statusCode ?? (record.metadata as Record<string, unknown> | undefined)?.status
  // null や undefined を Number() にかけると 0 になり、ありもしない「ステータス 0 のエラー」になる
  if (code === null || code === undefined) return null
  const status = Number(code)
  return Number.isFinite(status) && status !== 200 ? status : null
}

/**
 * EDINET API のクライアント。
 * - 1 つずつ順番に、間隔を空けて送る(負荷をかけない)
 * - 制限(429)やキーの拒否(401・403)を示されたら、しばらく何も送らない(押し直しで、制限中のキーに続けて送らない)
 * - 接続先は EDINET_API_BASE だけ。リダイレクトは追わない(API キーを別のホストに送らないため)
 * - 失敗の文章に、API キーや URL を含めない
 */
export function createEdinetClient(options: EdinetClientOptions): EdinetClient {
  const {
    apiKey,
    fetchImpl = fetch,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    sleep = abortableSleep,
    now = Date.now,
  } = options
  if (apiKey.trim() === '') {
    throw new Error('API キーが設定されていません。')
  }

  let lastStarted = 0
  let cooldownUntil = 0
  let queue: Promise<unknown> = Promise.resolve()

  /** 順番待ちをして、前の要求から間隔を空けて実行する。待っている間に中止されたら、送らない */
  const schedule = <T>(task: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> => {
    const run = queue.then(async () => {
      signal?.throwIfAborted()
      const remaining = cooldownUntil - now()
      if (remaining > 0) {
        throw new EdinetApiError(
          `EDINET から制限を示されたため、送信を止めています(あと約 ${Math.ceil(remaining / 60_000)} 分)。時間をおいてからやり直してください。`,
        )
      }
      const wait = lastStarted + minIntervalMs - now()
      if (wait > 0) await sleep(wait, signal)
      signal?.throwIfAborted()
      lastStarted = now()
      return task()
    })
    // 前の要求が失敗しても、次の要求は続ける
    queue = run.catch(() => undefined)
    return run
  }

  /** 制限・拒否のステータスを受けたら、しばらく送らない */
  const noteStatus = (status: number | null): void => {
    if (status !== null && BACKOFF_STATUSES.includes(status)) {
      cooldownUntil = now() + cooldownMs
    }
  }

  const request = async (path: string, params: Record<string, string>, signal?: AbortSignal): Promise<Response> => {
    const url = new URL(`${EDINET_API_BASE}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    url.searchParams.set('Subscription-Key', apiKey)
    const timeout = AbortSignal.timeout(timeoutMs)
    try {
      return await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      })
    } catch (error) {
      if (signal?.aborted) throw error
      // 元の例外には URL(API キー入り)が入りうるので、そのまま出さない
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new EdinetApiError('EDINET からの応答が時間内にありませんでした。しばらくしてからやり直してください。')
      }
      throw new EdinetApiError('EDINET に接続できませんでした。ネットワークの状態を確認してください。')
    }
  }

  /** 応答が HTTP のエラーなら、制限を記録して例外にする */
  const checkHttp = (response: Response): void => {
    if (!response.ok) {
      noteStatus(response.status)
      throw new EdinetApiError(httpErrorMessage(response.status), response.status)
    }
  }

  return {
    listDocuments: (date, signal) => {
      if (!isRealDate(date)) {
        return Promise.reject(new EdinetApiError('日付の形式が正しくありません。'))
      }
      return schedule(async () => {
        const response = await request('/documents.json', { date, type: '2' }, signal)
        checkHttp(response)
        const body: unknown = await response.json().catch(() => null)
        const status = jsonErrorStatus(body)
        if (status !== null) {
          noteStatus(status)
          throw new EdinetApiError(httpErrorMessage(status))
        }
        return parseDocumentList(body)
      }, signal)
    },

    downloadCsvZip: (docID, signal) => {
      if (!DOC_ID.test(docID)) {
        return Promise.reject(new EdinetApiError('書類管理番号の形式が正しくありません。'))
      }
      return schedule(async () => {
        const response = await request(`/documents/${docID}`, { type: '5' }, signal)
        checkHttp(response)
        const declared = Number(response.headers.get('content-length') ?? '0')
        if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) throw new EdinetApiError('書類が大きすぎるため、取得を中止しました。')
        const type = response.headers.get('content-type') ?? ''
        if (type.includes('application/json')) {
          const status = jsonErrorStatus(await response.json().catch(() => null))
          noteStatus(status)
          throw new EdinetApiError(status === null ? 'EDINET から書類を取得できませんでした。' : httpErrorMessage(status))
        }
        let bytes: Uint8Array | null
        try {
          // 長さを名乗らない・偽る応答でも、上限を超えたところで読むのをやめる
          bytes = await readBoundedBody(response, MAX_DOCUMENT_BYTES)
        } catch {
          throw new EdinetApiError('書類の受信が途中で途切れました。しばらくしてからやり直してください。')
        }
        if (bytes === null) throw new EdinetApiError('書類が大きすぎるため、取得を中止しました。')
        // zip の先頭は "PK"。エラーの HTML などを zip として扱わない
        if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
          throw new EdinetApiError('EDINET から zip ではない応答が返りました。')
        }
        return bytes
      }, signal)
    },
  }
}

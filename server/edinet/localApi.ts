import type { IncomingMessage, ServerResponse } from 'node:http'
import { searchCompanies } from './codeList.ts'
import type { CodeListStore } from './codeListStore.ts'
import { UserFacingError } from './errors.ts'
import { DOC_ID, EDINET_CODE } from './patterns.ts'
import { findAnnualReports, getDocumentZip, type ServiceDeps } from './service.ts'

/**
 * 画面(同じオリジン)から呼ぶ、PC 内だけの API。
 * EDINET の API キーを使う処理を、ブラウザの外(この PC の中)で行うための窓口。
 * API キーは、ここから外に出さない(応答にも、ログにも含めない)。
 */
export const LOCAL_API_PREFIX = '/local-api/edinet'

export interface LocalApiDeps {
  readonly codeList: CodeListStore
  /** API キーが設定されていないときは null(検索はできるが、書類の取得はできない) */
  readonly service: ServiceDeps | null
  /** 今日(YYYY-MM-DD) */
  readonly today: () => string
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/
const MAX_QUERY_LENGTH = 100
const MIN_YEARS = 1
const MAX_YEARS = 5

/** 覚えておく書類管理番号の数の上限(1 回の探索で見つかるのは最大 5 年分なので、十分に大きい) */
const MAX_KNOWN_DOC_IDS = 500

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 利用者に見せてよい失敗の文章。想定外の例外は、中身(API キーを含みうる)を出さない */
function safeMessage(error: unknown): string {
  if (error instanceof UserFacingError) return error.message
  if (error instanceof Error && error.name === 'AbortError') return '中止しました。'
  return '取得中に問題が起きました。しばらくしてからやり直してください。'
}

/** 中継(リバースプロキシ・トンネル)を経由した要求に付くヘッダ。付いていたら、この PC の外から来た要求とみなす */
const PROXY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'via']

/** Origin ヘッダのホスト(ポートを含む)。読めなければ null */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

/**
 * この API を呼んでよい相手か。
 * - 接続元がこの PC 自身
 * - Host が localhost 系(DNS リバインディングで、外のサイトからこの PC の API を呼ばせない)
 * - 中継(トンネルなど)を経由していない(Host を書き換える中継経由の、外からの要求を断る)
 * - ブラウザなら同じオリジンからの呼び出し(Sec-Fetch-Site が same-origin。無い古いブラウザでは、Origin が Host と同じ)
 * - Origin・Referer が付いていれば、そのホストが Host と同じ(ヘッダを足さずに TCP をそのまま転送する中継経由の、外のブラウザからの要求を断る)
 * - 自前の画面だけが付けるヘッダ(他のサイトの単純な GET では付けられない)
 */
function isAllowed(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? ''
  if (!LOOPBACK.has(remote)) return false
  const host = req.headers.host ?? ''
  if (!LOCAL_HOST.test(host)) return false
  if (PROXY_HEADERS.some((name) => req.headers[name] !== undefined)) return false
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin') return false
  const origin = req.headers.origin
  if (site === undefined && origin !== undefined && originHost(origin) !== host) return false
  // Sec-Fetch-Site が same-origin でも、Origin・Referer のホストが違えば、別のホストのページからの要求
  if (origin !== undefined && originHost(origin) !== host) return false
  const referer = req.headers.referer
  if (referer !== undefined && originHost(referer) !== host) return false
  return req.headers['x-local-api'] === '1'
}

function parseYears(value: string | null): number | null {
  if (value === null) return 3
  const years = Number(value)
  return Number.isInteger(years) && years >= MIN_YEARS && years <= MAX_YEARS ? years : null
}

export function createLocalApiHandler(deps: LocalApiDeps) {
  /** 実行中の探索の数。探索は日付ごとに EDINET へ問い合わせるので、同時には 1 つだけ走らせる */
  let activeScans = 0
  /**
   * 探索で見つかった書類管理番号。/document は、ここにある番号だけダウンロードする
   * (任意の番号を次々に要求して、API キーの利用枠とディスクを使わせない)。
   */
  const knownDocIds = new Set<string>()

  const requireService = (res: ServerResponse): ServiceDeps | null => {
    if (deps.service === null) {
      sendJson(res, 503, {
        error:
          'EDINET の API キーが設定されていません。.env に EDINET_API_KEY を設定して、開発サーバーを再起動してください。',
      })
      return null
    }
    return deps.service
  }

  const companies = async (url: URL, res: ServerResponse): Promise<void> => {
    const q = (url.searchParams.get('q') ?? '').trim()
    if (q === '' || q.length > MAX_QUERY_LENGTH) {
      sendJson(res, 400, { error: '検索する企業名・証券コード・EDINET コードを入力してください。' })
      return
    }
    try {
      const list = await deps.codeList.load()
      sendJson(res, 200, { companies: searchCompanies(list, q) })
    } catch (error) {
      sendJson(res, 502, { error: safeMessage(error) })
    }
  }

  const reports = async (url: URL, res: ServerResponse): Promise<void> => {
    const service = requireService(res)
    if (service === null) return
    const edinetCode = url.searchParams.get('edinetCode') ?? ''
    const years = parseYears(url.searchParams.get('years'))
    if (!EDINET_CODE.test(edinetCode) || years === null) {
      sendJson(res, 400, { error: 'EDINET コードまたは年数の指定が正しくありません。' })
      return
    }

    if (activeScans > 0) {
      sendJson(res, 409, { error: '別の探索が実行中です。終わってから、もう一度お試しください。' })
      return
    }
    activeScans += 1
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    res.writeHead(200, { ...BASE_HEADERS, 'content-type': 'application/x-ndjson; charset=utf-8' })
    const write = (event: unknown): void => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`)
    }
    try {
      const company = (await deps.codeList.load()).find((c) => c.edinetCode === edinetCode)
      if (company === undefined) {
        write({ type: 'error', message: 'その EDINET コードの提出者が見つかりません。' })
        return
      }
      const result = await findAnnualReports(service, company, {
        years,
        today: deps.today(),
        signal: controller.signal,
        onProgress: (p) => write({ type: 'progress', ...p }),
      })
      for (const r of result.reports) {
        if (knownDocIds.size >= MAX_KNOWN_DOC_IDS) knownDocIds.clear()
        knownDocIds.add(r.docID)
      }
      write({
        type: 'done',
        reports: result.reports.map((r) => ({
          docID: r.docID,
          periodEnd: r.periodEnd,
          submitDateTime: r.submitDateTime,
          docTypeCode: r.docTypeCode,
        })),
        notFound: result.notFound,
        pending: result.pending,
      })
    } catch (error) {
      write({ type: 'error', message: safeMessage(error) })
    } finally {
      activeScans -= 1
      res.end()
    }
  }

  const document = async (docID: string, res: ServerResponse): Promise<void> => {
    // 画面が中止(切断)したら、順番待ちのダウンロードも止める
    const controller = new AbortController()
    res.on('close', () => controller.abort())
    const service = requireService(res)
    if (service === null) return
    if (!DOC_ID.test(docID)) {
      sendJson(res, 400, { error: '書類管理番号の形式が正しくありません。' })
      return
    }
    if (!knownDocIds.has(docID)) {
      sendJson(res, 404, { error: 'この書類は、先に「有価証券報告書を取得する」で探したものだけ取得できます。' })
      return
    }
    try {
      const bytes = await getDocumentZip(service, docID, controller.signal)
      res.writeHead(200, {
        ...BASE_HEADERS,
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
      })
      res.end(bytes)
    } catch (error) {
      sendJson(res, 502, { error: safeMessage(error) })
    }
  }

  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== LOCAL_API_PREFIX && !path.startsWith(`${LOCAL_API_PREFIX}/`)) {
      next()
      return
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'GET だけ使えます。' })
      return
    }
    if (!isAllowed(req)) {
      sendJson(res, 403, { error: 'このリクエストは受け付けられません。' })
      return
    }
    const url = new URL(req.url ?? '', 'http://localhost')
    const route = url.pathname.slice(LOCAL_API_PREFIX.length)
    if (route === '/status') {
      sendJson(res, 200, { configured: deps.service !== null })
    } else if (route === '/companies') {
      void companies(url, res)
    } else if (route === '/reports') {
      void reports(url, res)
    } else if (route.startsWith('/document/')) {
      void document(route.slice('/document/'.length), res)
    } else {
      sendJson(res, 404, { error: '見つかりません。' })
    }
  }
}

/**
 * 画面から、同じ PC 内の中継(開発サーバーに足した /local-api/edinet)を呼ぶ。
 * EDINET の API キーは中継だけが持ち、ここには渡らない。通信先は同じオリジンだけ(CSP の connect-src 'self' のまま)。
 */

import { cleanText } from '../../domain/import/text'
import { DEFAULT_IMPORT_LIMITS, MAX_TEXT_LENGTH } from '../../domain/limits'

const BASE = '/local-api/edinet'

/**
 * 開発サーバー(中継)に届かなかったとき(止まっている・再起動中・別のポートの画面を開いている)の文章。
 * ブラウザの生のエラー(「Failed to fetch」)は、原因が分からないので、そのまま出さない。
 */
export const CONNECTION_ERROR =
  '開発サーバー(npm run dev)に接続できませんでした。サーバーが動いているか確かめて、画面を開き直してください(サーバーを再起動したあとも、開き直しが必要です)。'
/** 中継が返す、利用者に見せる文章の長さの上限 */
const MAX_MESSAGE_LENGTH = 300
/** 中継は、この名前のヘッダが付いた要求だけを受け付ける(他のサイトの単純な GET と区別するため) */
const HEADERS = { 'x-local-api': '1' } as const

export interface FiscalYearEnd {
  readonly month: number
  readonly day: number | 'end'
}

export interface CompanyHit {
  readonly edinetCode: string
  readonly name: string
  readonly secCode: string | null
  readonly fiscalYearEnd: FiscalYearEnd | null
  readonly listed: boolean
}

export interface ReportInfo {
  readonly docID: string
  /** 事業年度の末日 */
  readonly periodEnd: string
  readonly submitDateTime: string
  readonly docTypeCode: string
}

export type LocalApiStatus =
  /** 中継が無い(公開用の静的ホスティングなど)。この機能は出さない */
  | { readonly kind: 'unavailable' }
  /** 中継はあるが、API キーが未設定。検索はできるが、取得できない */
  | { readonly kind: 'needsKey' }
  | { readonly kind: 'ready' }

export type ReportEvent =
  | {
      readonly type: 'progress'
      readonly fiscalYearEnd: string
      readonly date: string
      readonly checked: number
      readonly planned: number
      readonly cached: boolean
    }
  | {
      readonly type: 'done'
      readonly reports: readonly ReportInfo[]
      /** 提出期限を過ぎているのに、見つからなかった事業年度の末日 */
      readonly notFound: readonly string[]
      /** まだ提出期限が来ておらず、見つからなかった事業年度の末日(未提出の可能性) */
      readonly pending: readonly string[]
    }
  | { readonly type: 'error'; readonly message: string }

/** 中継を呼ぶ。通信そのものに失敗したら(中止を除く)、原因が分かる文章の例外にする */
async function relayFetch(path: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${BASE}${path}`, { headers: HEADERS, signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(CONNECTION_ERROR)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/** 中継が使えるか調べる。JSON でない応答(静的ホスティングが返す HTML など)は「無い」とみなす */
export async function fetchStatus(signal?: AbortSignal): Promise<LocalApiStatus> {
  try {
    const response = await fetch(`${BASE}/status`, { headers: HEADERS, signal })
    const body = response.ok ? await readJson(response) : null
    if (!isRecord(body) || typeof body.configured !== 'boolean') return { kind: 'unavailable' }
    return body.configured ? { kind: 'ready' } : { kind: 'needsKey' }
  } catch {
    return { kind: 'unavailable' }
  }
}

function parseFiscalYearEnd(value: unknown): FiscalYearEnd | null {
  if (!isRecord(value)) return null
  const { month, day } = value
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) return null
  if (day === 'end') return { month, day }
  return typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31 ? { month, day } : null
}

function parseCompany(value: unknown): CompanyHit | null {
  if (!isRecord(value)) return null
  const { edinetCode, name, secCode, listed } = value
  if (typeof edinetCode !== 'string' || typeof name !== 'string' || typeof listed !== 'boolean') return null
  // 画面に出す文字列は、制御文字・表示を偽装する文字を取り除く(中継の応答も、入力として疑う)
  const cleanName = cleanText(name, MAX_TEXT_LENGTH)
  if (cleanName === null) return null
  return {
    edinetCode,
    name: cleanName,
    secCode: typeof secCode === 'string' ? secCode : null,
    fiscalYearEnd: parseFiscalYearEnd(value.fiscalYearEnd),
    listed,
  }
}

/** 中継が返したエラーの文章。無ければ、既定の文章 */
function errorMessage(body: unknown, fallback: string): string {
  return (isRecord(body) && typeof body.error === 'string' ? cleanText(body.error, MAX_MESSAGE_LENGTH) : null) ?? fallback
}

/** 企業名・証券コード・EDINET コードで、提出者を探す */
export async function searchCompanies(query: string, signal?: AbortSignal): Promise<CompanyHit[]> {
  const response = await relayFetch(`/companies?q=${encodeURIComponent(query)}`, signal)
  const body = await readJson(response)
  if (!response.ok) throw new Error(errorMessage(body, '企業を探せませんでした。'))
  if (!isRecord(body) || !Array.isArray(body.companies)) throw new Error('企業を探せませんでした。')
  return body.companies.flatMap((c) => {
    const company = parseCompany(c)
    return company === null ? [] : [company]
  })
}

function parseReport(value: unknown): ReportInfo | null {
  if (!isRecord(value)) return null
  const { docID, periodEnd, submitDateTime, docTypeCode } = value
  if (
    typeof docID !== 'string' ||
    typeof periodEnd !== 'string' ||
    typeof submitDateTime !== 'string' ||
    typeof docTypeCode !== 'string'
  ) {
    return null
  }
  return { docID, periodEnd, submitDateTime, docTypeCode }
}

/** NDJSON の 1 行を、画面が扱う形のイベントにする。読めない行は null */
export function parseReportEvent(line: string): ReportEvent | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  if (value.type === 'progress') {
    const { fiscalYearEnd, date, checked, planned, cached } = value
    if (
      typeof fiscalYearEnd !== 'string' ||
      typeof date !== 'string' ||
      typeof checked !== 'number' ||
      typeof planned !== 'number' ||
      typeof cached !== 'boolean'
    ) {
      return null
    }
    return { type: 'progress', fiscalYearEnd, date, checked, planned, cached }
  }
  if (value.type === 'done') {
    if (!Array.isArray(value.reports) || !Array.isArray(value.notFound)) return null
    return {
      type: 'done',
      reports: value.reports.flatMap((r) => {
        const report = parseReport(r)
        return report === null ? [] : [report]
      }),
      notFound: value.notFound.filter((d): d is string => typeof d === 'string'),
      pending: Array.isArray(value.pending) ? value.pending.filter((d): d is string => typeof d === 'string') : [],
    }
  }
  if (value.type === 'error' && typeof value.message === 'string') {
    return { type: 'error', message: cleanText(value.message, MAX_MESSAGE_LENGTH) ?? '書類を探せませんでした。' }
  }
  return null
}

/** 本文を行ごとに読み、1 行ずつ渡す */
export async function readLines(body: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let rest = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    rest += decoder.decode(value, { stream: true })
    let newline = rest.indexOf('\n')
    while (newline >= 0) {
      const line = rest.slice(0, newline).trim()
      rest = rest.slice(newline + 1)
      if (line !== '') onLine(line)
      newline = rest.indexOf('\n')
    }
  }
  const last = (rest + decoder.decode()).trim()
  if (last !== '') onLine(last)
}

/**
 * 企業の有価証券報告書を探す。進み具合は onEvent に 1 件ずつ届く。
 * 最後に done か error のイベントが 1 つ届く(届かずに終わったら、通信の失敗として例外)。
 */
export async function streamReports(
  edinetCode: string,
  years: number,
  onEvent: (event: ReportEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await relayFetch(`/reports?edinetCode=${encodeURIComponent(edinetCode)}&years=${years}`, signal)
  if (!response.ok || response.body === null) {
    throw new Error(errorMessage(await readJson(response), '書類を探せませんでした。'))
  }
  let finished = false
  try {
    await readLines(response.body, (line) => {
      const event = parseReportEvent(line)
      if (event === null) return
      if (event.type !== 'progress') finished = true
      onEvent(event)
    })
  } catch (error) {
    // 読んでいる途中でサーバーが止まったとき(中止を除く)
    if (signal?.aborted) throw error
    throw new Error(CONNECTION_ERROR)
  }
  if (!finished) throw new Error('書類の探索が途中で途切れました。もう一度お試しください。')
}

/** 書類(CSV の zip)を取得する */
export async function fetchDocument(docID: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await relayFetch(`/document/${encodeURIComponent(docID)}`, signal)
  if (!response.ok) throw new Error(errorMessage(await readJson(response), '書類を取得できませんでした。'))
  // 読み込む前に大きさを確かめる(取り込みの上限を超える応答で、メモリを使い切らない)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > DEFAULT_IMPORT_LIMITS.maxFileBytes) {
    throw new Error('書類が大きすぎるため、取り込めません。')
  }
  return new Uint8Array(await response.arrayBuffer())
}

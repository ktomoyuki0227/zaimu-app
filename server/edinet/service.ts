import type { EdinetCache } from './cache.ts'
import type { EdinetClient } from './client.ts'
import type { CompanyEntry } from './codeList.ts'
import { keepAnnualReports, pickAnnualReports, type ListedDocument } from './documents.ts'
import { UserFacingError } from './errors.ts'
import { DAY_MS } from './patterns.ts'
import { daysBefore, filingDeadline, filingScanDates, fiscalYearEndDates } from './scanPlan.ts'

/** 探索の進み具合(画面に出す) */
export interface ScanProgress {
  /** 今探している事業年度の末日 */
  readonly fiscalYearEnd: string
  /** 調べている提出日 */
  readonly date: string
  /** この事業年度で、調べた日数 */
  readonly checked: number
  /** この事業年度で、調べる予定の日数(見つかれば、そこで止まる) */
  readonly planned: number
  /** キャッシュにあった(EDINET に問い合わせていない)か */
  readonly cached: boolean
}

export interface FindOptions {
  /** 何事業年度ぶん探すか */
  readonly years: number
  /** 今日(YYYY-MM-DD) */
  readonly today: string
  /** 1 回の探索で、EDINET に問い合わせてよい日数の上限(規約が禁じる大量アクセスを避けるため)。既定 200 */
  readonly maxRequests?: number
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: ScanProgress) => void
}

export interface FindResult {
  /** 見つかった有価証券報告書(事業年度の新しい順) */
  readonly reports: readonly ListedDocument[]
  /** 提出期限を過ぎているのに見つからなかった事業年度の末日 */
  readonly notFound: readonly string[]
  /** まだ提出期限が来ておらず、見つからなかった事業年度の末日(未提出の可能性) */
  readonly pending: readonly string[]
}

export interface ServiceDeps {
  readonly client: Pick<EdinetClient, 'listDocuments' | 'downloadCsvZip'>
  readonly cache: EdinetCache
}

const DEFAULT_MAX_REQUESTS = 200
/** 過去の日でも、直近のうちは一覧がまだ変わりうる(CSV の準備・取り下げ)ので、保存しない日数 */
const RECENT_UNCACHED_DAYS = 7
/** 事業年度の末日と、書類の期間(至)が同じとみなす、日数の幅(決算期の変更に備える) */
const PERIOD_TOLERANCE_DAYS = 10

function isSamePeriod(periodEnd: string | null, fiscalYearEnd: string): boolean {
  if (periodEnd === null) return false
  const diff = Math.abs(Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${fiscalYearEnd}T00:00:00Z`))
  return diff <= PERIOD_TOLERANCE_DAYS * DAY_MS
}

/** キャッシュの読み書きの失敗は、取得全体の失敗にしない(キャッシュが無かったものとして続ける) */
async function readDay(cache: EdinetCache, date: string): Promise<ListedDocument[] | null> {
  try {
    return await cache.getDay(date)
  } catch {
    return null
  }
}

async function writeDay(cache: EdinetCache, date: string, documents: readonly ListedDocument[]): Promise<void> {
  try {
    await cache.putDay(date, documents)
  } catch {
    // 保存できなくても、取得した結果はそのまま使う
  }
}

/** 原本(120)の方が、訂正(130)より優先 */
function isBetter(candidate: ListedDocument, current: ListedDocument | undefined): boolean {
  return current === undefined || (current.docTypeCode !== '120' && candidate.docTypeCode === '120')
}

/**
 * 企業の有価証券報告書を、直近の事業年度から探す。
 * 書類一覧 API は日付でしか絞り込めないので、提出が集中する期限の前後から順に日付を調べ、見つかったら止める。
 * 調べた日の一覧は(直近の数日を除いて)キャッシュし、ほかの企業を探すときにも使う。
 * 原本(120)が見つかるまで探す。訂正(130)しか見つからなければ、それを使う。
 */
export async function findAnnualReports(
  deps: ServiceDeps,
  company: CompanyEntry,
  options: FindOptions,
): Promise<FindResult> {
  const { fiscalYearEnd } = company
  if (fiscalYearEnd === null) {
    throw new UserFacingError('この提出者は決算日が不明なため、有価証券報告書を探せません。')
  }
  const { today, years, maxRequests = DEFAULT_MAX_REQUESTS } = options
  const cacheableUntil = daysBefore(today, RECENT_UNCACHED_DAYS)
  const reports: ListedDocument[] = []
  const notFound: string[] = []
  const pending: string[] = []
  let requests = 0
  /** 提出期限が過ぎた事業年度のうち、探した数(年数の枠に数える) */
  let considered = 0

  // 最新の事業年度は、まだ提出期限が来ていないことがある。その分は枠に数えないよう、1 年多く候補にする
  for (const fye of fiscalYearEndDates(fiscalYearEnd, today, years + 1)) {
    const due = filingDeadline(fye) < today
    if (reports.length >= years || (due && considered >= years)) break
    if (due) considered += 1
    const dates = filingScanDates(fye, today)
    let best: ListedDocument | undefined
    for (const [index, date] of dates.entries()) {
      options.signal?.throwIfAborted()
      let documents = await readDay(deps.cache, date)
      const cached = documents !== null
      if (documents === null) {
        requests += 1
        if (requests > maxRequests) {
          throw new UserFacingError(
            `1 回の探索で調べられる日数の上限(${maxRequests} 日)に達しました。取得できた分は保存してあります。もう一度実行すると、続きから探します。`,
          )
        }
        documents = keepAnnualReports(await deps.client.listDocuments(date, options.signal))
        if (date <= cacheableUntil) await writeDay(deps.cache, date, documents)
      }
      options.onProgress?.({ fiscalYearEnd: fye, date, checked: index + 1, planned: dates.length, cached })
      const candidate = pickAnnualReports(documents, company.edinetCode).find((d) => isSamePeriod(d.periodEnd, fye))
      if (candidate !== undefined && isBetter(candidate, best)) best = candidate
      if (best?.docTypeCode === '120') break
    }
    if (best !== undefined) reports.push(best)
    else if (filingDeadline(fye) < today) notFound.push(fye)
    else pending.push(fye)
  }
  return { reports, notFound, pending }
}

/** promise を待つ。signal が中止されたら、promise の結果を待たずに、すぐ中止の例外にする */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/** 実行中のダウンロード(同じ書類を同時に要求されても、1 回だけ取りに行く)。設定(deps)ごとに持つ */
const inFlight = new WeakMap<object, Map<string, Promise<Uint8Array>>>()

async function downloadAndCache(deps: ServiceDeps, docID: string, signal?: AbortSignal): Promise<Uint8Array> {
  const cached = await deps.cache.getZip(docID).catch(() => null)
  if (cached !== null) return cached
  const bytes = await deps.client.downloadCsvZip(docID, signal)
  await deps.cache.putZip(docID, bytes).catch(() => undefined)
  return bytes
}

/**
 * 書類(CSV の zip)を取得する。取得済みなら、キャッシュから返す。
 * 同じ書類が実行中なら、その結果を待つ。先に始めた側が中止されて失敗したときは、自分の要求が中止されていなければ、取り直す。
 */
export async function getDocumentZip(deps: ServiceDeps, docID: string, signal?: AbortSignal): Promise<Uint8Array> {
  let running = inFlight.get(deps)
  if (running === undefined) {
    running = new Map()
    inFlight.set(deps, running)
  }
  const existing = running.get(docID)
  if (existing !== undefined) {
    try {
      // 待っている間に、自分の要求が中止(画面が切断)されたら、先頭のダウンロードの終わりを待たない
      return await raceAbort(existing, signal)
    } catch (error) {
      signal?.throwIfAborted()
      if (!(error instanceof Error && error.name === 'AbortError')) throw error
      return getDocumentZip(deps, docID, signal)
    }
  }
  const task = downloadAndCache(deps, docID, signal).finally(() => running.delete(docID))
  running.set(docID, task)
  return task
}

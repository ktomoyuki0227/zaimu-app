import { UserFacingError } from './errors.ts'
import { DATE, DOC_ID, EDINET_CODE } from './patterns.ts'

/** 書類一覧 API のレスポンスの読み取りと、有価証券報告書の選択(純粋な関数) */

export interface ListedDocument {
  /** 書類管理番号(例: S100ABCD) */
  readonly docID: string
  readonly edinetCode: string
  readonly secCode: string | null
  readonly filerName: string
  /** 書類種別コード(120 = 有価証券報告書、130 = 訂正有価証券報告書) */
  readonly docTypeCode: string
  /** 期間(至)。事業年度の末日 */
  readonly periodEnd: string | null
  readonly submitDateTime: string
  readonly csvFlag: string
  /** 取下区分(0 = 通常、1 = 取下書、2 = 取り下げられた書類) */
  readonly withdrawalStatus: string
}

/** 有価証券報告書と、その訂正 */
const ANNUAL_REPORT_TYPES: readonly string[] = ['120', '130']

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * 書類一覧 API(type=2)の JSON から、提出書類の一覧を取り出す。
 * ステータスが 200 でなければ例外。形の崩れた 1 件は読み飛ばす。
 */
export function parseDocumentList(json: unknown): ListedDocument[] {
  if (typeof json !== 'object' || json === null) {
    throw new UserFacingError('書類一覧の形式が想定と違います。')
  }
  const root = json as Record<string, unknown>
  const metadata = root.metadata as Record<string, unknown> | undefined
  const status = metadata === undefined ? null : str(metadata.status)
  // メタデータとステータス 200 が無い応答は、「その日は 0 件」と区別できない。0 件として扱って記憶しないよう、拒否する
  if (status === null) {
    throw new UserFacingError('書類一覧の形式が想定と違います(ステータスがありません)。')
  }
  if (status !== '200') {
    throw new UserFacingError(`書類一覧を取得できませんでした(ステータス ${status})。`)
  }
  const results = root.results
  if (results === undefined) {
    return []
  }
  if (!Array.isArray(results)) {
    throw new UserFacingError('書類一覧の形式が想定と違います。')
  }
  const documents: ListedDocument[] = []
  for (const item of results) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const docID = str(r.docID)
    const edinetCode = str(r.edinetCode)
    const docTypeCode = str(r.docTypeCode)
    const submitDateTime = str(r.submitDateTime)
    if (
      docID === null ||
      !DOC_ID.test(docID) ||
      edinetCode === null ||
      !EDINET_CODE.test(edinetCode) ||
      docTypeCode === null ||
      submitDateTime === null
    ) {
      continue
    }
    const periodEnd = str(r.periodEnd)
    documents.push({
      docID,
      edinetCode,
      secCode: str(r.secCode),
      filerName: str(r.filerName) ?? '',
      docTypeCode,
      periodEnd: periodEnd !== null && DATE.test(periodEnd) ? periodEnd : null,
      submitDateTime,
      csvFlag: str(r.csvFlag) ?? '0',
      withdrawalStatus: str(r.withdrawalStatus) ?? '0',
    })
  }
  return documents
}

/** キャッシュに残す価値のある書類(有価証券報告書とその訂正)だけにする */
export function keepAnnualReports(documents: readonly ListedDocument[]): ListedDocument[] {
  return documents.filter((d) => ANNUAL_REPORT_TYPES.includes(d.docTypeCode))
}

/** その企業の、取り込める有価証券報告書(CSV があり、取り下げられていない)か */
export function isImportableAnnualReport(doc: ListedDocument, edinetCode: string): boolean {
  return (
    doc.edinetCode === edinetCode &&
    ANNUAL_REPORT_TYPES.includes(doc.docTypeCode) &&
    doc.csvFlag === '1' &&
    doc.withdrawalStatus === '0' &&
    doc.periodEnd !== null
  )
}

/** 取り込みの優先度(小さいほど優先)。原本(120)は財務諸表がそろっているので、訂正(130)より優先する */
function priority(doc: ListedDocument): number {
  return doc.docTypeCode === '120' ? 0 : 1
}

/**
 * 同じ事業年度の書類が複数あるときは、原本(120)を優先し、同じ種別なら最後に提出されたものを選ぶ。
 * 訂正報告書(130)は、訂正した部分だけを含む場合があり、財務諸表がそろっている保証がないため、
 * 原本が無いときの代わりとしてだけ使う。事業年度の新しい順に返す。
 */
export function pickAnnualReports(documents: readonly ListedDocument[], edinetCode: string): ListedDocument[] {
  const byPeriod = new Map<string, ListedDocument>()
  for (const doc of documents) {
    if (!isImportableAnnualReport(doc, edinetCode) || doc.periodEnd === null) continue
    const current = byPeriod.get(doc.periodEnd)
    if (
      current === undefined ||
      priority(doc) < priority(current) ||
      (priority(doc) === priority(current) && doc.submitDateTime > current.submitDateTime)
    ) {
      byPeriod.set(doc.periodEnd, doc)
    }
  }
  return [...byPeriod.values()].sort((a, b) => (b.periodEnd ?? '').localeCompare(a.periodEnd ?? ''))
}

/** キャッシュなど、外から読んだ値が ListedDocument の形かを確かめる */
export function isListedDocument(value: unknown): value is ListedDocument {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.docID === 'string' &&
    DOC_ID.test(r.docID) &&
    typeof r.edinetCode === 'string' &&
    EDINET_CODE.test(r.edinetCode) &&
    (r.secCode === null || typeof r.secCode === 'string') &&
    typeof r.filerName === 'string' &&
    typeof r.docTypeCode === 'string' &&
    (r.periodEnd === null || (typeof r.periodEnd === 'string' && DATE.test(r.periodEnd))) &&
    typeof r.submitDateTime === 'string' &&
    typeof r.csvFlag === 'string' &&
    typeof r.withdrawalStatus === 'string'
  )
}

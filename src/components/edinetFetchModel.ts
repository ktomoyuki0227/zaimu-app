import {
  streamReports,
  type CompanyHit,
  type FiscalYearEnd,
  type LocalApiStatus,
  type ReportEvent,
  type ReportInfo,
} from '../lib/edinet/localApi'

/** 取得の進み具合(画面に出す状態) */
export type Task =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  /** headline: 読み上げに出す、事業年度ごとの粗い文。detail: 1 日ごとに変わる細かい文(読み上げには出さない) */
  | { readonly kind: 'scanning'; readonly company: CompanyHit; readonly headline: string; readonly detail: string }
  | { readonly kind: 'downloading'; readonly company: CompanyHit; readonly headline: string; readonly detail: string }
  | { readonly kind: 'done'; readonly company: CompanyHit; readonly text: string }
  | { readonly kind: 'error'; readonly message: string }

export function fiscalYearEndText(fye: FiscalYearEnd | null): string {
  if (fye === null) return '決算日不明'
  return fye.day === 'end' ? `${fye.month}月末日決算` : `${fye.month}月${fye.day}日決算`
}

/** 「2025-03-31」→「2025年3月期」 */
export function periodLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split('-')
  return `${Number(y)}年${Number(m)}月期`
}

type ProgressEvent = Extract<ReportEvent, { type: 'progress' }>

export function scanTask(company: CompanyHit, event: ProgressEvent): Task {
  const place = event.cached ? '(保存済みの一覧)' : ''
  return {
    kind: 'scanning',
    company,
    headline: `${periodLabel(event.fiscalYearEnd)}の書類を探しています…`,
    detail: `${event.date} の提出分を確認中${place}(${event.checked} / 最大 ${event.planned} 日)`,
  }
}

/** 取得の結果の文章。見つからなかった事業年度や、まだ提出されていない可能性のある事業年度も知らせる */
export function summaryText(count: number, notFound: readonly string[], pending: readonly string[]): string {
  const parts = [count === 0 ? '有価証券報告書が見つかりませんでした。' : `${count} 件の書類を取得しました。`]
  if (notFound.length > 0) parts.push(`見つからなかった事業年度: ${notFound.map(periodLabel).join('、')}。`)
  if (pending.length > 0) {
    parts.push(`まだ提出期限が来ていない事業年度(未提出の可能性): ${pending.map(periodLabel).join('、')}。`)
  }
  return parts.join('')
}

/** 取得するボタンを押せない理由。押せるなら null */
export function disabledReason(company: CompanyHit, status: LocalApiStatus, busy: boolean): string | null {
  if (status.kind !== 'ready') return 'API キーが未設定のため、取得できません。'
  if (company.fiscalYearEnd === null) return '決算日が不明なため、有価証券報告書を探せません。'
  return busy ? '別の処理を実行中です。' : null
}

export interface ScanResult {
  readonly reports: readonly ReportInfo[]
  /** 提出期限を過ぎているのに、見つからなかった事業年度の末日 */
  readonly notFound: readonly string[]
  /** まだ提出期限が来ておらず、見つからなかった事業年度の末日 */
  readonly pending: readonly string[]
}

/**
 * 書類を探す(中継の探索を、最後まで読む)。進み具合は onProgress に渡す。
 * 中継がエラーを返したときは、その文章の例外を投げる。
 */
export async function scanReports(
  edinetCode: string,
  years: number,
  onProgress: (event: ProgressEvent) => void,
  signal: AbortSignal,
): Promise<ScanResult> {
  let result: ScanResult = { reports: [], notFound: [], pending: [] }
  let failure: string | null = null
  await streamReports(
    edinetCode,
    years,
    (event) => {
      if (event.type === 'progress') onProgress(event)
      else if (event.type === 'done') result = { reports: event.reports, notFound: event.notFound, pending: event.pending }
      else failure = event.message
    },
    signal,
  )
  if (failure !== null) throw new Error(failure)
  return result
}

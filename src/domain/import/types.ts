import type { BalanceSheetInput, CashBalanceKey, CashFlowKey, IncomeStatementInput } from '../types'

/** CSV の 1 行(1 つの数値)。金額は円 */
export interface SourceFact {
  readonly elementId: string // 例: jppfs_cor:CashAndDeposits
  readonly label: string // 書類上の項目名
  readonly year: 'current' | 'prior'
  readonly kind: 'instant' | 'duration'
  /** primary: 連結(連結が無い会社は単体) / individual: 連結のある会社の個別 */
  readonly scope: 'primary' | 'individual'
  readonly value: number
}

/** 書類の表紙情報(DEI)から取れる値 */
export interface DocumentInfo {
  readonly companyName: string | null
  /** EDINET コード(例: E01234)。企業の識別に使う */
  readonly edinetCode: string | null
  /** 会計基準(例: Japan GAAP / IFRS / US GAAP) */
  readonly accountingStandard: string | null
  /** 書類の期間の種類(FY = 通期) */
  readonly periodType: string | null
  /** 当期の決算日(YYYY-MM-DD) */
  readonly currentEndDate: string | null
  /** 前期の決算日(YYYY-MM-DD) */
  readonly priorEndDate: string | null
}

export type EdinetParseResult =
  | { readonly ok: true; readonly facts: readonly SourceFact[]; readonly info: DocumentInfo }
  | { readonly ok: false; readonly reason: string }

/**
 * 1 項目の抽出結果。値は円。
 * - found: 書類の科目から直接取れた
 * - derived: 合計と他の内訳から差し引きで求めた
 * - notApplicable: 書類に該当する科目が無く、0 として扱った
 * - missing: あるはずの科目が見つからず、0 で仮置きした(確認が必要)
 */
export type FieldStatus = 'found' | 'derived' | 'notApplicable' | 'missing'

export interface FieldExtraction {
  readonly value: number
  readonly status: FieldStatus
  /** 取り違えのおそれが小さいか。差し引きや近似で求めたものは medium */
  readonly confidence: 'high' | 'medium'
  /** 値の根拠になった書類上の項目名 */
  readonly sources: readonly string[]
  readonly note?: string
}

export type BsFieldKey = keyof BalanceSheetInput
export type PlFieldKey = Exclude<keyof IncomeStatementInput, CashFlowKey | CashBalanceKey>

export interface ExtractedPeriod {
  readonly endDate: string
  readonly label: string
  readonly bs: Readonly<Record<BsFieldKey, FieldExtraction>>
  readonly pl: Readonly<Record<PlFieldKey, FieldExtraction>>
  /** 営業キャッシュフロー(任意)。書類に無ければ null */
  readonly operatingCashFlow: FieldExtraction | null
  /** 投資キャッシュフロー(任意)。書類に無ければ null */
  readonly investingCashFlow: FieldExtraction | null
  /** 財務キャッシュフロー(任意)。書類に無ければ null */
  readonly financingCashFlow: FieldExtraction | null
  /** 現金及び現金同等物の期末残高(任意)。書類に無ければ null */
  readonly cashEnd: FieldExtraction | null
  /** 現金及び現金同等物の増減額(為替の影響を含む)(任意)。書類に無ければ null */
  readonly cashChange: FieldExtraction | null
  /** 現金及び現金同等物に係る換算差額(為替の影響)(任意)。書類に無ければ null */
  readonly fxEffect: FieldExtraction | null
}

export interface ExtractionResult {
  readonly companyName: string
  readonly edinetCode: string | null
  readonly consolidation: 'consolidated' | 'individual'
  /** 古い期から新しい期の順 */
  readonly periods: readonly ExtractedPeriod[]
  /** 確認してほしい点(反映はできる) */
  readonly warnings: readonly string[]
  /** 知っておいてほしい扱い(確認は求めない) */
  readonly notes: readonly string[]
  /** 反映できない理由 */
  readonly errors: readonly string[]
  /** 自動で反映せず、利用者に確認してもらうべきか */
  readonly needsReview: boolean
}

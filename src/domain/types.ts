// 財務諸表の入力データ型。金額の単位は呼び出し側で統一する(例: 百万円)。

/** 貸借対照表(BS)の入力項目 */
export interface BalanceSheetInput {
  // 流動資産
  readonly cash: number // 現金預金
  readonly receivables: number // 売上債権(受取手形・売掛金・電子記録債権)
  readonly securities: number // 有価証券(短期保有)
  readonly inventory: number // 棚卸資産
  readonly otherCurrentAssets: number // その他の流動資産
  // 固定資産
  readonly fixedAssets: number // 固定資産合計
  // 流動負債
  readonly payables: number // 仕入債務(支払手形・買掛金)
  readonly shortTermDebt: number // 短期借入金(1年内返済の長期借入金を含む)
  readonly otherCurrentLiabilities: number // その他の流動負債
  // 固定負債
  readonly longTermDebt: number // 長期借入金・社債などの有利子の固定負債
  readonly otherFixedLiabilities: number // その他の固定負債
  // 純資産
  readonly equity: number // 純資産(自己資本)
}

/** 損益計算書(PL)の入力項目 */
export interface IncomeStatementInput {
  readonly sales: number // 売上高
  readonly costOfSales: number // 売上原価
  readonly sga: number // 販売費及び一般管理費
  readonly nonOperatingIncome: number // 営業外収益
  readonly interestExpense: number // 支払利息(営業外費用のうち)
  readonly otherNonOperatingExpense: number // その他の営業外費用
  readonly extraordinaryGain: number // 特別利益
  readonly extraordinaryLoss: number // 特別損失
  readonly incomeTaxes: number // 法人税等
  readonly depreciation: number // 減価償却費(債務償還年数の計算に使う)
  /** 営業キャッシュフロー。分かる場合のみ入力すると債務償還年数がより正確になる */
  readonly operatingCashFlow?: number
  /** 投資キャッシュフロー(設備投資・有価証券の取得など。プラス: 資金が入った / マイナス: 資金が出た) */
  readonly investingCashFlow?: number
  /** 財務キャッシュフロー(借入・返済・配当・自己株式など。プラス: 資金が入った / マイナス: 資金が出た) */
  readonly financingCashFlow?: number
  /** 現金及び現金同等物の期末残高(キャッシュフロー計算書の最後の行)。現金の増減との突き合わせに使う */
  readonly cashEnd?: number
  /** 現金及び現金同等物の増減額(為替の影響を含む)。期首残高が分からないときに、期首を割り出すのに使う */
  readonly cashChange?: number
  /** 現金及び現金同等物に係る換算差額(為替の影響)。プラス: 資金が増えた / マイナス: 減った */
  readonly fxEffect?: number
}

/** キャッシュフロー計算書の 3 つの区分。この順が、計算書の正式な並び(営業 → 投資 → 財務) */
export const CASH_FLOW_KEYS = ['operatingCashFlow', 'investingCashFlow', 'financingCashFlow'] as const
export type CashFlowKey = (typeof CASH_FLOW_KEYS)[number]

/** キャッシュフロー計算書の、現金残高まわりの 3 項目(任意)。現金の増減との突き合わせに使う */
export const CASH_BALANCE_KEYS = ['cashEnd', 'cashChange', 'fxEffect'] as const
export type CashBalanceKey = (typeof CASH_BALANCE_KEYS)[number]

/** 数字の範囲。連結: 子会社を含むグループ全体 / 単体: その会社だけ */
export type Basis = 'consolidated' | 'individual'

/** 1期分の財務データ */
export interface PeriodData {
  readonly label: string // 例: "2024年3月期"
  /** 数字の範囲。ファイルから取り込んだ期には付く(古い保存データや練習用データには無い) */
  readonly basis?: Basis
  readonly bs: BalanceSheetInput
  readonly pl: IncomeStatementInput
}

/** 金額の単位。ファイルから取り込んだ会社には付く(手入力の古いデータには無い) */
export type AmountUnit = '円' | '千円' | '百万円'

/** 1社分のデータ(複数期) */
export interface Company {
  readonly id: string
  readonly name: string
  readonly unit?: AmountUnit
  /** EDINET コード(例: E01234)。同じ企業の別年度のファイルを、積み上げるための識別 */
  readonly edinetCode?: string
  readonly periods: readonly PeriodData[] // 古い期から新しい期の順
}

/** 入力から導出した合計・段階利益 */
export interface DerivedStatements {
  readonly currentAssets: number
  readonly quickAssets: number // 当座資産 = 現金預金 + 売上債権 + 有価証券
  readonly totalAssets: number
  readonly currentLiabilities: number
  readonly fixedLiabilities: number
  readonly totalLiabilities: number
  readonly interestBearingDebt: number // 有利子負債 = 短期借入金 + 長期借入金
  readonly grossProfit: number // 売上総利益
  readonly operatingProfit: number // 営業利益
  readonly ordinaryProfit: number // 経常利益
  readonly preTaxProfit: number // 税引前当期純利益
  readonly netIncome: number // 当期純利益
  /** BS の貸借が一致していない場合の差額(資産 - (負債 + 純資産))。一致していれば 0 */
  readonly balanceGap: number
}

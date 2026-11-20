import type { BalanceSheetInput, IncomeStatementInput } from './types'

export interface FieldDef<K extends string> {
  readonly key: K
  readonly label: string
  /** 入力表で見出しとして使う区分 */
  readonly section: string
  /** 任意入力の項目(未入力を許す) */
  readonly optional?: boolean
  readonly hint?: string
}

export const BS_FIELDS: readonly FieldDef<keyof BalanceSheetInput>[] = [
  { key: 'cash', label: '現金預金', section: '流動資産' },
  { key: 'receivables', label: '売上債権', section: '流動資産', hint: '受取手形・売掛金など' },
  { key: 'securities', label: '有価証券', section: '流動資産', hint: '短期保有のもの' },
  { key: 'inventory', label: '棚卸資産', section: '流動資産', hint: '商品・製品・原材料など' },
  { key: 'otherCurrentAssets', label: 'その他の流動資産', section: '流動資産' },
  { key: 'fixedAssets', label: '固定資産合計', section: '固定資産' },
  { key: 'payables', label: '仕入債務', section: '流動負債', hint: '支払手形・買掛金など' },
  { key: 'shortTermDebt', label: '短期借入金', section: '流動負債', hint: '1年内返済の長期借入金を含む' },
  { key: 'otherCurrentLiabilities', label: 'その他の流動負債', section: '流動負債' },
  { key: 'longTermDebt', label: '長期借入金・社債', section: '固定負債' },
  { key: 'otherFixedLiabilities', label: 'その他の固定負債', section: '固定負債' },
  { key: 'equity', label: '純資産(自己資本)', section: '純資産' },
]

export const PL_FIELDS: readonly FieldDef<keyof IncomeStatementInput>[] = [
  { key: 'sales', label: '売上高', section: '本業' },
  { key: 'costOfSales', label: '売上原価', section: '本業' },
  { key: 'sga', label: '販売費及び一般管理費', section: '本業' },
  { key: 'nonOperatingIncome', label: '営業外収益', section: '営業外・特別' },
  { key: 'interestExpense', label: '支払利息', section: '営業外・特別' },
  { key: 'otherNonOperatingExpense', label: 'その他の営業外費用', section: '営業外・特別' },
  { key: 'extraordinaryGain', label: '特別利益', section: '営業外・特別' },
  { key: 'extraordinaryLoss', label: '特別損失', section: '営業外・特別' },
  { key: 'incomeTaxes', label: '法人税等', section: '営業外・特別' },
  { key: 'depreciation', label: '減価償却費', section: '補足', hint: '債務償還年数の計算に使う' },
  {
    key: 'operatingCashFlow',
    label: '営業キャッシュフロー',
    section: '補足',
    optional: true,
    hint: '分かる場合のみ。空欄なら「純利益+減価償却費」で近似',
  },
  {
    key: 'investingCashFlow',
    label: '投資キャッシュフロー',
    section: '補足',
    optional: true,
    hint: '設備投資・有価証券の取得など。支出が多いとマイナス',
  },
  {
    key: 'financingCashFlow',
    label: '財務キャッシュフロー',
    section: '補足',
    optional: true,
    hint: '借入・返済・配当など。返済や配当が多いとマイナス',
  },
]

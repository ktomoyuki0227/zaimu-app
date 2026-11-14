/**
 * テスト用の合成データ(IFRS)。実在しない会社の数字で、EDINET の CSV の列構成と、
 * IFRS 用の要素ID(jpigp_cor: …IFRS)をまねている。実際の提出書類は含まない。
 * 金額は百万円の整数 × 100 万 = 円。恒等式がすべて成り立つ。
 */
import {
  M,
  contextId,
  deiRows,
  line,
  type FixtureOptions,
  type FixtureRow,
  type Line,
} from './edinetFixture'

export const IFRS_LINES: readonly Line[] = [
  // 財政状態計算書
  line('CashAndCashEquivalentsIFRS', '現金及び現金同等物(IFRS)', 'instant', 10_000),
  line('TradeAndOtherReceivablesCAIFRS', '営業債権及びその他の債権、流動資産(IFRS)', 'instant', 15_000),
  line('OtherFinancialAssetsCAIFRS', 'その他の金融資産、流動資産(IFRS)', 'instant', 1_000),
  line('InventoriesCAIFRS', '棚卸資産、流動資産(IFRS)', 'instant', 12_000),
  line('CurrentAssetsIFRS', '流動資産(IFRS)', 'instant', 40_000),
  line('NonCurrentAssetsIFRS', '非流動資産(IFRS)', 'instant', 60_000),
  line('AssetsIFRS', '資産(IFRS)', 'instant', 100_000),
  line('TradeAndOtherPayablesCLIFRS', '営業債務及びその他の債務、流動負債(IFRS)', 'instant', 9_000),
  line('InterestBearingLiabilitiesCLIFRS', '有利子負債、流動負債(IFRS)', 'instant', 8_000),
  line('TotalCurrentLiabilitiesIFRS', '流動負債(IFRS)', 'instant', 25_000),
  line('InterestBearingLiabilitiesNCLIFRS', '有利子負債、非流動負債(IFRS)', 'instant', 20_000),
  line('NonCurrentLabilitiesIFRS', '非流動負債(IFRS)', 'instant', 30_000),
  line('LiabilitiesIFRS', '負債(IFRS)', 'instant', 55_000),
  line('EquityIFRS', '資本(IFRS)', 'instant', 45_000),
  // 損益計算書(営業利益 9,000 = 売上総利益 36,000 − 販管費 25,000 − その他の営業費用(純) 2,000)
  line('RevenueIFRS', '売上収益(IFRS)', 'duration', 120_000),
  line('CostOfSalesIFRS', '売上原価(IFRS)', 'duration', 84_000),
  line('GrossProfitIFRS', '売上総利益(IFRS)', 'duration', 36_000),
  line('SellingGeneralAndAdministrativeExpensesIFRS', '販売費及び一般管理費(IFRS)', 'duration', 25_000),
  line('OperatingProfitLossIFRS', '営業利益(IFRS)', 'duration', 9_000),
  line('FinanceIncomeIFRS', '金融収益(IFRS)', 'duration', 1_500),
  line('InterestExpensesIFRS', '支払利息(IFRS)', 'duration', 900),
  line('ProfitLossBeforeTaxIFRS', '税引前利益(IFRS)', 'duration', 9_600),
  line('IncomeTaxExpenseIFRS', '法人所得税費用(IFRS)', 'duration', 2_880),
  line('ProfitLossIFRS', '当期利益(IFRS)', 'duration', 6_720),
  line('DepreciationAndAmortizationOpeCFIFRS', '減価償却費及び償却費、営業活動によるキャッシュ・フロー(IFRS)', 'duration', 4_000),
  line('NetCashProvidedByUsedInOperatingActivitiesIFRS', '営業活動によるキャッシュ・フロー(IFRS)', 'duration', 7_000),
]

export interface IfrsFixtureOptions extends FixtureOptions {
  /** 追加・差し替えの行(接頭辞付きの要素ID)。同じ要素の標準行は取り除く */
  readonly customLines?: readonly { readonly elementId: string; readonly label: string; readonly millions: readonly [number, number] }[]
}

function ifrsRow(elementId: string, label: string, context: string, amountYen: number): FixtureRow {
  return { elementId, label, contextId: context, consolidation: '連結', unit: '円', value: String(amountYen) }
}

export function ifrsFixtureRows(options: IfrsFixtureOptions = {}): FixtureRow[] {
  const omit = new Set(options.omit ?? [])
  const rows: FixtureRow[] = [...deiRows({ ...options, standard: options.standard ?? 'IFRS' })]
  const years: readonly ('current' | 'prior')[] = options.noPrior ? ['current'] : ['current', 'prior']
  for (const l of IFRS_LINES) {
    if (omit.has(l.element)) {
      continue
    }
    const over = options.override?.[l.element]
    for (const year of years) {
      const millions = over ? over[year === 'current' ? 0 : 1] : year === 'current' ? l.current : l.prior
      rows.push(ifrsRow(`jpigp_cor:${l.element}`, l.label, contextId(year, l.kind, false), millions * M))
    }
  }
  for (const c of options.customLines ?? []) {
    for (const year of years) {
      rows.push(ifrsRow(c.elementId, c.label, contextId(year, 'duration', false), c.millions[year === 'current' ? 0 : 1] * M))
    }
  }
  return [...rows, ...(options.extraRows ?? [])]
}

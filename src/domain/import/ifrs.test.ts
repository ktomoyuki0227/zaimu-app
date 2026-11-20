import { describe, expect, test } from 'vitest'
import { parseEdinetCsv } from './edinetCsv'
import { extractFromFacts } from './extract'
import { buildCsvText } from './testing/edinetFixture'
import { ifrsFixtureRows, type IfrsFixtureOptions } from './testing/ifrsFixture'

const M = 1_000_000

function extract(options: IfrsFixtureOptions = {}) {
  const parsed = parseEdinetCsv(buildCsvText(ifrsFixtureRows(options)), 100_000)
  if (!parsed.ok) throw new Error(parsed.reason)
  return extractFromFacts(parsed.facts, parsed.info)
}

describe('IFRS の書類: 正常系', () => {
  const result = extract()
  const { bs, pl } = result.periods[1]

  test('エラーも確認事項もなく、2 期分(古い順)が取れる', () => {
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.needsReview).toBe(false)
    expect(result.consolidation).toBe('consolidated')
    expect(result.periods.map((p) => p.label)).toEqual(['2024年3月期', '2025年3月期'])
  })

  test('財政状態計算書: 直接取れる項目と、差額の「その他」', () => {
    expect(bs.cash).toMatchObject({ value: 10_000 * M, status: 'found' })
    expect(bs.receivables.value).toBe(15_000 * M)
    expect(bs.inventory.value).toBe(12_000 * M)
    expect(bs.payables.value).toBe(9_000 * M)
    expect(bs.shortTermDebt.value).toBe(8_000 * M)
    expect(bs.longTermDebt.value).toBe(20_000 * M)
    expect(bs.equity.value).toBe(45_000 * M)
    // その他の金融資産(流動)は有価証券にせず、「その他」に含める
    expect(bs.securities.value).toBe(0)
    expect(bs.otherCurrentAssets.value).toBe((40_000 - 10_000 - 15_000 - 12_000) * M)
    expect(bs.fixedAssets.value).toBe(60_000 * M)
    expect(bs.otherCurrentLiabilities.value).toBe((25_000 - 9_000 - 8_000) * M)
    expect(bs.otherFixedLiabilities.value).toBe((55_000 - 25_000 - 20_000) * M)
  })

  test('損益計算書: 営業利益に合わせて販管費をそろえ、営業利益が書類と一致する', () => {
    expect(pl.sales.value).toBe(120_000 * M)
    expect(pl.costOfSales.value).toBe(84_000 * M)
    // 書類の販管費は 25,000 だが、営業利益 9,000 に合わせて 36,000 − 9,000 = 27,000
    expect(pl.sga).toMatchObject({ value: 27_000 * M, status: 'derived', confidence: 'high' })
    expect(pl.sales.value - pl.costOfSales.value - pl.sga.value).toBe(9_000 * M)
    expect(result.notes.some((n) => n.includes('販売費及び一般管理費'))).toBe(true)
  })

  test('営業外・特別損益: 金融収益・金融費用を使い、税引前利益に必ず合う', () => {
    expect(pl.nonOperatingIncome).toMatchObject({ value: 1_500 * M, status: 'found' })
    expect(pl.interestExpense.value).toBe(900 * M)
    expect(pl.otherNonOperatingExpense.value).toBe(0)
    expect(pl.extraordinaryGain.value).toBe(0)
    expect(pl.extraordinaryLoss.value).toBe(0)
    const operating = pl.sales.value - pl.costOfSales.value - pl.sga.value
    const preTax = operating + pl.nonOperatingIncome.value - pl.interestExpense.value - pl.otherNonOperatingExpense.value
    expect(preTax).toBe(9_600 * M)
    expect(pl.incomeTaxes.value).toBe(2_880 * M)
    expect(pl.depreciation.value).toBe(4_000 * M)
    expect(result.periods[1].operatingCashFlow?.value).toBe(7_000 * M)
  })
})

describe('IFRS の書類: 営業外の振り分け', () => {
  test('金融収益より税引前利益の増分が大きいとき(持分法損益など)は、営業外収益に差を含める', () => {
    const result = extract({ override: { ProfitLossBeforeTaxIFRS: [11_000, 9_900], ProfitLossIFRS: [8_120, 7_308] } })
    const { pl } = result.periods[1]
    // 税引前利益 − 営業利益 = 2,000。支払利息 900 を足して、営業外収益は 2,900
    expect(pl.nonOperatingIncome).toMatchObject({ value: 2_900 * M, status: 'derived' })
    expect(pl.otherNonOperatingExpense.value).toBe(0)
    expect(result.errors).toEqual([])
  })

  test('金融収益が税引前利益の増分より大きいとき(その他の営業外費用がある)は、差額を「その他」に入れる', () => {
    const result = extract({ override: { ProfitLossBeforeTaxIFRS: [8_000, 7_200], ProfitLossIFRS: [5_120, 4_608] } })
    const { pl } = result.periods[1]
    // 税引前利益 − 営業利益 = −1,000。金融収益 1,500 − 支払利息 900 − (−1,000) = 1,600
    expect(pl.otherNonOperatingExpense.value).toBe(1_600 * M)
    expect(pl.nonOperatingIncome.value).toBe(1_500 * M)
  })

  test('金融費用が無く有利子負債があるときは、確認が必要な項目にする', () => {
    const result = extract({ omit: ['InterestExpensesIFRS'] })
    expect(result.periods[1].pl.interestExpense.status).toBe('missing')
    expect(result.needsReview).toBe(true)
  })
})

describe('IFRS の書類: 売上の探し方', () => {
  test('標準科目に売上が無いときは、会社独自の拡張科目や主要な経営指標の科目から読む', () => {
    const extension = extract({
      omit: ['RevenueIFRS'],
      customLines: [{ elementId: 'jpcrp030000-asr_E99999-000:SalesRevenuesIFRS', label: '売上高', millions: [120_000, 108_000] }],
    })
    expect(extension.errors).toEqual([])
    expect(extension.periods[1].pl.sales.value).toBe(120_000 * M)
    const summary = extract({
      omit: ['RevenueIFRS'],
      customLines: [{ elementId: 'jpcrp_cor:OperatingRevenuesIFRSKeyFinancialData', label: '営業収益', millions: [120_000, 108_000] }],
    })
    expect(summary.periods[0].pl.sales.value).toBe(108_000 * M)
  })

  test('売上の科目が名前の候補に無ければ、エラーにする(別の科目を売上にしない)', () => {
    const result = extract({
      omit: ['RevenueIFRS'],
      customLines: [{ elementId: 'jpcrp_cor:SomethingElse', label: 'x', millions: [1, 1] }],
    })
    expect(result.periods).toEqual([])
    expect(result.errors.some((e) => e.includes('売上'))).toBe(true)
  })
})

describe('IFRS の書類: 会社ごとの科目名の違い', () => {
  test('売上債権が会社独自の拡張科目で載る書類も読める', () => {
    const result = extract({
      omit: ['TradeAndOtherReceivablesCAIFRS'],
      customLines: [
        { elementId: 'jpcrp030000-asr_E99999-000:TradeReceivablesAndContractAssetsCAIFRSIFRS', label: '売上債権及び契約資産', millions: [15_000, 13_500] },
      ],
    })
    expect(result.errors).toEqual([])
    expect(result.periods[1].bs.receivables).toMatchObject({ value: 15_000 * M, status: 'found' })
    expect(result.needsReview).toBe(false)
  })

  test('買入債務・長期債務・減価償却費の別名も読む', () => {
    const result = extract({
      omit: [
        'TradeAndOtherPayablesCLIFRS',
        'InterestBearingLiabilitiesNCLIFRS',
        'DepreciationAndAmortizationOpeCFIFRS',
      ],
      customLines: [
        { elementId: 'jpigp_cor:TradePayables3CLIFRS', label: '買入債務', millions: [9_000, 8_100] },
        { elementId: 'jpigp_cor:LongTermDebtNCLIFRS', label: '長期債務', millions: [20_000, 18_000] },
        { elementId: 'jpigp_cor:DepreciationAndAmortizationOfIntangibleAssetsOpeCFIFRS', label: '減価償却費及び無形資産償却費', millions: [4_000, 3_600] },
      ],
    })
    const { bs, pl } = result.periods[1]
    expect(bs.payables.value).toBe(9_000 * M)
    expect(bs.longTermDebt.value).toBe(20_000 * M)
    expect(pl.depreciation.value).toBe(4_000 * M)
    expect(result.errors).toEqual([])
  })

  test('売上債権・仕入債務の科目が見つからなければ、0 の仮置きとして確認を求める(「該当なし」にしない)', () => {
    const result = extract({ omit: ['TradeAndOtherReceivablesCAIFRS', 'TradeAndOtherPayablesCLIFRS'] })
    expect(result.periods[1].bs.receivables.status).toBe('missing')
    expect(result.periods[1].bs.payables.status).toBe('missing')
    expect(result.needsReview).toBe(true)
  })

  test('営業利益の表示が無い書類は、売上総利益 − 販管費を営業利益とし、その旨を知らせる', () => {
    const result = extract({ omit: ['OperatingProfitLossIFRS'] })
    const { pl } = result.periods[1]
    expect(pl.sga).toMatchObject({ value: 25_000 * M, status: 'found' })
    expect(result.notes.some((n) => n.includes('営業利益の表示が無い'))).toBe(true)
    // 営業利益 11,000 → 税引前利益 9,600 との差 −1,400 は「その他」の営業外費用に入る
    expect(pl.otherNonOperatingExpense.value).toBe(1_500 * M - 900 * M + 1_400 * M)
    expect(result.errors).toEqual([])
  })

  test('支払利息があるのに借入金・社債の科目が見つからなければ、確認事項にする', () => {
    const result = extract({ omit: ['InterestBearingLiabilitiesCLIFRS', 'InterestBearingLiabilitiesNCLIFRS'] })
    expect(result.warnings.some((w) => w.includes('有利子負債の科目が見つかりません'))).toBe(true)
    expect(result.needsReview).toBe(true)
  })
})

describe('IFRS の書類: 不整合は反映しない・知らせる', () => {
  test('営業利益が売上総利益を超える書類(その他の営業収益が大きい)は、拒否せず、書類の販管費を使って知らせる', () => {
    // 売上総利益 36,000 に対し、営業利益が 40,000(その他の営業収益が販管費を上回る)
    const result = extract({ override: { OperatingProfitLossIFRS: [40_000, 36_000], ProfitLossBeforeTaxIFRS: [40_700, 36_630], ProfitLossIFRS: [37_820, 34_038] } })
    expect(result.errors).toEqual([])
    const { pl } = result.periods[1]
    expect(pl.sga).toMatchObject({ value: 25_000 * M, status: 'found' })
    expect(result.warnings.some((w) => w.includes('営業利益') && w.includes('超えています'))).toBe(true)
    expect(result.needsReview).toBe(true)
    // 税引前利益には必ず合う(差は営業外に入る)
    const operating = pl.sales.value - pl.costOfSales.value - pl.sga.value
    const preTax = operating + pl.nonOperatingIncome.value - pl.interestExpense.value - pl.otherNonOperatingExpense.value
    expect(preTax).toBe(40_700 * M)
  })

  test('税引前利益が無ければ、エラー', () => {
    const result = extract({ omit: ['ProfitLossBeforeTaxIFRS'] })
    expect(result.periods).toEqual([])
    expect(result.errors.some((e) => e.includes('税引前利益'))).toBe(true)
  })

  test('貸借が合わなければ、エラー', () => {
    const result = extract({ override: { AssetsIFRS: [120_000, 108_000] } })
    expect(result.periods).toEqual([])
    expect(result.errors.some((e) => e.includes('貸借が一致しません'))).toBe(true)
  })

  test('書類の当期利益と計算値が合わなければ、確認事項にする', () => {
    const result = extract({ override: { ProfitLossIFRS: [6_000, 5_400] } })
    expect(result.warnings.some((w) => w.includes('合いません'))).toBe(true)
    expect(result.needsReview).toBe(true)
  })

  test('会計基準が IFRS・日本基準以外(米国基準)の書類は未対応', () => {
    const result = extract({ standard: 'US GAAP' })
    expect(result.periods).toEqual([])
    expect(result.errors.some((e) => e.includes('US GAAP'))).toBe(true)
  })

  test('会計基準が日本基準の表示なら、IFRS の科目があっても日本基準として読む(科目が無ければエラー)', () => {
    const result = extract({ standard: 'Japan GAAP' })
    expect(result.periods).toEqual([])
    expect(result.errors.some((e) => e.includes('資産合計'))).toBe(true)
  })
})

describe('IFRS の書類: 確認が必要な値の判定', () => {
  test('支払利息が金融費用の合計しか無いときは、確認が必要な値にする(為替差損などを含みうる)', () => {
    const result = extract({
      omit: ['InterestExpensesIFRS'],
      customLines: [{ elementId: 'jpigp_cor:FinanceCostsIFRS', label: '金融費用', millions: [900, 810] }],
    })
    expect(result.periods[1].pl.interestExpense).toMatchObject({ value: 900 * M, status: 'found', confidence: 'medium' })
    expect(result.needsReview).toBe(true)
  })

  test('標準の支払利息があれば、金融費用の合計より優先する', () => {
    const result = extract({
      customLines: [{ elementId: 'jpigp_cor:FinanceCostsIFRS', label: '金融費用', millions: [3_000, 2_700] }],
    })
    expect(result.periods[1].pl.interestExpense).toMatchObject({ value: 900 * M, confidence: 'high' })
  })

  test('差で合わせた営業外の項目が税引前利益に比べて大きいときは、確認が必要な値にする', () => {
    // 税引前利益 13,000 に対し、営業外収益を 4,900 の差で合わせる(約 38%)
    const result = extract({
      omit: ['FinanceIncomeIFRS'],
      override: { ProfitLossBeforeTaxIFRS: [13_000, 11_700], ProfitLossIFRS: [10_120, 9_108] },
    })
    expect(result.periods[1].pl.nonOperatingIncome).toMatchObject({ status: 'derived', confidence: 'medium' })
    expect(result.needsReview).toBe(true)
  })

  test('売上収益の科目が複数あり、値が違うときは、確認事項にする', () => {
    const result = extract({
      customLines: [{ elementId: 'jpcrp_cor:OperatingRevenuesIFRSKeyFinancialData', label: '営業収益', millions: [119_000, 107_100] }],
    })
    expect(result.warnings.some((w) => w.includes('売上収益の科目が複数'))).toBe(true)
    expect(result.periods[1].pl.sales.value).toBe(120_000 * M)
  })

  test('売上原価も売上総利益も無い書類(費用の性質別の様式)は、売上原価を 0 の仮置きにして確認を求める', () => {
    const result = extract({ omit: ['CostOfSalesIFRS', 'GrossProfitIFRS'] })
    expect(result.periods[1].pl.costOfSales.status).toBe('missing')
    expect(result.needsReview).toBe(true)
  })

  test('有利子負債が借入金・社債の内訳だけで載る書類は、内訳を足す(合計と二重に数えない)', () => {
    const result = extract({
      omit: ['InterestBearingLiabilitiesCLIFRS', 'InterestBearingLiabilitiesNCLIFRS'],
      customLines: [
        { elementId: 'jpigp_cor:BorrowingsCLIFRS', label: '借入金、流動', millions: [5_000, 4_500] },
        { elementId: 'jpigp_cor:CommercialPapersCLIFRS', label: 'コマーシャル・ペーパー', millions: [3_000, 2_700] },
        { elementId: 'jpigp_cor:BondsPayableNCLIFRS', label: '社債、非流動', millions: [8_000, 7_200] },
        { elementId: 'jpigp_cor:BorrowingsNCLIFRS', label: '借入金、非流動', millions: [12_000, 10_800] },
      ],
    })
    const { bs } = result.periods[1]
    expect(bs.shortTermDebt.value).toBe(8_000 * M)
    expect(bs.longTermDebt.value).toBe(20_000 * M)
    expect(result.errors).toEqual([])
  })

  test('赤字(営業損失・税引前損失)の書類も読める', () => {
    const result = extract({
      override: {
        OperatingProfitLossIFRS: [-3_000, -2_700],
        ProfitLossBeforeTaxIFRS: [-2_400, -2_160],
        IncomeTaxExpenseIFRS: [600, 540],
        ProfitLossIFRS: [-3_000, -2_700],
      },
    })
    expect(result.errors).toEqual([])
    const { pl } = result.periods[1]
    expect(pl.sga.value).toBe(39_000 * M)
    expect(pl.sales.value - pl.costOfSales.value - pl.sga.value).toBe(-3_000 * M)
    expect(result.warnings).toEqual([])
  })

  test('有利子負債がある書類は、リース負債の扱いを知らせる', () => {
    expect(extract().notes.some((n) => n.includes('リース負債'))).toBe(true)
  })

  test('修正国際基準(JMIS)など、IFRS・日本基準以外は未対応', () => {
    const result = extract({ standard: 'JMIS' })
    expect(result.periods).toEqual([])
    expect(result.errors.some((e) => e.includes('JMIS'))).toBe(true)
  })

  test('前期の財政状態計算書が無い書類は、当期だけを取り込み、その旨を知らせる', () => {
    const result = extract({ noPrior: true })
    expect(result.periods).toHaveLength(1)
    expect(result.warnings.some((w) => w.includes('前期'))).toBe(true)
  })
})

describe('IFRS の書類: キャッシュフローの 3 区分', () => {
  test('営業・投資・財務を、書類の符号のまま読む', () => {
    const p = extract().periods[1]
    expect(p.operatingCashFlow?.value).toBe(7_000 * M)
    expect(p.investingCashFlow?.value).toBe(-5_000 * M)
    expect(p.financingCashFlow?.value).toBe(1_500 * M)
  })

  test('書類に無い区分は null', () => {
    const p = extract({ omit: ['NetCashProvidedByUsedInFinancingActivitiesIFRS'] }).periods[1]
    expect(p.financingCashFlow).toBeNull()
  })
})

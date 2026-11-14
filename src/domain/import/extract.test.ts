import { describe, expect, test } from 'vitest'
import { parseEdinetCsv } from './edinetCsv'
import { extractFromFacts } from './extract'
import { buildCsvText, fixtureRows, type FixtureOptions, type FixtureRow } from './testing/edinetFixture'

const M = 1_000_000

function extract(options: FixtureOptions = {}) {
  const parsed = parseEdinetCsv(buildCsvText(fixtureRows(options)), 100_000)
  if (!parsed.ok) throw new Error(parsed.reason)
  return extractFromFacts(parsed.facts, parsed.info)
}

function row(element: string, context: string, millions: number, label = element): FixtureRow {
  return {
    elementId: `jppfs_cor:${element}`,
    label,
    contextId: context,
    consolidation: '連結',
    unit: 'JPY',
    value: String(millions * M),
  }
}

describe('extractFromFacts: 正常系(日本基準・連結・通期)', () => {
  const result = extract()

  test('エラーも確認事項もなく、2 期分(古い順)が取れる', () => {
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.needsReview).toBe(false)
    expect(result.consolidation).toBe('consolidated')
    expect(result.companyName).toBe('サンプル製作所(架空)')
    expect(result.periods.map((p) => p.label)).toEqual(['2024年3月期', '2025年3月期'])
    expect(result.periods.map((p) => p.endDate)).toEqual(['2024-03-31', '2025-03-31'])
  })

  test('BS の直接取れる項目', () => {
    const bs = result.periods[1].bs
    expect(bs.cash).toMatchObject({ value: 10_000 * M, status: 'found', confidence: 'high' })
    expect(bs.receivables.value).toBe(15_000 * M)
    expect(bs.securities.value).toBe(1_000 * M)
    expect(bs.inventory.value).toBe(12_000 * M)
    expect(bs.payables.value).toBe(9_000 * M)
    expect(bs.equity.value).toBe(45_000 * M)
  })

  test('有利子負債は借入金・社債を足す(短期は 1 年内返済分を含む)', () => {
    const bs = result.periods[1].bs
    expect(bs.shortTermDebt.value).toBe((5_000 + 3_000) * M)
    expect(bs.longTermDebt.value).toBe((5_000 + 15_000) * M)
    expect(bs.shortTermDebt.sources).toEqual(['短期借入金', '1年内返済予定の長期借入金'])
  })

  test('「その他」は合計から内訳を引いた差額で出し、貸借が必ず一致する', () => {
    const { bs } = result.periods[1]
    expect(bs.otherCurrentAssets).toMatchObject({ value: 2_000 * M, status: 'derived' })
    expect(bs.fixedAssets).toMatchObject({ value: 60_000 * M, status: 'derived' })
    expect(bs.otherCurrentLiabilities.value).toBe(8_000 * M)
    expect(bs.otherFixedLiabilities.value).toBe(10_000 * M)
    const assets = Object.entries(bs)
      .filter(([k]) =>
        ['cash', 'receivables', 'securities', 'inventory', 'otherCurrentAssets', 'fixedAssets'].includes(k),
      )
      .reduce((s, [, v]) => s + v.value, 0)
    const rest = Object.entries(bs)
      .filter(([k]) => !['cash', 'receivables', 'securities', 'inventory', 'otherCurrentAssets', 'fixedAssets'].includes(k))
      .reduce((s, [, v]) => s + v.value, 0)
    expect(assets).toBe(100_000 * M)
    expect(rest).toBe(100_000 * M)
  })

  test('PL の項目', () => {
    const { pl, operatingCashFlow } = result.periods[1]
    expect(pl.sales.value).toBe(120_000 * M)
    expect(pl.costOfSales.value).toBe(84_000 * M)
    expect(pl.sga.value).toBe(27_000 * M)
    expect(pl.nonOperatingIncome.value).toBe(1_000 * M)
    expect(pl.interestExpense.value).toBe(800 * M)
    expect(pl.otherNonOperatingExpense).toMatchObject({ value: 700 * M, status: 'derived' })
    expect(pl.extraordinaryGain.value).toBe(200 * M)
    expect(pl.extraordinaryLoss.value).toBe(700 * M)
    expect(pl.incomeTaxes.value).toBe(2_400 * M)
    expect(pl.depreciation.value).toBe(4_000 * M)
    expect(operatingCashFlow?.value).toBe(7_000 * M)
  })

  test('前期の値は前期のコンテキストから取る', () => {
    expect(result.periods[0].pl.sales.value).toBe(108_000 * M)
    expect(result.periods[0].bs.cash.value).toBe(9_000 * M)
  })
})

describe('extractFromFacts: 二重計上を避ける', () => {
  test('売掛債権は、合算科目があればそれだけを使い、内訳を足さない', () => {
    const result = extract({
      extraRows: [
        row('NotesReceivableTrade', 'CurrentYearInstant', 3_000),
        row('AccountsReceivableTrade', 'CurrentYearInstant', 12_000),
      ],
    })
    expect(result.periods[1].bs.receivables.value).toBe(15_000 * M)
  })

  test('合算科目と別に電子記録債権の行があれば、足す(その他に紛れない)', () => {
    const result = extract({
      override: { CurrentAssets: [40_000, 36_000] },
      extraRows: [row('ElectronicallyRecordedMonetaryClaimsOperatingCA', 'CurrentYearInstant', 2_000)],
    })
    const bs = result.periods[1].bs
    expect(bs.receivables.value).toBe(17_000 * M)
    expect(bs.receivables.sources).toHaveLength(2)
    expect(bs.otherCurrentAssets.value).toBe(0)
  })

  test('合算科目が無ければ、受取手形・売掛金・電子記録債権を足す', () => {
    const result = extract({
      omit: ['NotesAndAccountsReceivableTrade'],
      extraRows: [
        row('NotesReceivableTrade', 'CurrentYearInstant', 3_000),
        row('AccountsReceivableTrade', 'CurrentYearInstant', 10_000),
        row('ElectronicallyRecordedMonetaryClaimsOperatingCA', 'CurrentYearInstant', 2_000),
      ],
    })
    expect(result.periods[1].bs.receivables.value).toBe(15_000 * M)
    expect(result.periods[1].bs.receivables.confidence).toBe('high')
  })
})

describe('extractFromFacts: 科目が無いとき', () => {
  test('有価証券・借入金が無ければ 0(該当なし)として扱い、確認は求めない', () => {
    const result = extract({
      omit: ['ShortTermInvestmentSecurities', 'BondsPayable', 'LongTermLoansPayable'],
      override: { CurrentAssets: [39_000, 35_100], NoncurrentLiabilities: [10_000, 9_000], Liabilities: [35_000, 31_500], NetAssets: [65_000, 58_500] },
    })
    expect(result.errors).toEqual([])
    expect(result.periods[1].bs.securities).toMatchObject({ value: 0, status: 'notApplicable' })
    expect(result.periods[1].bs.longTermDebt).toMatchObject({ value: 0, status: 'notApplicable' })
    expect(result.needsReview).toBe(false)
  })

  test('現金預金が見つからなければ 0 の仮置きにして、確認を求める', () => {
    const result = extract({ omit: ['CashAndDeposits'] })
    expect(result.periods[1].bs.cash).toMatchObject({ value: 0, status: 'missing' })
    expect(result.needsReview).toBe(true)
    // 現金の分は「その他の流動資産」に回り、貸借は崩れない
    expect(result.periods[1].bs.otherCurrentAssets.value).toBe(12_000 * M)
  })

  test('減価償却費が無ければ 0 の仮置きにして、確認を求める', () => {
    const result = extract({ omit: ['DepreciationAndAmortizationOpeCF'] })
    expect(result.periods[1].pl.depreciation).toMatchObject({ value: 0, status: 'missing' })
    expect(result.needsReview).toBe(true)
  })

  test('営業キャッシュフローが無ければ null(任意項目)', () => {
    const result = extract({ omit: ['NetCashProvidedByUsedInOperatingActivities'] })
    expect(result.periods[1].operatingCashFlow).toBeNull()
    expect(result.needsReview).toBe(false)
  })

  test('販管費が無ければ「売上総利益 − 営業利益」で求め、確認を求める', () => {
    const result = extract({ omit: ['SellingGeneralAndAdministrativeExpenses'] })
    expect(result.periods[1].pl.sga).toMatchObject({ value: 27_000 * M, status: 'derived', confidence: 'medium' })
    expect(result.needsReview).toBe(true)
  })

  test('売上原価が無ければ「売上高 − 売上総利益」で求める', () => {
    const result = extract({ omit: ['CostOfSales'] })
    expect(result.periods[1].pl.costOfSales).toMatchObject({ value: 84_000 * M, status: 'derived', confidence: 'medium' })
  })

  test('営業外費用合計が無ければ、営業利益・営業外収益・利息・経常利益から求める', () => {
    const result = extract({ omit: ['NonOperatingExpenses'] })
    expect(result.periods[1].pl.otherNonOperatingExpense).toMatchObject({
      value: 700 * M,
      status: 'derived',
      confidence: 'medium',
    })
  })

  test('法人税等が無ければ「税引前利益 − 当期純利益」で求める', () => {
    const result = extract({ omit: ['IncomeTaxes'] })
    expect(result.periods[1].pl.incomeTaxes).toMatchObject({ value: 2_400 * M, status: 'derived', confidence: 'medium' })
  })

  test('前期のデータが無ければ当期だけにして、確認事項として知らせる', () => {
    const result = extract({ noPrior: true })
    expect(result.periods).toHaveLength(1)
    expect(result.warnings.some((w) => w.includes('前期'))).toBe(true)
    expect(result.needsReview).toBe(true)
  })
})

describe('extractFromFacts: 反映できないケース(errors)', () => {
  test('資産合計が無ければ読めない', () => {
    const result = extract({ omit: ['Assets'] })
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.periods).toEqual([])
  })

  test('貸借が一致しない(資産 ≠ 負債 + 純資産)なら読めない', () => {
    const result = extract({ override: { Assets: [100_500, 90_000] } })
    expect(result.errors.some((e) => e.includes('貸借'))).toBe(true)
  })

  test('内訳が合計を超える(二重計上の疑い)なら読めない', () => {
    const result = extract({ override: { CurrentAssets: [30_000, 27_000] } })
    expect(result.errors.some((e) => e.includes('流動資産'))).toBe(true)
  })

  test('売上高が無ければ読めない(業種別の様式は未対応)', () => {
    const result = extract({ omit: ['NetSales'] })
    expect(result.errors.some((e) => e.includes('売上高'))).toBe(true)
  })

  test('会計基準が IFRS でも、IFRS の科目が無ければ(日本基準の科目だけなら)読めない', () => {
    const result = extract({ standard: 'IFRS' })
    expect(result.periods).toEqual([])
    expect(result.errors.some((e) => e.includes('資産合計'))).toBe(true)
  })

  test('米国基準など、日本基準以外は未対応', () => {
    expect(extract({ standard: 'US GAAP' }).errors.length).toBeGreaterThan(0)
  })

  test('通期以外(半期・四半期)は未対応', () => {
    const result = extract({ periodType: 'Q3' })
    expect(result.errors.some((e) => e.includes('通期'))).toBe(true)
  })

  test('決算日が読めなければ読めない', () => {
    expect(extract({ currentEnd: '不明' }).errors.length).toBeGreaterThan(0)
  })

  test('同じ科目に異なる値が複数あれば、最初の値を使い、確認事項にする', () => {
    const result = extract({ extraRows: [row('CashAndDeposits', 'CurrentYearInstant', 9_999, '現金及び預金')] })
    expect(result.errors).toEqual([])
    expect(result.warnings.some((w) => w.includes('異なる値'))).toBe(true)
    expect(result.needsReview).toBe(true)
    expect(result.periods[1].bs.cash.value).toBe(10_000 * M)
  })

  test('前期だけ読めないときは、前期を除いて当期だけ返し、知らせる', () => {
    const result = extract({ override: { Assets: [100_000, 95_000] } })
    expect(result.errors).toEqual([])
    expect(result.periods).toHaveLength(1)
    expect(result.warnings.some((w) => w.includes('2024年3月期'))).toBe(true)
  })
})

describe('extractFromFacts: 連結・個別', () => {
  test('連結が無く個別だけなら、個別として読む', () => {
    const result = extract({ individualOnly: true })
    expect(result.errors).toEqual([])
    expect(result.consolidation).toBe('individual')
    expect(result.periods).toHaveLength(2)
  })

  test('連結と個別の両方があれば、連結を使う', () => {
    const individual = fixtureRows({ individualOnly: true }).filter((r) => r.contextId.includes('NonConsolidated'))
    const parsed = parseEdinetCsv(
      buildCsvText([...fixtureRows(), ...individual.map((r) => ({ ...r, value: String(Number(r.value) / 2) }))]),
      100_000,
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    const result = extractFromFacts(parsed.facts, parsed.info)
    expect(result.consolidation).toBe('consolidated')
    expect(result.periods[1].bs.cash.value).toBe(10_000 * M)
  })
})

describe('extractFromFacts: 利益の突き合わせ', () => {
  test('書類の経常利益と、取り込んだ項目から計算した値が合わなければ確認事項にする', () => {
    const result = extract({ override: { OrdinaryIncome: [8_900, 8_010] } })
    expect(result.warnings.some((w) => w.includes('経常利益'))).toBe(true)
    expect(result.needsReview).toBe(true)
  })

  test('百万円単位の丸め(1 百万円のずれ)は許容する', () => {
    const result = extract({ override: { GrossProfit: [36_001, 32_400] } })
    expect(result.warnings).toEqual([])
  })

  test('百万円単位で表示された書類で、大きなずれがあれば警告する', () => {
    const result = extract({ override: { GrossProfit: [36_500, 32_400] } })
    expect(result.warnings.some((w) => w.includes('売上総利益'))).toBe(true)
  })
})

describe('extractFromFacts: 取りこぼしを黙って流さない', () => {
  test('流動資産の「有価証券」(SecuritiesCA)も取る', () => {
    const result = extract({
      omit: ['ShortTermInvestmentSecurities'],
      extraRows: [row('SecuritiesCA', 'CurrentYearInstant', 1_000, '有価証券')],
    })
    expect(result.periods[1].bs.securities).toMatchObject({ value: 1_000 * M, status: 'found' })
  })

  test('有利子負債があるのに支払利息が無ければ、0 の仮置きにして確認を求める', () => {
    const result = extract({ omit: ['InterestExpensesNOE'] })
    expect(result.periods[1].pl.interestExpense).toMatchObject({ value: 0, status: 'missing' })
    expect(result.needsReview).toBe(true)
  })

  test('棚卸資産を内訳の合計で出したときは、確認を求める(内訳の取りこぼしの余地)', () => {
    const result = extract({
      omit: ['Inventories'],
      extraRows: [
        row('MerchandiseAndFinishedGoods', 'CurrentYearInstant', 9_000),
        row('RawMaterials', 'CurrentYearInstant', 3_000),
      ],
    })
    expect(result.periods[1].bs.inventory).toMatchObject({ value: 12_000 * M, confidence: 'medium' })
    expect(result.needsReview).toBe(true)
  })

  test('貸借の差が丸めの範囲(百万円単位で 1 単位)なら、そのまま読み込み、知らせるだけにする(確認は求めない)', () => {
    const result = extract({ override: { Assets: [100_001, 90_000] } })
    expect(result.errors).toEqual([])
    expect(result.notes.some((n) => n.includes('丸め'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('丸め'))).toBe(false)
    expect(result.needsReview).toBe(false)
  })

  test('書類に利益の科目が 1 つも見つからなければ、突き合わせできなかったと知らせる', () => {
    const result = extract({
      omit: ['GrossProfit', 'OperatingIncome', 'OrdinaryIncome', 'IncomeBeforeIncomeTaxes', 'ProfitLoss'],
      override: {},
    })
    // 営業利益・経常利益が無いと販管費・営業外費用が逆算できないので、別の経路の項目も使う
    expect(result.warnings.some((w) => w.includes('突き合わせできません'))).toBe(true)
  })

  test('赤字(負の営業利益)の書類も読め、突き合わせが通る', () => {
    const result = extract({
      override: {
        SellingGeneralAndAdministrativeExpenses: [40_000, 36_000],
        OperatingIncome: [-4_000, -3_600],
        OrdinaryIncome: [-4_500, -4_050],
        IncomeBeforeIncomeTaxes: [-5_000, -4_500],
        IncomeTaxes: [100, 90],
        ProfitLoss: [-5_100, -4_590],
      },
    })
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.periods[1].pl.sga.value).toBe(40_000 * M)
  })
})

describe('extractFromFacts: 注記', () => {
  test('リース債務は有利子負債に含めず、参考として知らせる', () => {
    const result = extract({
      extraRows: [
        row('LeaseObligationsCL', 'CurrentYearInstant', 500, 'リース債務(流動)'),
        row('LeaseObligationsNCL', 'CurrentYearInstant', 1_500, 'リース債務(固定)'),
      ],
    })
    expect(result.notes.some((n) => n.includes('リース債務'))).toBe(true)
    expect(result.periods[1].bs.longTermDebt.value).toBe(20_000 * M)
  })

  test('非支配株主持分があれば、純資産・純利益に含まれることを知らせる', () => {
    const result = extract({
      extraRows: [row('NonControllingInterests', 'CurrentYearInstant', 2_000, '非支配株主持分')],
    })
    expect(result.notes.some((n) => n.includes('非支配株主'))).toBe(true)
  })
})

describe('extractFromFacts: 今期から連結を作り始めた会社', () => {
  /** 当期は連結、前期は単体の数字だけがある書類(連結の前期が無い) */
  function firstConsolidated() {
    const current = fixtureRows({ noPrior: true })
    const priorIndividual = fixtureRows({ individualOnly: true }).filter((r) => r.contextId.startsWith('Prior1Year'))
    const parsed = parseEdinetCsv(buildCsvText([...current, ...priorIndividual]), 100_000)
    if (!parsed.ok) throw new Error(parsed.reason)
    return extractFromFacts(parsed.facts, parsed.info)
  }

  test('当期(連結)だけを取り込み、前期が単体であることと、並べると増減が大きく見えることを知らせる', () => {
    const result = firstConsolidated()
    expect(result.errors).toEqual([])
    expect(result.consolidation).toBe('consolidated')
    expect(result.periods.map((p) => p.label)).toEqual(['2025年3月期'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('今期から連結財務諸表を作り始めた')
    expect(result.warnings[0]).toContain('2024年3月期')
    expect(result.warnings[0]).toContain('切り替わりの前後の増減')
    expect(result.needsReview).toBe(true)
  })

  test('前期の単体の数字も無いときは、これまでの文章(前期のデータが書類にありません)のまま', () => {
    const result = extract({ noPrior: true })
    expect(result.warnings).toEqual(['前期(2024年3月期)のデータが書類にありません。当期だけを取り込みます。'])
  })
})

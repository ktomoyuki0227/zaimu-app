import { describe, expect, test } from 'vitest'
import { COMPARE_UNIT, MAX_COMPARE, axisOf, compareCompanies, reasonShort, toMillions } from './compare'
import { basePeriod } from './fixtures'
import type { AmountUnit, Basis, BalanceSheetInput, Company, IncomeStatementInput, PeriodData } from './types'

// 基準データ: 売上高 1000 / 営業利益 100(営業利益率 10%)/ 当期純利益 50 / 総資産 1000 / 純資産 500(自己資本比率 50%)

interface Spec {
  readonly id: string
  readonly unit?: AmountUnit
  readonly label?: string
  readonly basis?: Basis
  readonly pl?: Partial<IncomeStatementInput>
  readonly bs?: Partial<BalanceSheetInput>
  /** 前の期(あれば、2 期分の企業になる) */
  readonly previous?: Partial<IncomeStatementInput>
}

function period(label: string, basis: Basis | undefined, pl: Partial<IncomeStatementInput>, bs: Partial<BalanceSheetInput>): PeriodData {
  return { ...basePeriod, label, ...(basis === undefined ? {} : { basis }), pl: { ...basePeriod.pl, ...pl }, bs: { ...basePeriod.bs, ...bs } }
}

function company(spec: Spec): Company {
  const label = spec.label ?? '2025年3月期'
  const latest = period(label, spec.basis, spec.pl ?? {}, spec.bs ?? {})
  const periods = spec.previous === undefined ? [latest] : [period('2024年3月期', spec.basis, spec.previous, {}), latest]
  return { id: spec.id, name: `${spec.id}社`, ...(spec.unit === undefined ? {} : { unit: spec.unit }), periods }
}

const A = company({ id: 'A', unit: '百万円' })
const B = company({ id: 'B', unit: '百万円', pl: { sales: 500 } }) // 営業利益 = 500 − 600 − 300 = −400

describe('compareCompanies: 比べる企業', () => {
  test('2 社に満たなければ null(比べるものが無い)', () => {
    expect(compareCompanies([])).toBeNull()
    expect(compareCompanies([A])).toBeNull()
    expect(compareCompanies([A, B])).not.toBeNull()
  })

  test('企業の並びは、渡した順のまま。上限(6 社)を超える分は無視する', () => {
    const many = Array.from({ length: MAX_COMPARE + 2 }, (_, i) => company({ id: `C${i}`, unit: '百万円' }))
    const result = compareCompanies(many)
    expect(result?.columns).toHaveLength(MAX_COMPARE)
    expect(result?.columns.map((c) => c.id)).toEqual(many.slice(0, MAX_COMPARE).map((c) => c.id))
    expect(compareCompanies([B, A])?.columns.map((c) => c.id)).toEqual(['B', 'A'])
  })

  test('列の情報: 企業名・最新の期・範囲・単位', () => {
    const c = company({ id: 'X', unit: '千円', label: '2024年12月期', basis: 'consolidated' })
    expect(compareCompanies([c, A])?.columns[0]).toEqual({
      id: 'X',
      name: 'X社',
      label: '2024年12月期',
      basis: 'consolidated',
      unit: '千円',
    })
  })
})

describe('compareCompanies: 金額は百万円にそろえる', () => {
  test('単位の違う企業の金額を、百万円に直して並べる', () => {
    expect(COMPARE_UNIT).toBe('百万円')
    const inThousand = company({ id: 'T', unit: '千円', pl: { sales: 2_000_000, costOfSales: 1_200_000, sga: 600_000 } })
    const inYen = company({ id: 'Y', unit: '円', pl: { sales: 5_000_000, costOfSales: 3_000_000, sga: 1_500_000 } })
    const result = compareCompanies([A, inThousand, inYen])
    const sales = result?.amountRows.find((r) => r.key === 'sales')
    // 1000 百万円 / 2,000,000 千円 = 2000 百万円 / 5,000,000 円 = 5 百万円
    expect(sales?.values).toEqual([1000, 2000, 5])
    // 営業利益: 100 百万円 / (2,000,000 − 1,200,000 − 600,000) 千円 = 200 百万円 / 500,000 円 = 0.5 百万円
    expect(result?.amountRows.find((r) => r.key === 'operatingProfit')?.values).toEqual([100, 200, 0.5])
  })

  test('単位の記録が無い企業の金額は null(0 にしない)。比率はそのまま比べられる', () => {
    const noUnit = company({ id: 'N' })
    const result = compareCompanies([A, noUnit])
    // 単位の分からない企業(2 列目)は、すべての金額が null。単位のある企業(1 列目)は、基準データの金額(キャッシュフローは、書類に無いので null)
    expect(result?.amountRows.map((r) => r.values[1])).toEqual(Array(8).fill(null))
    expect(result?.amountRows.map((r) => [r.key, r.values[0]])).toEqual([
      ['sales', 1000],
      ['operatingProfit', 100],
      ['netIncome', 50],
      ['totalAssets', 1000],
      ['operatingCashFlow', null],
      ['investingCashFlow', null],
      ['financingCashFlow', null],
      ['freeCashFlow', null],
    ])
    expect(result?.metricRows.find((r) => r.key === 'operatingMargin')?.cells[1].value).toBeCloseTo(10)
  })

  test('キャッシュフローは、3 区分とフリー(営業 + 投資)。書類に無い区分は null', () => {
    const withCf = company({ id: 'F', unit: '百万円', pl: { operatingCashFlow: 300, investingCashFlow: -120, financingCashFlow: -50 } })
    const partial = company({ id: 'P', unit: '百万円', pl: { operatingCashFlow: 80 } })
    const rows = (key: string) => compareCompanies([withCf, partial])?.amountRows.find((r) => r.key === key)?.values
    expect(rows('operatingCashFlow')).toEqual([300, 80])
    expect(rows('investingCashFlow')).toEqual([-120, null])
    expect(rows('financingCashFlow')).toEqual([-50, null])
    expect(rows('freeCashFlow')).toEqual([180, null])
  })

  test('toMillions: 単位ごとに換算する。単位が分からなければ null', () => {
    expect(toMillions(1, '百万円')).toBe(1)
    expect(toMillions(1_000, '千円')).toBe(1)
    expect(toMillions(1_000_000, '円')).toBe(1)
    expect(toMillions(5, undefined)).toBeNull()
  })

  test('お金の流れの型: 3 区分がそろった企業だけ。そろわなければ null', () => {
    const full = company({ id: 'F', unit: '百万円', pl: { operatingCashFlow: 300, investingCashFlow: -120, financingCashFlow: -50 } })
    expect(compareCompanies([full, A])?.patterns).toEqual(['安定した型', null])
  })
})

describe('compareCompanies: 指標の比較と、最も良い値', () => {
  const row = (result: ReturnType<typeof compareCompanies>, key: string) => result?.metricRows.find((r) => r.key === key)

  test('大きいほど良い指標(営業利益率)は、最大が「最良」', () => {
    const high = company({ id: 'H', unit: '百万円', pl: { sales: 1000, costOfSales: 500 } }) // 営業利益 200(20%)
    const result = compareCompanies([A, high])
    const r = row(result, 'operatingMargin')
    expect(r?.direction).toBe('higher')
    expect(r?.cells.map((c) => c.best)).toEqual([false, true])
    expect(r?.cells[0].value).toBeCloseTo(10)
    expect(r?.cells[1].value).toBeCloseTo(20)
  })

  test('小さいほど良い指標(負債比率)は、最小が「最良」', () => {
    const lowDebt = company({ id: 'L', unit: '百万円', bs: { equity: 800, otherCurrentLiabilities: 0, otherFixedLiabilities: 0, fixedAssets: 800 } })
    const r = row(compareCompanies([A, lowDebt]), 'debtToEquity')
    expect(r?.direction).toBe('lower')
    expect(r?.cells.map((c) => c.best)).toEqual([false, true])
  })

  test('最も良い値が複数あれば、すべて「最良」。表の桁で同じに見える値も、同じ扱い', () => {
    const high = company({ id: 'H', unit: '百万円', pl: { sales: 1000, costOfSales: 500 } }) // 20%
    const tied = compareCompanies([A, company({ id: 'S', unit: '百万円' }), high, company({ id: 'T', unit: '百万円', pl: { sales: 1000, costOfSales: 500 } })])
    expect(row(tied, 'operatingMargin')?.cells.map((c) => c.best)).toEqual([false, false, true, true])
    // 10.00% と 10.04%(小数 1 桁では、どちらも 10.0%)と、20%
    const almost = company({ id: 'W', unit: '百万円', pl: { sales: 1000, costOfSales: 599.6 } })
    expect(row(compareCompanies([A, almost, high]), 'operatingMargin')?.cells.map((c) => c.best)).toEqual([false, false, true])
  })

  test('全員が同じ値なら、優劣が付かないので、だれにも「最良」を付けない(小さいほど良い指標も同じ)', () => {
    const same = compareCompanies([A, company({ id: 'S', unit: '百万円' })])
    expect(row(same, 'operatingMargin')?.cells.map((c) => c.best)).toEqual([false, false])
    expect(row(same, 'debtToEquity')?.cells.map((c) => c.best)).toEqual([false, false])
  })

  test('小さいほど良い指標で、最小が複数あれば、すべて「最良」', () => {
    const lowDebt = () => company({ id: 'L', unit: '百万円', bs: { equity: 800, otherCurrentLiabilities: 0, otherFixedLiabilities: 0, fixedAssets: 800 } })
    const r = row(compareCompanies([A, lowDebt(), { ...lowDebt(), id: 'M' }]), 'debtToEquity')
    expect(r?.cells.map((c) => c.best)).toEqual([false, true, true])
  })

  test('全員が「要注意」の行では、いちばんましな値にも「最良」を付けない(良い値のように見えないように)', () => {
    const r = row(compareCompanies([company({ id: 'D1', unit: '百万円', pl: { sales: 700 } }), company({ id: 'D2', unit: '百万円', pl: { sales: 800 } })]), 'operatingMargin')
    expect(r?.cells.map((c) => c.level)).toEqual(['danger', 'danger'])
    expect(r?.cells.map((c) => c.best)).toEqual([false, false])
  })

  test('「要注意」でなければ、目安に届いていなくても、行でいちばん良い値に「最良」を付ける', () => {
    // 営業利益率 0%(注意)と、−80%(要注意)
    const r = row(compareCompanies([company({ id: 'W', unit: '百万円', pl: { sales: 900 } }), B]), 'operatingMargin')
    expect(r?.cells.map((c) => c.level)).toEqual(['caution', 'danger'])
    expect(r?.cells.map((c) => c.best)).toEqual([true, false])
  })

  test('利息が無くて算出できないインタレスト・カバレッジは、最も良い状態として、「最良」にする(企業数に依らない)', () => {
    const noInterest = company({ id: 'X', unit: '百万円', pl: { interestExpense: 0 } })
    const five = company({ id: 'Y', unit: '百万円', pl: { interestExpense: 20 } }) // 営業利益 100 ÷ 20 = 5 倍
    const two = company({ id: 'Z', unit: '百万円', pl: { interestExpense: 50 } }) // 2 倍
    const three = row(compareCompanies([noInterest, five, two]), 'interestCoverage')
    expect(three?.cells[0]).toMatchObject({ value: null, reason: 'noInterest', level: 'good', best: true })
    expect(three?.cells.map((c) => c.best)).toEqual([true, false, false])
    expect(row(compareCompanies([noInterest, five]), 'interestCoverage')?.cells.map((c) => c.best)).toEqual([true, false])
    // 利息の無い企業どうしは、同じ(優劣なし)
    expect(row(compareCompanies([noInterest, { ...noInterest, id: 'X2' }]), 'interestCoverage')?.cells.map((c) => c.best)).toEqual([false, false])
  })

  test('3 つの軸は、並びではなく、名前で引く', () => {
    const axes = compareCompanies([A, B])?.axes[0] ?? []
    expect(axisOf(axes, 'stability').key).toBe('stability')
    expect(axisOf([...axes].reverse(), 'growth').key).toBe('growth')
    expect(() => axisOf([], 'growth')).toThrow('判定がありません')
  })

  test('数字のある企業が 1 社だけなら、比べられないので「最良」を付けない', () => {
    // 債務超過(純資産 0)の企業は、ROE を算出できない
    const insolvent = company({ id: 'I', unit: '百万円', bs: { equity: 0, otherFixedLiabilities: 500 } })
    const r = row(compareCompanies([A, insolvent]), 'roe')
    expect(r?.cells[1]).toMatchObject({ value: null, reason: 'insolvent', level: 'danger', best: false })
    expect(r?.cells[0].best).toBe(false)
  })

  test('目安に照らした評価も、企業ごとに付く', () => {
    const r = row(compareCompanies([A, B]), 'operatingMargin')
    expect(r?.cells.map((c) => c.level)).toEqual(['good', 'danger'])
  })

  test('全指標を、収益性・安定性の順に、カタログのとおり並べる', () => {
    const rows = compareCompanies([A, B])?.metricRows ?? []
    expect(rows).toHaveLength(16)
    expect(rows[0].key).toBe('grossMargin')
    expect(rows[0].direction).toBe('higher') // 目安が無い指標は、大きいほど良いとする
    expect(new Set(rows.map((r) => r.group))).toEqual(new Set(['profitability', 'stability']))
  })

  test('算出できなかった理由の短い言い方', () => {
    expect(reasonShort('insolvent')).toBe('債務超過')
    expect(reasonShort('cashFlowShortfall')).toBe('返済不能')
    expect(reasonShort('noInterest')).toBe('利息なし')
    expect(reasonShort('noDenominator')).toBe('算出不可')
  })
})

describe('compareCompanies: 成長性と判定', () => {
  test('売上高・営業利益の前期比。前期が無い企業、範囲が切り替わった企業は null', () => {
    const grew = company({ id: 'G', unit: '百万円', previous: { sales: 800, costOfSales: 480, sga: 240 } }) // 前期の営業利益 80
    const switched: Company = {
      id: 'W',
      name: 'W社',
      unit: '百万円',
      periods: [period('2024年3月期', 'individual', { sales: 800 }, {}), period('2025年3月期', 'consolidated', {}, {})],
    }
    const result = compareCompanies([grew, A, switched])
    expect(result?.growthRows.find((r) => r.key === 'salesGrowth')?.values).toEqual([25, null, null])
    expect(result?.growthRows.find((r) => r.key === 'operatingProfitGrowth')?.values).toEqual([25, null, null])
  })

  test('3 つの軸の判定を、企業ごとに持つ', () => {
    const result = compareCompanies([A, B])
    expect(result?.axes).toHaveLength(2)
    expect(result?.axes[0].map((a) => a.key)).toEqual(['growth', 'profitability', 'stability'])
    expect(result?.axes[1][1].verdict).toBe('danger')
  })
})

describe('compareCompanies: 比べるときの注意', () => {
  test('そろっていれば、注意は無い', () => {
    expect(compareCompanies([A, company({ id: 'S', unit: '千円' })])?.notices).toEqual([])
  })

  test('最新の期が違う: 企業ごとの期を並べて、単純には比べられないと伝える', () => {
    const notices = compareCompanies([A, company({ id: 'D', unit: '百万円', label: '2024年12月期' })])?.notices ?? []
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('A社: 2025年3月期')
    expect(notices[0]).toContain('D社: 2024年12月期')
  })

  test('連結と単体が混ざる: どちらかを企業ごとに書く。範囲が分からない企業は、混ざりとは数えない', () => {
    const mixed = compareCompanies([
      company({ id: 'C', unit: '百万円', basis: 'consolidated' }),
      company({ id: 'I', unit: '百万円', basis: 'individual' }),
      A,
    ])
    expect(mixed?.notices).toHaveLength(1)
    expect(mixed?.notices[0]).toContain('C社: 連結')
    expect(mixed?.notices[0]).toContain('I社: 単体')
    expect(mixed?.notices[0]).not.toContain('A社')
    const sameBasis = compareCompanies([company({ id: 'C', unit: '百万円', basis: 'consolidated' }), A])
    expect(sameBasis?.notices).toEqual([])
  })

  test('単位の記録が無い企業: 金額の行を「—」にしたと伝える', () => {
    const notices = compareCompanies([A, company({ id: 'N' }), company({ id: 'M' })])?.notices ?? []
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('N社、M社')
    expect(notices[0]).toContain('金額の単位の記録が無い')
  })
})

import { describe, expect, test } from 'vitest'
import { basePeriod } from './fixtures'
import { summarize } from './overview'
import type { Company, PeriodData } from './types'

function company(periods: readonly PeriodData[], unit?: Company['unit']): Company {
  return { id: 't', name: 'テスト社', periods, ...(unit === undefined ? {} : { unit }) }
}

function withEquity(period: PeriodData, equity: number): PeriodData {
  return { ...period, bs: { ...period.bs, equity } }
}

function withPl(period: PeriodData, pl: Partial<PeriodData['pl']>): PeriodData {
  return { ...period, pl: { ...period.pl, ...pl } }
}

describe('summarize: 軸ごとの判定', () => {
  test('目安をすべてクリアする会社は、収益性・安定性とも good', () => {
    const o = summarize(company([basePeriod]))
    const profitability = o.axes.find((a) => a.key === 'profitability')
    const stability = o.axes.find((a) => a.key === 'stability')
    expect(profitability?.verdict).toBe('good')
    expect(stability?.verdict).toBe('good')
    expect(profitability?.counts).toMatchObject({ caution: 0, danger: 0 })
    expect(profitability?.counts?.good).toBeGreaterThan(0)
  })

  test('要注意の指標が 1 つでもあれば、その軸は danger', () => {
    // 自己資本が小さく、自己資本比率 5%(< 10%)になる
    const o = summarize(company([withEquity(basePeriod, 50)]))
    const stability = o.axes.find((a) => a.key === 'stability')
    expect(stability?.verdict).toBe('danger')
    expect(stability?.counts?.danger).toBeGreaterThan(0)
  })

  test('注意だけなら caution', () => {
    // 営業利益 80(利益率 8% は良好)だが、純利益 30 で ROA 3%(5% 未満・1% 以上)・ROE 6% → 注意
    const period = withPl(basePeriod, { sga: 320 })
    const o = summarize(company([period]))
    const profitability = o.axes.find((a) => a.key === 'profitability')
    expect(profitability?.counts?.danger).toBe(0)
    expect(profitability?.counts?.caution).toBeGreaterThan(0)
    expect(profitability?.verdict).toBe('caution')
  })

  test('軸は 成長性・収益性・安定性 の順に並ぶ', () => {
    expect(summarize(company([basePeriod])).axes.map((a) => a.key)).toEqual([
      'growth',
      'profitability',
      'stability',
    ])
  })
})

describe('summarize: 成長性', () => {
  test('1 期だけなら、判定不能(unknown)', () => {
    const growth = summarize(company([basePeriod])).axes[0]
    expect(growth.verdict).toBe('unknown')
    expect(growth.growth).toBeNull()
  })

  test('増収増益は good、増収減益は caution、減収減益は danger', () => {
    const up = withPl(basePeriod, { sales: 1200, costOfSales: 700 })
    const sgaUp = withPl(basePeriod, { sales: 1200, costOfSales: 720, sga: 400 })
    const down = withPl(basePeriod, { sales: 800, costOfSales: 600, sga: 300 })
    expect(summarize(company([basePeriod, up])).axes[0]).toMatchObject({
      verdict: 'good',
      growth: { pattern: '増収増益' },
    })
    expect(summarize(company([basePeriod, sgaUp])).axes[0]).toMatchObject({
      verdict: 'caution',
      growth: { pattern: '増収減益' },
    })
    expect(summarize(company([basePeriod, down])).axes[0]).toMatchObject({
      verdict: 'danger',
      growth: { pattern: '減収減益' },
    })
  })

  test('増減率の数値(売上高・営業利益)を返す', () => {
    const up = withPl(basePeriod, { sales: 1200, costOfSales: 700 })
    const g = summarize(company([basePeriod, up])).axes[0].growth
    expect(g?.salesGrowth).toBeCloseTo(20)
    expect(g?.operatingProfitGrowth).toBeCloseTo(100) // 100 → 200
  })
})

describe('summarize: 気をつけたい点', () => {
  test('問題のない会社は、気をつけたい点なし', () => {
    expect(summarize(company([basePeriod])).concerns).toEqual([])
  })

  test('要注意が注意より先に並び、最大 3 件まで', () => {
    const o = summarize(company([withEquity(withPl(basePeriod, { sga: 320 }), 50)]))
    expect(o.concerns.length).toBeLessThanOrEqual(3)
    expect(o.concerns[0].level).toBe('danger')
    const levels = o.concerns.map((c) => c.level)
    expect(levels).toEqual([...levels].sort((a, b) => (a === b ? 0 : a === 'danger' ? -1 : 1)))
  })

  test('算出できない理由(債務超過)は、理由つきで要注意になる', () => {
    const o = summarize(company([withEquity(basePeriod, -10)]), 20)
    const roe = o.concerns.find((c) => c.key === 'roe')
    expect(roe).toMatchObject({ level: 'danger', value: null, reason: 'insolvent' })
  })

  test('同じ段階の中では、目安から遠い指標を先に出す', () => {
    // 自己資本比率 25%(目安 30% に -5pt、相対 -17%)と、営業利益率 4%(目安 5% に -1pt、相対 -20%)
    const period = withEquity(withPl(basePeriod, { sga: 360 }), 250)
    const o = summarize(company([period]), 10)
    const cautionKeys = o.concerns.filter((c) => c.level === 'caution').map((c) => c.key)
    expect(cautionKeys.indexOf('operatingMargin')).toBeLessThan(cautionKeys.indexOf('equityRatio'))
  })

  test('件数の上限を指定できる', () => {
    const o = summarize(company([withEquity(withPl(basePeriod, { sga: 320 }), 50)]), 1)
    expect(o.concerns).toHaveLength(1)
  })
})

describe('summarize: 主要な数字', () => {
  test('売上高・営業利益率・自己資本比率・ROE を、当期と前期で返す', () => {
    const up = withPl(basePeriod, { sales: 1200, costOfSales: 700 })
    const o = summarize(company([basePeriod, up], '百万円'))
    expect(o.kpis.map((k) => k.id)).toEqual(['sales', 'operatingMargin', 'equityRatio', 'roe'])
    const sales = o.kpis[0]
    expect(sales).toMatchObject({ value: 1200, previous: 1000, unit: '百万円' })
    const margin = o.kpis[1]
    expect(margin.value).toBeCloseTo(100 / 6, 1) // 200 / 1200
    expect(margin.previous).toBeCloseTo(10)
  })

  test('1 期だけなら previous は null。単位が無い会社の売上高の単位は空', () => {
    const o = summarize(company([basePeriod]))
    expect(o.kpis[0]).toMatchObject({ value: 1000, previous: null, unit: '' })
    expect(o.previousLabel).toBeNull()
  })

  test('最新期・前期の名前を返す', () => {
    const o = summarize(company([withPl(basePeriod, {}), { ...basePeriod, label: '次期' }]))
    expect(o.latestLabel).toBe('次期')
    expect(o.previousLabel).toBe('基準期')
  })
})

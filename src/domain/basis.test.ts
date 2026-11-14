import { describe, expect, test } from 'vitest'
import {
  basisChangeLabels,
  basisChangeNote,
  basisLabel,
  basisSummary,
  hasMixedBasis,
  isBasisChange,
  periodHeading,
} from './basis'
import { basePeriod } from './fixtures'
import { buildGrowthSeries } from './growth'
import { growthInsights } from './insights'
import { summarize } from './overview'
import type { Basis, Company, PeriodData } from './types'

function period(label: string, basis: Basis | undefined, sales = 1000): PeriodData {
  return { ...basePeriod, label, ...(basis === undefined ? {} : { basis }), pl: { ...basePeriod.pl, sales } }
}

/** 2022〜2024 年は単体、2025 年から連結(情報戦略テクノロジーと同じ形) */
const SWITCHED = [
  period('2022年12月期', 'individual', 5000),
  period('2023年12月期', 'individual', 5300),
  period('2024年12月期', 'individual', 5800),
  period('2025年12月期', 'consolidated', 8000),
]

describe('範囲(連結・単体)の判定', () => {
  test('名前', () => {
    expect(basisLabel('consolidated')).toBe('連結')
    expect(basisLabel('individual')).toBe('単体')
  })

  test('連結と単体の間だけが「切り替わり」。同じ範囲どうしや、範囲が分からない期は、切り替わりとみなさない', () => {
    expect(isBasisChange(SWITCHED[2], SWITCHED[3])).toBe(true)
    expect(isBasisChange(SWITCHED[0], SWITCHED[1])).toBe(false)
    expect(isBasisChange(period('A', undefined), period('B', 'consolidated'))).toBe(false)
    expect(isBasisChange(period('A', 'individual'), period('B', undefined))).toBe(false)
  })

  test('切り替わる期の名前と、混在の有無', () => {
    expect(basisChangeLabels(SWITCHED)).toEqual(['2025年12月期'])
    expect(hasMixedBasis(SWITCHED)).toBe(true)
    expect(hasMixedBasis(SWITCHED.slice(0, 3))).toBe(false)
    expect(hasMixedBasis([period('A', undefined)])).toBe(false)
  })

  test('範囲の要約: 続く期はまとめて、「〜」でつなぐ', () => {
    expect(basisSummary(SWITCHED)).toBe('2022年12月期〜2024年12月期は単体、2025年12月期は連結')
    expect(basisSummary([period('2025年12月期', 'consolidated')])).toBe('2025年12月期は連結')
    expect(basisSummary([period('A', undefined)])).toBeNull()
  })

  test('表の見出し: 混在する会社だけ、範囲を添える', () => {
    expect(periodHeading(SWITCHED[3], true)).toBe('2025年12月期(連結)')
    expect(periodHeading(SWITCHED[3], false)).toBe('2025年12月期')
    expect(periodHeading(period('A', undefined), true)).toBe('A')
  })

  test('説明の文に、前期と当期の範囲と、増減を計算していないことを書く', () => {
    const note = basisChangeNote(SWITCHED[2], SWITCHED[3])
    expect(note).toContain('前期(2024年12月期)は単体')
    expect(note).toContain('2025年12月期は連結')
    expect(note).toContain('増減は計算していません')
  })
})

describe('切り替わりの前後は、増減を計算しない', () => {
  test('成長率: 切り替わる期は、すべて null(連結の 8000 と単体の 5800 から、+38% を出さない)。ほかの期は計算する', () => {
    const series = buildGrowthSeries(SWITCHED)
    expect(series.map((g) => g.label)).toEqual(['2023年12月期', '2024年12月期', '2025年12月期'])
    expect(series[0].sales).toBeCloseTo(6)
    expect(series[2]).toEqual({
      label: '2025年12月期',
      sales: null,
      grossProfit: null,
      operatingProfit: null,
      ordinaryProfit: null,
      netIncome: null,
    })
  })

  test('範囲が分からない(古いデータ)期は、これまでどおり計算する', () => {
    const series = buildGrowthSeries([period('A', undefined, 100), period('B', undefined, 150)])
    expect(series[0].sales).toBeCloseTo(50)
  })

  test('読み解き: 範囲が違うと、増減の判定の代わりに、比べられない理由だけを返す', () => {
    expect(growthInsights(SWITCHED[2], SWITCHED[3])).toEqual([basisChangeNote(SWITCHED[2], SWITCHED[3])])
    expect(growthInsights(SWITCHED[0], SWITCHED[1])[0]).toContain('増収')
  })

  test('概要: 成長性は判定せず(unknown)、理由を添える。売上高・利益率の前期との差も出さない', () => {
    const company: Company = { id: 'x', name: 'x', unit: '百万円', periods: SWITCHED }
    const overview = summarize(company)
    const growth = overview.axes.find((a) => a.key === 'growth')
    expect(growth?.verdict).toBe('unknown')
    expect(growth?.growth).toBeNull()
    expect(growth?.note).toBe(basisChangeNote(SWITCHED[2], SWITCHED[3]))
    expect(overview.kpis.every((k) => k.previous === null)).toBe(true)
    // 収益性・安定性は、当期だけの評価なので、そのまま出す
    expect(overview.axes.find((a) => a.key === 'profitability')?.note).toBeNull()
  })

  test('概要: 切り替わりの無い会社は、これまでどおり前期と比べる', () => {
    const company: Company = { id: 'x', name: 'x', unit: '百万円', periods: SWITCHED.slice(0, 3) }
    const overview = summarize(company)
    expect(overview.axes.find((a) => a.key === 'growth')?.growth).not.toBeNull()
    expect(overview.kpis[0].previous).toBe(5300)
  })
})

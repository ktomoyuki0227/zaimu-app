import { describe, expect, test } from 'vitest'
import { basePeriod } from './fixtures'
import { growthInsights } from './insights'
import type { PeriodData } from './types'

function variant(label: string, sales: number, costOfSales: number, sga: number): PeriodData {
  return { ...basePeriod, label, pl: { ...basePeriod.pl, sales, costOfSales, sga } }
}

describe('growthInsights', () => {
  test('増収増益のとき、パターンと営業利益率の改善・内訳を文章で返す', () => {
    // 売上 1000→1200(+20%)、営業利益 100→170(+70%)、営業利益率 10.0%→14.2%
    const lines = growthInsights(basePeriod, variant('2期', 1200, 700, 330))
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('増収増益')
    expect(lines[0]).toContain('+20.0%')
    expect(lines[0]).toContain('+70.0%')
    expect(lines[1]).toContain('改善')
    expect(lines[1]).toContain('10.0%')
    expect(lines[1]).toContain('14.2%')
    expect(lines[2]).toContain('売上総利益率 +1.7pt')
    expect(lines[2]).toContain('販管費率 -2.5pt')
  })

  test('増収減益のとき、営業利益率の悪化を伝える', () => {
    // 売上 1000→1200、営業利益 100→60
    const lines = growthInsights(basePeriod, variant('2期', 1200, 840, 300))
    expect(lines[0]).toContain('増収減益')
    expect(lines[1]).toContain('悪化')
  })

  test('営業利益率がほぼ変わらないときは横ばいと伝える', () => {
    // 売上が 2 倍で、原価・販管費も 2 倍 → 利益率は同じ
    const lines = growthInsights(basePeriod, variant('2期', 2000, 1200, 600))
    expect(lines[1]).toContain('横ばい')
  })

  test('前期の売上が 0 で比較できないときは文章を返さない', () => {
    const zero = variant('前期', 0, 0, 0)
    expect(growthInsights(zero, basePeriod)).toEqual([])
  })
})

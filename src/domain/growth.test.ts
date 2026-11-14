import { describe, expect, test } from 'vitest'
import { basePeriod } from './fixtures'
import {
  buildGrowthSeries,
  classifyGrowthPattern,
  commonSizePl,
  growthRate,
  profitBridge,
} from './growth'
import type { PeriodData } from './types'

/** 基準期から売上・原価・販管費だけ変えた期を作る */
function variant(label: string, sales: number, costOfSales: number, sga: number): PeriodData {
  return { ...basePeriod, label, pl: { ...basePeriod.pl, sales, costOfSales, sga } }
}

describe('growthRate', () => {
  test('前期比の増減率(%)', () => {
    expect(growthRate(100, 120)).toBeCloseTo(20)
    expect(growthRate(100, 80)).toBeCloseTo(-20)
  })

  test('前期が 0 なら null', () => {
    expect(growthRate(0, 50)).toBeNull()
  })

  test('前期が赤字でも、改善なら正の増減率になる(分母は絶対値)', () => {
    expect(growthRate(-100, -50)).toBeCloseTo(50)
    expect(growthRate(-100, 50)).toBeCloseTo(150)
  })
})

describe('buildGrowthSeries', () => {
  const p1 = basePeriod // 売上1000 営業利益100
  const p2 = variant('2期', 1200, 700, 330) // 営業利益170
  const series = buildGrowthSeries([p1, p2])

  test('2期目から前期比を出す(最初の期は含まない)', () => {
    expect(series).toHaveLength(1)
    expect(series[0].label).toBe('2期')
  })

  test('売上・各利益の前期比を計算する', () => {
    expect(series[0].sales).toBeCloseTo(20)
    expect(series[0].operatingProfit).toBeCloseTo(70)
  })

  test('期が 1 つ以下なら空配列', () => {
    expect(buildGrowthSeries([p1])).toEqual([])
    expect(buildGrowthSeries([])).toEqual([])
  })
})

describe('classifyGrowthPattern', () => {
  test('売上と営業利益の増減から 4 パターンに分類する', () => {
    expect(classifyGrowthPattern(10, 20)).toBe('増収増益')
    expect(classifyGrowthPattern(10, -5)).toBe('増収減益')
    expect(classifyGrowthPattern(-10, 5)).toBe('減収増益')
    expect(classifyGrowthPattern(-10, -5)).toBe('減収減益')
  })

  test('どちらかが算出不能なら null', () => {
    expect(classifyGrowthPattern(null, 5)).toBeNull()
    expect(classifyGrowthPattern(5, null)).toBeNull()
  })
})

describe('commonSizePl', () => {
  test('売上高を 100% とした各項目の構成比', () => {
    const c = commonSizePl(basePeriod)
    expect(c.costOfSales).toBeCloseTo(60)
    expect(c.grossProfit).toBeCloseTo(40)
    expect(c.sga).toBeCloseTo(30)
    expect(c.operatingProfit).toBeCloseTo(10)
    expect(c.ordinaryProfit).toBeCloseTo(10)
    expect(c.netIncome).toBeCloseTo(5)
  })

  test('売上高が 0 なら null', () => {
    const noSales: PeriodData = { ...basePeriod, pl: { ...basePeriod.pl, sales: 0 } }
    expect(commonSizePl(noSales).grossProfit).toBeNull()
  })
})

describe('profitBridge(経常利益の増減要因)', () => {
  const prev = basePeriod // 売上1000 粗利400(40%) 販管費300 営業外損益 0
  const curr = variant('2期', 1200, 700, 330) // 粗利500(約41.67%) 販管費330

  const bridge = profitBridge(prev, curr)
  const byKey = (key: string) => bridge.steps.find((s) => s.key === key)?.value

  test('売上増の効果 = 売上の増加額 × 前期の粗利率', () => {
    expect(byKey('salesEffect')).toBeCloseTo(80) // 200 × 40%
  })

  test('粗利率変化の効果 = 粗利率の変化 × 今期売上', () => {
    expect(byKey('marginEffect')).toBeCloseTo(20) // 500 - 480
  })

  test('販管費の増減は、増えると利益のマイナス要因', () => {
    expect(byKey('sgaEffect')).toBeCloseTo(-30)
  })

  test('営業外損益の増減', () => {
    expect(byKey('nonOperatingEffect')).toBeCloseTo(0)
  })

  test('前期経常利益 + 各要因の合計 = 今期経常利益', () => {
    const sum = bridge.steps.reduce((acc, s) => acc + s.value, bridge.start)
    expect(bridge.start).toBeCloseTo(100)
    expect(sum).toBeCloseTo(bridge.end)
    expect(bridge.end).toBeCloseTo(170)
  })

  test('前期売上が 0 の場合は、粗利の増減をすべて粗利率変化として扱い、合計は崩れない', () => {
    const zeroPrev = variant('前期', 0, 0, 0)
    const b = profitBridge(zeroPrev, curr)
    const sum = b.steps.reduce((acc, s) => acc + s.value, b.start)
    expect(sum).toBeCloseTo(b.end)
  })
})

import { describe, expect, test } from 'vitest'
import { basePeriod } from './fixtures'
import { calcMetrics } from './metrics'
import { deriveStatements } from './statements'
import type { PeriodData } from './types'

describe('deriveStatements', () => {
  test('合計と段階利益を導出する', () => {
    const d = deriveStatements(basePeriod)
    expect(d.currentAssets).toBe(500)
    expect(d.quickAssets).toBe(350)
    expect(d.totalAssets).toBe(1000)
    expect(d.currentLiabilities).toBe(300)
    expect(d.fixedLiabilities).toBe(200)
    expect(d.totalLiabilities).toBe(500)
    expect(d.interestBearingDebt).toBe(300)
    expect(d.grossProfit).toBe(400)
    expect(d.operatingProfit).toBe(100)
    expect(d.ordinaryProfit).toBe(100)
    expect(d.preTaxProfit).toBe(90)
    expect(d.netIncome).toBe(50)
  })

  test('貸借が一致していれば balanceGap は 0', () => {
    expect(deriveStatements(basePeriod).balanceGap).toBe(0)
  })

  test('貸借が不一致なら差額を返す', () => {
    const unbalanced: PeriodData = {
      ...basePeriod,
      bs: { ...basePeriod.bs, equity: 450 },
    }
    expect(deriveStatements(unbalanced).balanceGap).toBe(50)
  })
})

describe('calcMetrics: 収益性', () => {
  const m = calcMetrics(basePeriod)

  test('売上高総利益率・営業利益率・経常利益率(%)', () => {
    expect(m.grossMargin).toBeCloseTo(40)
    expect(m.operatingMargin).toBeCloseTo(10)
    expect(m.ordinaryMargin).toBeCloseTo(10)
  })

  test('総資本経常利益率・ROA・ROE(%)', () => {
    expect(m.ordinaryReturnOnAssets).toBeCloseTo(10)
    expect(m.roa).toBeCloseTo(5)
    expect(m.roe).toBeCloseTo(10)
  })

  test('総資本回転率(回)', () => {
    expect(m.totalAssetTurnover).toBeCloseTo(1)
  })
})

describe('calcMetrics: 安定性', () => {
  const m = calcMetrics(basePeriod)

  test('流動比率・当座比率(%)', () => {
    expect(m.currentRatio).toBeCloseTo(166.667, 2)
    expect(m.quickRatio).toBeCloseTo(116.667, 2)
  })

  test('自己資本比率・固定比率・固定長期適合率・負債比率(%)', () => {
    expect(m.equityRatio).toBeCloseTo(50)
    expect(m.fixedRatio).toBeCloseTo(100)
    expect(m.fixedLongTermRatio).toBeCloseTo(71.429, 2)
    expect(m.debtToEquity).toBeCloseTo(100)
  })

  test('有利子負債倍率(倍)', () => {
    expect(m.interestBearingDebtMultiple).toBeCloseTo(0.6)
  })

  test('債務償還年数は営業CFが無ければ「純利益+減価償却費」で近似する', () => {
    expect(m.debtRepaymentYears).toBeCloseTo(3)
    expect(m.debtRepaymentBasis).toBe('approximate')
  })

  test('債務償還年数は営業CFがあればそれを使う', () => {
    const withCf: PeriodData = {
      ...basePeriod,
      pl: { ...basePeriod.pl, operatingCashFlow: 150 },
    }
    const r = calcMetrics(withCf)
    expect(r.debtRepaymentYears).toBeCloseTo(2)
    expect(r.debtRepaymentBasis).toBe('operatingCashFlow')
  })

  test('インタレスト・カバレッジ・レシオ(倍)', () => {
    expect(m.interestCoverage).toBeCloseTo(12)
  })
})

describe('calcMetrics: 算出できない理由(unavailable)', () => {
  test('通常の期は算出不能な指標がない', () => {
    expect(calcMetrics(basePeriod).unavailable).toEqual({})
  })

  test('自己資本が 0 以下なら、自己資本が分母の指標は債務超過として算出不能', () => {
    const insolvent: PeriodData = {
      ...basePeriod,
      bs: { ...basePeriod.bs, equity: -500 },
    }
    const m = calcMetrics(insolvent)
    for (const key of ['roe', 'fixedRatio', 'debtToEquity', 'interestBearingDebtMultiple'] as const) {
      expect(m[key]).toBeNull()
      expect(m.unavailable[key]).toBe('insolvent')
    }
    // 自己資本比率は負の値として計算できるので、算出不能ではない
    expect(m.equityRatio).toBeCloseTo(-50)
    expect(m.unavailable.equityRatio).toBeUndefined()
  })

  test('固定長期適合率は「自己資本 + 固定負債」が 0 以下のときだけ債務超過扱い', () => {
    const insolvent: PeriodData = {
      ...basePeriod,
      bs: { ...basePeriod.bs, equity: -500, longTermDebt: 100 },
    }
    expect(calcMetrics(insolvent).unavailable.fixedLongTermRatio).toBe('insolvent')

    const stillPositive: PeriodData = {
      ...basePeriod,
      bs: { ...basePeriod.bs, equity: -100 }, // 固定負債 200 を足すと 100 > 0
    }
    expect(calcMetrics(stillPositive).fixedLongTermRatio).toBeCloseTo(500)
    expect(calcMetrics(stillPositive).unavailable.fixedLongTermRatio).toBeUndefined()
  })

  test('借入があるのにキャッシュフローが 0 以下なら、返済不能として算出不能', () => {
    const loss: PeriodData = {
      ...basePeriod,
      pl: { ...basePeriod.pl, sales: 500, costOfSales: 600, depreciation: 0 },
    }
    const m = calcMetrics(loss)
    expect(m.debtRepaymentYears).toBeNull()
    expect(m.unavailable.debtRepaymentYears).toBe('cashFlowShortfall')
  })

  test('営業キャッシュフローが負でも返済不能として扱う', () => {
    const negativeOcf: PeriodData = {
      ...basePeriod,
      pl: { ...basePeriod.pl, operatingCashFlow: -10 },
    }
    expect(calcMetrics(negativeOcf).unavailable.debtRepaymentYears).toBe('cashFlowShortfall')
  })

  test('支払利息が 0 のときは「利息なし」', () => {
    const noInterest: PeriodData = {
      ...basePeriod,
      pl: { ...basePeriod.pl, interestExpense: 0 },
    }
    expect(calcMetrics(noInterest).unavailable.interestCoverage).toBe('noInterest')
  })

  test('売上高や総資産が 0 の指標は「分母なし」', () => {
    const noSales: PeriodData = {
      ...basePeriod,
      pl: { ...basePeriod.pl, sales: 0 },
    }
    const m = calcMetrics(noSales)
    expect(m.unavailable.operatingMargin).toBe('noDenominator')
    expect(m.unavailable.grossMargin).toBe('noDenominator')
  })
})

describe('calcMetrics: 異常値', () => {
  test('分母が 0 の指標は null', () => {
    const zeroEquity: PeriodData = {
      ...basePeriod,
      bs: { ...basePeriod.bs, equity: 0 },
    }
    const m = calcMetrics(zeroEquity)
    expect(m.roe).toBeNull()
    expect(m.fixedRatio).toBeNull()
    expect(m.debtToEquity).toBeNull()
  })

  test('売上高 0 なら利益率は null', () => {
    const noSales: PeriodData = {
      ...basePeriod,
      pl: { ...basePeriod.pl, sales: 0 },
    }
    expect(calcMetrics(noSales).operatingMargin).toBeNull()
  })

  test('キャッシュフローが 0 以下なら債務償還年数は null', () => {
    const loss: PeriodData = {
      ...basePeriod,
      pl: { ...basePeriod.pl, sales: 500, costOfSales: 600, depreciation: 0 },
    }
    expect(calcMetrics(loss).debtRepaymentYears).toBeNull()
  })

  test('支払利息が 0 ならインタレスト・カバレッジは null', () => {
    const noInterest: PeriodData = {
      ...basePeriod,
      pl: { ...basePeriod.pl, interestExpense: 0 },
    }
    expect(calcMetrics(noInterest).interestCoverage).toBeNull()
  })

  test('有利子負債 0 なら債務償還年数は 0 年', () => {
    const noDebt: PeriodData = {
      ...basePeriod,
      bs: { ...basePeriod.bs, shortTermDebt: 0, longTermDebt: 0 },
    }
    expect(calcMetrics(noDebt).debtRepaymentYears).toBe(0)
  })
})

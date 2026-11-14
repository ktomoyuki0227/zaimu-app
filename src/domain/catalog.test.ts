import { describe, expect, test } from 'vitest'
import {
  METRIC_CATALOG,
  displayDigits,
  evaluateMetric,
  guidelineText,
  roundForDisplay,
  unavailableText,
} from './catalog'

describe('evaluateMetric', () => {
  test('高いほど良い指標: 基準以上なら good、危険ライン未満なら danger、その間は caution', () => {
    // 流動比率: 150%以上 good / 100%未満 danger
    expect(evaluateMetric('currentRatio', 160)).toBe('good')
    expect(evaluateMetric('currentRatio', 150)).toBe('good')
    expect(evaluateMetric('currentRatio', 120)).toBe('caution')
    expect(evaluateMetric('currentRatio', 99)).toBe('danger')
  })

  test('低いほど良い指標: 基準以下なら good、危険ラインを超えたら danger', () => {
    // 債務償還年数: 10年以内 good / 15年超 danger
    expect(evaluateMetric('debtRepaymentYears', 3)).toBe('good')
    expect(evaluateMetric('debtRepaymentYears', 10)).toBe('good')
    expect(evaluateMetric('debtRepaymentYears', 12)).toBe('caution')
    expect(evaluateMetric('debtRepaymentYears', 16)).toBe('danger')
  })

  test('危険ラインを持たない指標は good か caution のみ', () => {
    // 固定比率: 100%以下 good、それ以外は caution
    expect(evaluateMetric('fixedRatio', 90)).toBe('good')
    expect(evaluateMetric('fixedRatio', 500)).toBe('caution')
  })

  test('固定長期適合率は 100% 超で danger(中間の caution なし)', () => {
    expect(evaluateMetric('fixedLongTermRatio', 100)).toBe('good')
    expect(evaluateMetric('fixedLongTermRatio', 101)).toBe('danger')
  })

  test('値が null、または目安のない指標は unknown', () => {
    expect(evaluateMetric('currentRatio', null)).toBe('unknown')
    expect(evaluateMetric('grossMargin', 40)).toBe('unknown')
  })

  test('債務超過・返済不能で算出できない指標は、中立ではなく danger', () => {
    expect(evaluateMetric('roe', null, 'insolvent')).toBe('danger')
    expect(evaluateMetric('debtToEquity', null, 'insolvent')).toBe('danger')
    expect(evaluateMetric('debtRepaymentYears', null, 'cashFlowShortfall')).toBe('danger')
  })

  test('支払利息がないのは良い状態', () => {
    expect(evaluateMetric('interestCoverage', null, 'noInterest')).toBe('good')
  })

  test('分母がなくて算出できない指標は unknown', () => {
    expect(evaluateMetric('operatingMargin', null, 'noDenominator')).toBe('unknown')
  })

  test('表示で丸めた値で判定する(150.0% と表示されるのに「注意」にならない)', () => {
    expect(evaluateMetric('currentRatio', 149.96)).toBe('good')
    expect(evaluateMetric('currentRatio', 149.94)).toBe('caution')
    expect(evaluateMetric('fixedLongTermRatio', 100.04)).toBe('good')
    expect(evaluateMetric('fixedLongTermRatio', 100.06)).toBe('danger')
  })
})

describe('unavailableText', () => {
  test('どの理由にも、画面に出す説明文がある', () => {
    for (const reason of ['insolvent', 'cashFlowShortfall', 'noInterest', 'noDenominator'] as const) {
      expect(unavailableText(reason).length).toBeGreaterThan(0)
    }
  })
})

describe('displayDigits / roundForDisplay', () => {
  test('単位ごとの表示桁(% と年は 1 桁、倍と回は 2 桁)', () => {
    expect(displayDigits('%')).toBe(1)
    expect(displayDigits('年')).toBe(1)
    expect(displayDigits('倍')).toBe(2)
    expect(displayDigits('回')).toBe(2)
  })

  test('表示桁で丸める', () => {
    expect(roundForDisplay(12.345, '%')).toBeCloseTo(12.3)
    expect(roundForDisplay(1.2345, '倍')).toBeCloseTo(1.23)
  })
})

describe('guidelineText', () => {
  test('目安の説明文を返す', () => {
    expect(guidelineText('currentRatio')).toContain('150')
    expect(guidelineText('debtRepaymentYears')).toContain('10')
  })

  test('目安が無い指標は null', () => {
    expect(guidelineText('grossMargin')).toBeNull()
  })
})

describe('METRIC_CATALOG', () => {
  test('全指標に表示名・単位・計算式の説明がある', () => {
    for (const def of METRIC_CATALOG) {
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.formula.length).toBeGreaterThan(0)
      expect(def.meaning.length).toBeGreaterThan(0)
    }
  })

  test('指標キーが重複しない', () => {
    const keys = METRIC_CATALOG.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

import { describe, expect, test } from 'vitest'
import { formatAmount } from '../lib/format'
import { yAxisWidth } from './chartTheme'

describe('yAxisWidth', () => {
  test('桁の多い数字ほど、軸が広くなる(2,313,051 が 64px に収まらず切れた不具合の再発防止)', () => {
    const wide = yAxisWidth([2_313_051], formatAmount)
    expect(wide).toBeGreaterThan(64)
    expect(yAxisWidth([1_200], formatAmount)).toBeLessThan(wide)
  })

  test('負の数も、符号の分まで含めて広さを決める', () => {
    expect(yAxisWidth([-1_404_094], formatAmount)).toBeGreaterThanOrEqual(yAxisWidth([1_404_094], formatAmount))
  })

  test('小さすぎ・大きすぎにならない(48〜120px)。空や NaN でも壊れない', () => {
    expect(yAxisWidth([], formatAmount)).toBe(48)
    expect(yAxisWidth([Number.NaN], formatAmount)).toBe(48)
    expect(yAxisWidth([1e30], formatAmount)).toBe(120)
  })
})

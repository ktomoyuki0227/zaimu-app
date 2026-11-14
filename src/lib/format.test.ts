import { describe, expect, test } from 'vitest'
import { formatMetric, formatSignedAmount, formatSignedPercent, shortPeriodLabel } from './format'

describe('formatMetric', () => {
  test('単位ごとの桁数で表示する', () => {
    expect(formatMetric(12.345, '%')).toBe('12.3%')
    expect(formatMetric(1.2345, '倍')).toBe('1.23倍')
    expect(formatMetric(0.987, '回')).toBe('0.99回')
    expect(formatMetric(3.04, '年')).toBe('3.0年')
  })

  test('算出できない値は「—」', () => {
    expect(formatMetric(null, '%')).toBe('—')
  })

  test('丸めると 0 になる負の値は「-0.0」ではなく「0.0」と表示する', () => {
    expect(formatMetric(-0.04, '%')).toBe('0.0%')
    expect(formatMetric(-0.004, '倍')).toBe('0.00倍')
  })
})

describe('formatSignedPercent', () => {
  test('増減率に符号をつける', () => {
    expect(formatSignedPercent(12.34)).toBe('+12.3%')
    expect(formatSignedPercent(-4.5)).toBe('-4.5%')
    expect(formatSignedPercent(null)).toBe('—')
  })

  test('丸めて 0 になる値には符号をつけない', () => {
    expect(formatSignedPercent(0.04)).toBe('0.0%')
    expect(formatSignedPercent(-0.04)).toBe('0.0%')
    expect(formatSignedPercent(0)).toBe('0.0%')
  })
})

describe('formatSignedAmount', () => {
  test('増減額に符号をつける', () => {
    expect(formatSignedAmount(1200)).toBe('+1,200')
    expect(formatSignedAmount(-50)).toBe('-50')
    expect(formatSignedAmount(0)).toBe('0')
  })
})

describe('shortPeriodLabel', () => {
  test('「2025年3月期」を「2025/3」に縮める', () => {
    expect(shortPeriodLabel('2025年3月期')).toBe('2025/3')
    expect(shortPeriodLabel('2024年12月期')).toBe('2024/12')
  })

  test('読めない名前は、そのまま返す', () => {
    expect(shortPeriodLabel('新しい期')).toBe('新しい期')
    expect(shortPeriodLabel('FY2025')).toBe('FY2025')
  })
})

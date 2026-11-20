import { describe, expect, test } from 'vitest'
import { amountUnitText, formatAmount, formatChange, formatMetric, formatSignedAmount, formatSignedPercent, shortPeriodLabel, withUnit } from './format'

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

  test('丸めて 0 になる値は、「-0」「+0」にしない(足し引きの端数が出る数字で)', () => {
    expect(formatSignedAmount(-0.04)).toBe('0')
    expect(formatSignedAmount(-1.4e-13)).toBe('0')
    expect(formatSignedAmount(0.04)).toBe('0')
    expect(formatAmount(-0.04)).toBe('0')
    expect(formatSignedAmount(0.06)).toBe('+0.1')
    expect(formatSignedAmount(-0.06)).toBe('-0.1')
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

describe('formatChange', () => {
  test('率(%)の差は pt で、上がれば ↑ +、下がれば ↓', () => {
    expect(formatChange('%', 15.6, 14.2)).toBe('前期から ↑ +1.4pt')
    expect(formatChange('%', 14.2, 15.6)).toBe('前期から ↓ -1.4pt')
  })

  test('表示する桁で同じ値になるときは、微小な差でも「横ばい」(「↑ +0.0pt」と出さない)', () => {
    expect(formatChange('%', 12.34, 12.26)).toBe('前期から横ばい')
    expect(formatChange('%', 12.0, 12.0)).toBe('前期から横ばい')
  })

  test('表示と食い違わない: 12.04 → 12.06 は、どちらも 12.0 / 12.1 と表示されるので差は 0.1', () => {
    expect(formatChange('%', 12.06, 12.04)).toBe('前期から ↑ +0.1pt')
  })

  test('倍・年など、% 以外の単位は、その単位のまま', () => {
    expect(formatChange('倍', 2.5, 2.0)).toBe('前期から ↑ +0.50倍')
  })

  test('どちらかが算出できないときは、比較できない', () => {
    expect(formatChange('%', null, 10)).toBe('前期との比較はできません')
    expect(formatChange('%', 10, null)).toBe('前期との比較はできません')
  })
})

describe('単位の表示', () => {
  test('単位があればそのまま、記録が無ければ「不明」と書く(省かない)', () => {
    expect(amountUnitText('百万円')).toBe('単位: 百万円')
    expect(amountUnitText(undefined)).toBe('単位: 不明')
  })

  test('金額の文字に単位を添える。単位が無ければ、文字だけ', () => {
    expect(withUnit('2,313,051', '百万円')).toBe('2,313,051 百万円')
    expect(withUnit('2,313,051', undefined)).toBe('2,313,051')
  })
})

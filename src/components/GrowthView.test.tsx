// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SAMPLE_COMPANY } from '../data/sample'
import type { Company } from '../domain/types'
import { GrowthView } from './GrowthView'

beforeEach(() => {
  // グラフの大きさを測る部品(ResizeObserver)は jsdom に無いので、何もしない代用品を置く
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GrowthView: 読み上げ用の要約', () => {
  test('売上高・利益・売上高に対する中身の推移を、文章でも伝える(グラフが見えなくても分かる)', () => {
    const { container } = render(<GrowthView company={SAMPLE_COMPANY} />)
    const summaries = [...container.querySelectorAll('p.sr-only')].map((p) => p.textContent ?? '')
    expect(summaries.some((t) => t.startsWith('売上高の推移') && t.includes(SAMPLE_COMPANY.periods[0].label))).toBe(true)
    expect(summaries.some((t) => t.startsWith('各段階の利益の推移') && t.includes('営業利益'))).toBe(true)
    expect(summaries.some((t) => t.startsWith('売上高を 100% としたときの中身'))).toBe(true)
  })

  test('金額の単位がわかるときは、要約に添える', () => {
    const { container } = render(<GrowthView company={{ ...SAMPLE_COMPANY, unit: '百万円' }} />)
    const text = container.textContent ?? ''
    expect(text).toContain('売上高の推移(単位: 百万円)')
  })

  test('売上高が 0 以下の期は、0% の棒にせず、計算できないことを書く', () => {
    const zeroSales: Company = {
      ...SAMPLE_COMPANY,
      periods: SAMPLE_COMPANY.periods.map((p, i) => (i === 0 ? { ...p, pl: { ...p.pl, sales: 0 } } : p)),
    }
    render(<GrowthView company={zeroSales} />)
    const label = zeroSales.periods[0].label
    expect(screen.getByText((text) => text.includes(`売上高が 0 以下の期(${label})`))).toBeTruthy()
  })

  test('2 期未満なら、成長性を見るには 2 期以上が必要なことを知らせる', () => {
    render(<GrowthView company={{ ...SAMPLE_COMPANY, periods: SAMPLE_COMPANY.periods.slice(0, 1) }} />)
    expect(screen.getByText('成長性を見るには 2 期以上のデータが必要です')).toBeTruthy()
  })
})

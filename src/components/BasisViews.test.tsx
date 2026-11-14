// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { basePeriod } from '../domain/fixtures'
import type { Basis, Company, PeriodData } from '../domain/types'
import { CompanyHeader } from './CompanyHeader'
import { GrowthView } from './GrowthView'
import { MetricsView } from './MetricsView'
import { OverviewView } from './OverviewView'

beforeEach(() => {
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

function period(label: string, basis: Basis | undefined, sales: number): PeriodData {
  return { ...basePeriod, label, ...(basis === undefined ? {} : { basis }), pl: { ...basePeriod.pl, sales } }
}

/** 2023〜2024 年は単体、2025 年から連結(情報戦略テクノロジーと同じ形) */
const SWITCHED: Company = {
  id: 'x',
  name: '切り替わりの会社',
  unit: '百万円',
  periods: [
    period('2023年12月期', 'individual', 5300),
    period('2024年12月期', 'individual', 5800),
    period('2025年12月期', 'consolidated', 8000),
  ],
}

const SAME: Company = { ...SWITCHED, periods: SWITCHED.periods.slice(0, 2) }
const UNKNOWN: Company = { ...SWITCHED, periods: SWITCHED.periods.map((p) => ({ ...p, basis: undefined })) }

describe('CompanyHeader: 数字の範囲', () => {
  const noop = (): void => undefined

  test('連結と単体が混ざる会社は、範囲の要約と、増減を計算していないことの注意を出す', () => {
    render(<CompanyHeader company={SWITCHED} tab="overview" onBack={noop} onTab={noop} />)
    expect(screen.getByText(/数字の範囲: 2023年12月期〜2024年12月期は単体、2025年12月期は連結/)).toBeTruthy()
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('連結と単体の数字が混ざっています')
    expect(note.textContent).toContain('2025年12月期')
  })

  test('範囲が 1 種類だけなら、要約だけを出し、注意は出さない', () => {
    render(<CompanyHeader company={SAME} tab="overview" onBack={noop} onTab={noop} />)
    expect(screen.getByText(/数字の範囲: 2023年12月期〜2024年12月期は単体/)).toBeTruthy()
    expect(screen.queryByRole('note')).toBeNull()
  })

  test('範囲の記録が無い(古い保存データ・練習用データ)なら、何も出さない', () => {
    render(<CompanyHeader company={UNKNOWN} tab="overview" onBack={noop} onTab={noop} />)
    expect(screen.queryByText(/数字の範囲/)).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('概要・指標・成長性: 切り替わりの前後は比べない', () => {
  test('概要: 成長性は判定せず、理由を出す。主要な数字は「前期との比較はできません」', () => {
    render(<OverviewView company={SWITCHED} onOpen={() => undefined} />)
    expect(screen.getAllByText(/増減は計算していません/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('前期との比較はできません').length).toBeGreaterThan(0)
    expect(screen.queryByText(/増収|減収/)).toBeNull()
  })

  test('概要: 切り替わりの無い会社は、これまでどおり増減を出す', () => {
    render(<OverviewView company={SAME} onOpen={() => undefined} />)
    expect(screen.getAllByText(/増収/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/増減は計算していません/)).toBeNull()
  })

  test('指標: 各指標の前期との差の代わりに、比べない理由を出し、表の見出しに範囲を添える', () => {
    render(<MetricsView company={SWITCHED} group="profitability" />)
    expect(screen.getAllByText(/増減は計算していません/).length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: '2025年12月期(連結)' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '2024年12月期(単体)' })).toBeTruthy()
  })

  test('指標: 範囲が 1 種類の会社は、見出しに範囲を添えず、前期との差を出す', () => {
    render(<MetricsView company={SAME} group="profitability" />)
    expect(screen.getByRole('columnheader', { name: '2024年12月期' })).toBeTruthy()
    expect(screen.queryByText(/増減は計算していません/)).toBeNull()
  })

  test('成長性: 切り替わる期を選ぶと、増減の要因に分けず、理由を出す。選択肢にも範囲を添える', () => {
    render(<GrowthView company={SWITCHED} />)
    const select = screen.getByLabelText('詳しく見る期') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([
      '2023年12月期(単体)',
      '2024年12月期(単体)',
      '2025年12月期(連結)',
    ])
    // 最新の期(2025 年 12 月期)が選ばれている
    expect(select.value).toBe('2')
    expect(screen.getAllByText(/増減は計算していません/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/増減の要因には分けられません/).length).toBeGreaterThan(0)
  })

  test('成長性: 成長率のグラフの下に、増減を計算していない期を書く', () => {
    const { container } = render(<GrowthView company={SWITCHED} />)
    expect(container.textContent).toContain('2025年12月期は、前期と連結・単体の範囲が違うため、増減を計算していません')
  })

  test('成長性: 範囲が同じ期に切り替えると、増減の読み解きが戻る', () => {
    render(<GrowthView company={SWITCHED} />)
    fireEvent.change(screen.getByLabelText('詳しく見る期'), { target: { value: '1' } })
    const insight = screen.getByText(/2024年12月期は「/)
    expect(within(insight.closest('div') as HTMLElement).queryByText(/増減は計算していません/)).toBeNull()
  })
})

describe('グラフの下の注意と、単位不明', () => {
  test('成長性: 売上高・利益・割合のグラフの下にも、範囲が変わる期と「伸びとは読めない」注意を出す', () => {
    render(<GrowthView company={SWITCHED} />)
    const notes = screen.getAllByRole('note').map((n) => n.textContent ?? '')
    const rangeNotes = notes.filter((t) => t.includes('数字の範囲(連結・単体)が変わる期: 2025年12月期'))
    // 売上高・利益の推移、売上高に対する中身の 3 つ
    expect(rangeNotes).toHaveLength(3)
    expect(rangeNotes[0]).toContain('増えた・減ったとは読めません')
  })

  test('成長性: 範囲が変わらない会社には、その注意を出さない', () => {
    render(<GrowthView company={SAME} />)
    expect(screen.queryAllByRole('note')).toHaveLength(0)
  })

  test('指標: 比べない理由の全文は、見出しの下に 1 回だけ。各指標のカードは、短い文にする', () => {
    render(<MetricsView company={SWITCHED} group="profitability" />)
    const full = screen.getAllByText(/前期\(2024年12月期\)は単体/)
    expect(full).toHaveLength(1)
    expect(screen.getAllByText('前期とは比べません(範囲が違います)').length).toBeGreaterThan(3)
  })

  test('概要: 金額の単位の記録が無い企業は、売上高に「(単位不明)」と出す', () => {
    const { unit: _unit, ...withoutUnit } = SAME
    render(<OverviewView company={withoutUnit} onOpen={() => undefined} />)
    expect(screen.getByText('(単位不明)')).toBeTruthy()
  })

  test('概要: 単位がある企業は、その単位を出す', () => {
    render(<OverviewView company={SAME} onOpen={() => undefined} />)
    expect(screen.getByText('百万円')).toBeTruthy()
    expect(screen.queryByText('(単位不明)')).toBeNull()
  })
})


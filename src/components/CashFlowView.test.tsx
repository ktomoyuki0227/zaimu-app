// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SAMPLE_COMPANY } from '../data/sample'
import { basePeriod } from '../domain/fixtures'
import type { Basis, Company, PeriodData } from '../domain/types'
import { CashFlowView } from './CashFlowView'

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

function period(label: string, cf: readonly [number, number, number] | null, basis?: Basis): PeriodData {
  return {
    ...basePeriod,
    label,
    ...(basis === undefined ? {} : { basis }),
    pl: {
      ...basePeriod.pl,
      ...(cf === null ? {} : { operatingCashFlow: cf[0], investingCashFlow: cf[1], financingCashFlow: cf[2] }),
    },
  }
}

const COMPANY: Company = {
  id: 'x',
  name: 'テスト社',
  unit: '百万円',
  periods: [period('2024年3月期', [1200, -800, -300]), period('2025年3月期', [-200, 400, 900])],
}

describe('CashFlowView: 3 つの区分', () => {
  test('最新の期を選んで、営業 → 投資 → 財務の正式な順に、見出しを並べる', () => {
    render(<CashFlowView company={COMPANY} />)
    const cards = screen.getAllByRole('heading', { level: 4 }).filter((h) => h.textContent?.endsWith('活動によるキャッシュフロー'))
    expect(cards.map((h) => h.textContent)).toEqual([
      '営業活動によるキャッシュフロー',
      '投資活動によるキャッシュフロー',
      '財務活動によるキャッシュフロー',
    ])
    expect(screen.getByRole('heading', { level: 3, name: '2025年3月期のキャッシュフロー' })).toBeTruthy()
  })

  test('数字に符号を付け(+ / -)、言葉でも「資金が入った / 出た」を伝える。意味の文も出す', () => {
    const { container } = render(<CashFlowView company={COMPANY} />)
    const cards = within(container.querySelector('ol') as HTMLElement)
    // 2025 年 3 月期: 営業 -200、投資 +400、財務 +900
    expect(cards.getByText('-200')).toBeTruthy()
    expect(cards.getByText('+400')).toBeTruthy()
    expect(cards.getByText('+900')).toBeTruthy()
    expect(cards.getAllByText('− 資金が出た')).toHaveLength(1)
    expect(cards.getAllByText('＋ 資金が入った')).toHaveLength(2)
    expect(cards.getByText(/本業で、現金が出ていっています/)).toBeTruthy()
    expect(cards.getByText(/資産の売却や、投資の回収/)).toBeTruthy()
  })

  test('フリーキャッシュフロー(営業 + 投資)と、3 区分の合計を出す', () => {
    const { container } = render(<CashFlowView company={COMPANY} />)
    const summary = within(container.querySelector('dl') as HTMLElement)
    expect(summary.getByText('フリーキャッシュフロー(営業 + 投資)').parentElement?.textContent).toContain('+200')
    expect(summary.getByText('3 区分の合計(現金の増減)').parentElement?.textContent).toContain('+1,100')
  })

  test('お金の流れの型を、意味とともに出す(営業マイナスは「注意」の型)', () => {
    render(<CashFlowView company={COMPANY} />)
    // 営業がマイナスの型は、「注意」を文字でも伝える(色だけにしない)
    const heading = screen.getByRole('heading', { level: 4, name: /お金の流れの型/ })
    expect(heading.textContent).toBe('注意: お金の流れの型: 資産の売却と借入で、穴埋めしている型')
    expect(screen.getByText(/1 期だけでは決めつけず/)).toBeTruthy()
  })

  test('期を切り替えると、その期の数字と型になる', () => {
    const { container } = render(<CashFlowView company={COMPANY} />)
    fireEvent.change(screen.getByLabelText('詳しく見る期'), { target: { value: '0' } })
    expect(screen.getByRole('heading', { level: 3, name: '2024年3月期のキャッシュフロー' })).toBeTruthy()
    expect(within(container.querySelector('ol') as HTMLElement).getByText('+1,200')).toBeTruthy()
    expect(screen.getByText(/お金の流れの型: 安定した型/)).toBeTruthy()
  })
})

describe('CashFlowView: 表・単位・データの無い場合', () => {
  test('期ごとの比較表: 営業・投資・財務(正式な順)・フリー・合計の行に、符号つきの数字', () => {
    render(<CashFlowView company={COMPANY} />)
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row').map((r) => r.textContent)
    expect(rows[1]).toContain('1. 営業活動によるキャッシュフロー')
    expect(rows[1]).toContain('+1,200')
    expect(rows[1]).toContain('-200')
    expect(rows[2]).toContain('2. 投資活動によるキャッシュフロー')
    expect(rows[3]).toContain('3. 財務活動によるキャッシュフロー')
    expect(rows[4]).toContain('フリーキャッシュフロー')
    expect(rows[5]).toContain('3 区分の合計')
  })

  test('単位を画面に出す(単位の記録が無い企業は「単位: 不明」)', () => {
    const { container, rerender } = render(<CashFlowView company={COMPANY} />)
    const notes = () => [...container.querySelectorAll('p.text-right')].map((p) => p.textContent)
    expect(notes().every((t) => t === '単位: 百万円')).toBe(true)
    expect(notes().length).toBeGreaterThanOrEqual(3)
    const { unit: _unit, ...withoutUnit } = COMPANY
    rerender(<CashFlowView company={withoutUnit} />)
    expect(notes().every((t) => t === '単位: 不明')).toBe(true)
  })

  test('一部の期にだけ数字がある(古い期は無い)ときは、数字のある最新の期を選び、無い期は「—」', () => {
    const company: Company = { ...COMPANY, periods: [period('2023年3月期', null), ...COMPANY.periods] }
    render(<CashFlowView company={company} />)
    expect(screen.getByRole('heading', { level: 3, name: '2025年3月期のキャッシュフロー' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('詳しく見る期'), { target: { value: '0' } })
    expect(screen.getByText('この期のキャッシュフローの数字は、書類にありません。')).toBeTruthy()
  })

  test('投資・財務が無い期(営業だけ)は、無い区分を「数字なし」と書き、型は出さない', () => {
    const only: PeriodData = { ...basePeriod, label: '2025年3月期', pl: { ...basePeriod.pl, operatingCashFlow: 500 } }
    render(<CashFlowView company={{ ...COMPANY, periods: [only] }} />)
    expect(screen.getAllByText('数字なし')).toHaveLength(2)
    expect(screen.queryByText(/お金の流れの型/)).toBeNull()
  })

  test('どの期にも数字が無い企業は、取り込み直すと表示されることを案内する', () => {
    render(<CashFlowView company={{ ...COMPANY, periods: [period('2025年3月期', null)] }} />)
    expect(screen.getByText('キャッシュフローの数字がありません')).toBeTruthy()
    expect(screen.getByText(/もう一度取り込むと/)).toBeTruthy()
  })

  test('連結と単体が混ざる会社は、見出しに範囲を添え、グラフの下に注意を出す', () => {
    const company: Company = {
      ...COMPANY,
      periods: [period('2024年3月期', [1, -1, -1], 'individual'), period('2025年3月期', [2, -1, -1], 'consolidated')],
    }
    render(<CashFlowView company={company} />)
    expect(screen.getByRole('columnheader', { name: '2025年3月期(連結)' })).toBeTruthy()
    expect(screen.getAllByRole('note').some((n) => n.textContent?.includes('2025年3月期'))).toBe(true)
  })

  test('練習用データ(5 期)も、3 区分が現金の増減と合っている(営業 + 投資 + 財務)', () => {
    const { container } = render(<CashFlowView company={SAMPLE_COMPANY} />)
    const summary = within(container.querySelector('dl') as HTMLElement)
    // 2025 年 3 月期: 現金預金 1,150 → 1,500 で +350
    expect(summary.getByText('3 区分の合計(現金の増減)').parentElement?.textContent).toContain('+350')
  })
})

describe('CashFlowView: 補足と読み上げ', () => {
  test('営業 + 投資がマイナスのときは、符号だけでは分からない補足を出す', () => {
    const company: Company = { ...COMPANY, periods: [period('2025年3月期', [100, -900, -50])] }
    render(<CashFlowView company={company} />)
    expect(screen.getByText(/投資が本業の稼ぎを上回っています/)).toBeTruthy()
  })

  test('グラフの中身を、読み上げ用の文でも伝える(営業 → 投資 → 財務の順、符号つき、無い数字は「数字なし」)', () => {
    const only: PeriodData = { ...basePeriod, label: '2023年3月期', pl: { ...basePeriod.pl, operatingCashFlow: 50 } }
    const company: Company = { ...COMPANY, periods: [only, ...COMPANY.periods] }
    const { container } = render(<CashFlowView company={company} />)
    const text = [...container.querySelectorAll('p.sr-only')].map((p) => p.textContent ?? '').find((t) => t.startsWith('キャッシュフローの推移'))
    expect(text).toBe(
      'キャッシュフローの推移(単位: 百万円): 2023年3月期 営業CF +50、投資CF 数字なし、財務CF 数字なし。' +
        '2024年3月期 営業CF +1,200、投資CF -800、財務CF -300。2025年3月期 営業CF -200、投資CF +400、財務CF +900',
    )
  })

  test('期を選ぶ前に、データが入れ替わっても(期が増えても)、数字のある最新の期を出す', () => {
    const { rerender } = render(<CashFlowView company={COMPANY} />)
    expect(screen.getByRole('heading', { level: 3, name: '2025年3月期のキャッシュフロー' })).toBeTruthy()
    rerender(<CashFlowView company={{ ...COMPANY, periods: [...COMPANY.periods, period('2026年3月期', [10, -5, -2])] }} />)
    expect(screen.getByRole('heading', { level: 3, name: '2026年3月期のキャッシュフロー' })).toBeTruthy()
  })

  test('練習用データは、どの期も、営業 + 投資 + 財務 が、現金預金の増減と合う', () => {
    const periods = SAMPLE_COMPANY.periods
    for (let i = 1; i < periods.length; i += 1) {
      const pl = periods[i].pl
      const total = (pl.operatingCashFlow ?? 0) + (pl.investingCashFlow ?? 0) + (pl.financingCashFlow ?? 0)
      expect(total, periods[i].label).toBe(periods[i].bs.cash - periods[i - 1].bs.cash)
    }
  })

  test('範囲の切り替わりの注意は、グラフに出す期だけで判断する(数字の無い古い期は数えない)', () => {
    const company: Company = {
      ...COMPANY,
      periods: [
        period('2023年3月期', null, 'individual'),
        period('2024年3月期', [1, -1, -1], 'consolidated'),
        period('2025年3月期', [2, -1, -1], 'consolidated'),
      ],
    }
    render(<CashFlowView company={company} />)
    // グラフに出る 2024・2025 年はどちらも連結なので、グラフの下の注意は出さない
    expect(screen.queryAllByRole('note').filter((n) => n.textContent?.includes('数字の範囲(連結・単体)が変わる期'))).toHaveLength(0)
  })
})


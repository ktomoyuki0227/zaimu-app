// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SAMPLE_COMPANY } from '../data/sample'
import { basePeriod } from '../domain/fixtures'
import type { Company, IncomeStatementInput, PeriodData } from '../domain/types'
import { OverviewView } from './OverviewView'

afterEach(cleanup)

function period(label: string, pl: Partial<IncomeStatementInput>): PeriodData {
  return { ...basePeriod, label, pl: { ...basePeriod.pl, ...pl } }
}

const company = (periods: readonly PeriodData[], unit: Company['unit'] | null = '百万円'): Company => ({
  id: 'x',
  name: 'テスト社',
  ...(unit === null ? {} : { unit }),
  periods,
})

function section(): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: /^キャッシュフローの要点/ })
  return heading.closest('section') as HTMLElement
}

describe('概要ページ: キャッシュフローの要点', () => {
  test('練習用データ: 最新の期の見出しと、営業 → 投資 → 財務の順の 3 つの数字(符号・言葉・単位つき)', () => {
    render(<OverviewView company={SAMPLE_COMPANY} onOpen={() => undefined} />)
    const latest = SAMPLE_COMPANY.periods[SAMPLE_COMPANY.periods.length - 1].label
    expect(screen.getByRole('heading', { level: 2, name: `キャッシュフローの要点(${latest})` })).toBeTruthy()
    const items = within(section()).getAllByRole('listitem').slice(0, 3).map((li) => li.textContent ?? '')
    expect(items[0]).toContain('1. 営業活動によるキャッシュフロー')
    expect(items[0]).toContain('+780')
    expect(items[0]).toContain('＋ 資金が入った')
    expect(items[0]).toContain('百万円')
    expect(items[1]).toContain('2. 投資活動によるキャッシュフロー')
    expect(items[1]).toContain('-300')
    expect(items[1]).toContain('− 資金が出た')
    expect(items[2]).toContain('3. 財務活動によるキャッシュフロー')
    expect(items[2]).toContain('-130')
  })

  test('フリーキャッシュフローと、型・続き方・利益との関係・現金の突き合わせを、文章で出す', () => {
    render(<OverviewView company={SAMPLE_COMPANY} onOpen={() => undefined} />)
    const text = section().textContent ?? ''
    // 780 − 300 = 480
    expect(text).toContain('フリーキャッシュフロー(営業 + 投資): +480 百万円')
    expect(text).toContain('本業の稼ぎで、投資をまかなえています')
    expect(text).toContain('お金の流れの型: 安定した型')
    expect(text).toContain('営業キャッシュフローは、直近 5 期、続けてプラスです')
    expect(text).toContain('当期純利益の')
    expect(text).toContain('期首の現金から期末の現金への流れが、3 区分 + 為替の影響と合っています')
  })

  test('順序: 主要な数字の次、気をつけたい点の前', () => {
    render(<OverviewView company={SAMPLE_COMPANY} onOpen={() => undefined} />)
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '')
    const index = titles.findIndex((t) => t.startsWith('キャッシュフローの要点'))
    expect(titles[index - 1]).toBe('主要な数字')
    expect(titles[index + 1]).toBe('気をつけたい点')
  })

  test('「くわしく見る」を押すと、キャッシュフローのページを開く', () => {
    const onOpen = vi.fn()
    render(<OverviewView company={SAMPLE_COMPANY} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャッシュフローをくわしく見る →' }))
    expect(onOpen).toHaveBeenCalledWith('cashflow')
  })

  test('キャッシュフローの数字が無い企業(古い保存データ)は、この欄を出さない', () => {
    render(<OverviewView company={company([period('2024年3月期', {}), period('2025年3月期', {})])} onOpen={() => undefined} />)
    expect(screen.queryByRole('heading', { level: 2, name: /^キャッシュフローの要点/ })).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: '主要な数字' })).toBeTruthy()
  })

  test('営業マイナス・投資が稼ぎを上回る企業: 「注意」を、色だけでなく言葉で出す', () => {
    const c = company([
      period('2024年3月期', { operatingCashFlow: -20, investingCashFlow: -50, financingCashFlow: 80 }),
      period('2025年3月期', { operatingCashFlow: -30, investingCashFlow: -40, financingCashFlow: 70 }),
    ])
    render(<OverviewView company={c} onOpen={() => undefined} />)
    const text = section().textContent ?? ''
    expect(text).toContain('本業で現金が出ていて、さらに投資にも使っています')
    expect(text).toContain('注意: お金の流れの型: 借入に頼る型')
    expect(text).toContain('注意: 営業キャッシュフローは、直近 2 期、続けてマイナスです')
    expect(text).toContain('利益は出ていますが、営業キャッシュフローはマイナスです')
  })

  test('営業はプラスだが、投資が稼ぎを上回る企業: 型の「補足」を出し、注意を付ける', () => {
    const c = company([period('2025年3月期', { operatingCashFlow: 100, investingCashFlow: -150, financingCashFlow: -10 })])
    render(<OverviewView company={c} onOpen={() => undefined} />)
    const text = section().textContent ?? ''
    expect(text).toContain('投資が、本業の稼ぎを上回っています')
    expect(text).toContain('注意: お金の流れの型: 安定した型。符号は、よくある形ですが、金額は、投資が本業の稼ぎを上回っています')
  })

  test('営業マイナスで、投資のプラスでフリーキャッシュフローがプラスに見える企業: 「まかなえています」と言わない', () => {
    const c = company([period('2025年3月期', { operatingCashFlow: -20, investingCashFlow: 50, financingCashFlow: -10 })])
    render(<OverviewView company={c} onOpen={() => undefined} />)
    const text = section().textContent ?? ''
    expect(text).toContain('フリーキャッシュフロー(営業 + 投資): +30')
    expect(text).not.toContain('まかなえています')
    expect(text).toContain('資産の売却などで、投資の側が、プラスになっています')
  })

  test('連結と単体が混ざる企業: どちらの数字かを、説明に添える', () => {
    const cf = { operatingCashFlow: 100, investingCashFlow: -10, financingCashFlow: -10 }
    const c = company([
      { ...period('2024年12月期', cf), basis: 'individual' },
      { ...period('2025年12月期', cf), basis: 'consolidated' },
    ])
    render(<OverviewView company={c} onOpen={() => undefined} />)
    expect(section().textContent).toContain('2025年12月期は、連結の数字です')
    // 範囲が違う 2 期を、「続けてプラス」とは数えない
    expect(section().textContent).not.toContain('続けてプラス')
  })

  test('一部の区分だけ数字がある企業: 無い区分は「数字なし」。型は出さない', () => {
    const c = company([period('2025年3月期', { operatingCashFlow: 100 })])
    render(<OverviewView company={c} onOpen={() => undefined} />)
    const text = section().textContent ?? ''
    expect(within(section()).getAllByText('数字なし')).toHaveLength(2)
    expect(text).not.toContain('お金の流れの型')
    expect(text).not.toContain('フリーキャッシュフロー')
  })

  test('単位の記録が無い企業は「(単位不明)」', () => {
    const c = company([period('2025年3月期', { operatingCashFlow: 100, investingCashFlow: -10, financingCashFlow: -10 })], null)
    render(<OverviewView company={c} onOpen={() => undefined} />)
    expect(section().textContent).toContain('(単位不明)')
  })

  test('現金の突き合わせに差があるときは、注意と、確かめ先を案内する', () => {
    const c = company([
      period('2024年3月期', { cashEnd: 1000 }),
      period('2025年3月期', { operatingCashFlow: 500, investingCashFlow: -300, financingCashFlow: -100, cashEnd: 1500 }),
    ])
    render(<OverviewView company={c} onOpen={() => undefined} />)
    const text = section().textContent ?? ''
    expect(text).toContain('注意: 現金の突き合わせに差があります')
    expect(text).toContain('キャッシュフローのページで、内訳を確かめられます')
  })
})

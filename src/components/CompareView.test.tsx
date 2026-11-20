// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { basePeriod } from '../domain/fixtures'
import type { AmountUnit, BalanceSheetInput, Basis, Company, IncomeStatementInput } from '../domain/types'
import { CompareView } from './CompareView'

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

interface Spec {
  readonly id: string
  readonly unit?: AmountUnit
  readonly label?: string
  readonly basis?: Basis
  readonly pl?: Partial<IncomeStatementInput>
  readonly bs?: Partial<BalanceSheetInput>
}

// 基準データ: 売上高 1000 / 営業利益 100(営業利益率 10%)/ 当期純利益 50 / 総資産 1000
function company(spec: Spec): Company {
  return {
    id: spec.id,
    name: `${spec.id}社`,
    ...(spec.unit === undefined ? {} : { unit: spec.unit }),
    periods: [
      {
        ...basePeriod,
        label: spec.label ?? '2025年3月期',
        ...(spec.basis === undefined ? {} : { basis: spec.basis }),
        pl: { ...basePeriod.pl, ...spec.pl },
        bs: { ...basePeriod.bs, ...spec.bs },
      },
    ],
  }
}

const A = company({ id: 'A', unit: '百万円' })
const B = company({ id: 'B', unit: '千円', pl: { sales: 2_000_000, costOfSales: 1_000_000, sga: 600_000 } }) // 営業利益 400,000 千円(営業利益率 20%)
const C = company({ id: 'C', unit: '百万円', pl: { sales: 500 } }) // 営業利益 −400
const D = company({ id: 'D', unit: '百万円' })
const E = company({ id: 'E', unit: '百万円' })

function renderView(companies: readonly Company[], handlers: { onBack?: () => void; onOpenCompany?: (id: string) => void } = {}) {
  return render(
    <CompareView companies={companies} onBack={handlers.onBack ?? (() => undefined)} onOpenCompany={handlers.onOpenCompany ?? (() => undefined)} />,
  )
}

function tableByCaption(caption: string): HTMLElement {
  const table = screen.getAllByRole('table').find((t) => t.querySelector('caption')?.textContent === caption)
  if (table === undefined) throw new Error(`表が見つかりません: ${caption}`)
  return table
}

function rowOf(table: HTMLElement, label: string): HTMLElement {
  const row = within(table).getAllByRole('row').find((r) => r.querySelector('th[scope=row]')?.textContent?.startsWith(label))
  if (row === undefined) throw new Error(`行が見つかりません: ${label}`)
  return row
}

const cells = (row: HTMLElement): string[] => within(row).getAllByRole('cell').map((c) => c.textContent ?? '')

describe('CompareView: 比べる企業の選択', () => {
  test('見出しと、一覧の先頭から 4 社が選ばれた状態で始まる(5 社目は外れている)', () => {
    renderView([A, B, C, D, E])
    expect(screen.getByRole('heading', { level: 1, name: '他社比較' })).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((b) => b.checked)).toEqual([true, true, true, true, false])
  })

  test('1 社だけの選択は、比較の表を出さず、あと何社か案内する', () => {
    renderView([A, B])
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getByText('2 社以上を選ぶと、比較の表が出ます(いま 1 社)。')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0)
  })

  test('6 社を選ぶと、残りの企業は選べなくなり、理由を書く', () => {
    const many = Array.from({ length: 8 }, (_, i) => company({ id: `X${i}`, unit: '百万円' }))
    renderView(many)
    const boxes = () => screen.getAllByRole('checkbox') as HTMLInputElement[]
    // 先頭から 4 社が選択済み。2 社足すと 6 社
    fireEvent.click(boxes()[4])
    fireEvent.click(boxes()[5])
    expect(boxes().filter((b) => b.checked)).toHaveLength(6)
    expect(boxes()[6].disabled).toBe(true)
    expect(boxes()[7].disabled).toBe(true)
    expect(boxes()[0].disabled).toBe(false)
    expect(screen.getByText(/選べるのは 6 社までです/)).toBeTruthy()
    fireEvent.click(boxes()[0])
    expect(boxes()[6].disabled).toBe(false)
  })

  test('表の列は、一覧の並びのまま(選んだ順ではない)', () => {
    renderView([A, B, C, D, E])
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    const header = within(tableByCaption('企業ごとの、成長性・収益性・安定性の判定')).getAllByRole('columnheader')
    expect(header.slice(1).map((h) => h.querySelector('span.font-bold')?.textContent)).toEqual(['A社', 'B社', 'C社', 'D社'])
  })

  test('「一覧へ」と「分析を見る」を押すと、渡した関数を呼ぶ', () => {
    const onBack = vi.fn()
    const onOpenCompany = vi.fn()
    renderView([A, B], { onBack, onOpenCompany })
    fireEvent.click(screen.getByRole('button', { name: '← 企業の一覧へ' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'B社の分析を見る →' }))
    expect(onOpenCompany).toHaveBeenCalledWith('B')
  })
})

describe('CompareView: 表の中身', () => {
  test('金額は百万円にそろえる(千円の企業も、同じ物差しで並ぶ)。単位を書く', () => {
    renderView([A, B])
    const table = tableByCaption('企業ごとの、売上高・営業利益・当期純利益・総資産')
    expect(cells(rowOf(table, '売上高'))).toEqual(['1,000', '2,000'])
    expect(cells(rowOf(table, '営業利益'))).toEqual(['100', '400'])
    expect(screen.getAllByText('単位: 百万円').length).toBeGreaterThanOrEqual(2)
  })

  test('列の見出しに、企業名・最新の期・範囲(連結・単体)を出す', () => {
    renderView([company({ id: 'A', unit: '百万円', basis: 'consolidated' }), company({ id: 'B', unit: '百万円', label: '2024年12月期', basis: 'individual' })])
    const header = within(tableByCaption('企業ごとの、売上高・営業利益・当期純利益・総資産')).getAllByRole('columnheader')
    expect(header[1].textContent).toBe('A社2025年3月期(連結)')
    expect(header[2].textContent).toBe('B社2024年12月期(単体)')
  })

  test('指標: 値と評価(◎△▲)を企業ごとに出し、その行で最も良い値に「★ 最良」を付ける', () => {
    renderView([A, B, C])
    const table = tableByCaption('企業ごとの、収益性の指標')
    const row = rowOf(table, '売上高営業利益率')
    const [a, b, c] = cells(row)
    expect(a).toContain('10.0%')
    expect(a).toContain('クリア')
    expect(a).not.toContain('★')
    expect(b).toContain('20.0%')
    expect(b).toContain('★ 最良')
    expect(c).toContain('-80.0%')
    expect(c).toContain('要注意')
    expect(row.querySelector('th')?.textContent).toContain('目安: 5%以上、0%未満は要注意')
  })

  test('小さいほど良い指標は、最小に「★ 最良」を付ける', () => {
    const lowDebt = company({ id: 'L', unit: '百万円', bs: { equity: 800, otherCurrentLiabilities: 0, otherFixedLiabilities: 0, fixedAssets: 800 } })
    renderView([A, lowDebt])
    const [a, l] = cells(rowOf(tableByCaption('企業ごとの、安定性の指標'), '負債比率'))
    expect(a).not.toContain('★')
    expect(l).toContain('★ 最良')
  })

  test('目安の無い指標は、評価の印を出さない。算出できない指標は、理由を短く書く', () => {
    const insolvent = company({ id: 'I', unit: '百万円', bs: { equity: 0, otherFixedLiabilities: 500 } })
    renderView([A, insolvent])
    const gross = cells(rowOf(tableByCaption('企業ごとの、収益性の指標'), '売上高総利益率'))
    // 売上高総利益率は目安が無いので、評価の印は出さない。同じ値(40.0%)なので、優劣が付かず、「最良」も付かない
    expect(gross).toEqual(['40.0%', '40.0%'])
    const roe = cells(rowOf(tableByCaption('企業ごとの、収益性の指標'), 'ROE'))
    expect(roe[1]).toContain('債務超過')
    expect(roe[1]).toContain('要注意')
  })

  test('3 つの軸の判定を、記号と言葉で出す', () => {
    renderView([A, C])
    const table = tableByCaption('企業ごとの、成長性・収益性・安定性の判定')
    expect(cells(rowOf(table, '収益性'))[1]).toContain('要注意')
    expect(rowOf(table, '成長性')).toBeTruthy()
    expect(rowOf(table, '安定性')).toBeTruthy()
  })

  test('キャッシュフロー: 3 区分は符号つき、無い数字は「—」。型も出す', () => {
    const withCf = company({ id: 'F', unit: '百万円', pl: { operatingCashFlow: 300, investingCashFlow: -120, financingCashFlow: -50 } })
    renderView([withCf, A])
    const table = tableByCaption('企業ごとの、キャッシュフローの 3 区分とフリーキャッシュフロー')
    expect(cells(rowOf(table, '営業キャッシュフロー'))).toEqual(['+300', '—'])
    expect(cells(rowOf(table, '投資キャッシュフロー'))).toEqual(['-120', '—'])
    expect(cells(rowOf(table, 'フリーキャッシュフロー'))).toEqual(['+180', '—'])
    expect(cells(rowOf(table, 'お金の流れの型'))).toEqual(['安定した型', '—'])
  })

  test('成長性: 前の期が無い企業は「—」(1 期だけの企業)', () => {
    renderView([A, C])
    expect(cells(rowOf(tableByCaption('企業ごとの、売上高・営業利益の前期比'), '売上高の前期比'))).toEqual(['—', '—'])
  })
})

describe('CompareView: 注意とグラフ', () => {
  test('決算期・範囲・単位がそろっていれば、「比べるときの注意」は出さない(業種の注意は、いつも出す)', () => {
    renderView([A, B])
    expect(screen.queryByText('比べるときの注意')).toBeNull()
    expect(screen.getByText(/違う業種どうしの数字は/)).toBeTruthy()
  })

  test('最新の期が違う・単位の記録が無いときは、注意を、言葉で出す', () => {
    renderView([A, company({ id: 'N', label: '2024年12月期' })])
    const note = screen.getByRole('note')
    expect(note.textContent).toContain('比べるときの注意')
    expect(note.textContent).toContain('最新の期が企業ごとに違います')
    expect(note.textContent).toContain('N社は、金額の単位の記録が無い')
  })

  test('グラフ: 指標を選ぶと、説明と読み上げ用の文が、その指標になる', () => {
    renderView([A, B, C])
    const select = screen.getByLabelText('比べる指標')
    const has = (...parts: string[]) => (text: string) => parts.every((p) => text.includes(p))
    expect(screen.getByText(has('売上高営業利益率: 営業利益 ÷ 売上高', '大きいほど良い'))).toBeTruthy()
    fireEvent.change(select, { target: { value: 'debtToEquity' } })
    expect(screen.getByText(has('負債比率: ', '小さいほど良い'))).toBeTruthy()
    expect(screen.getByText(has('負債比率(単位: %)の企業ごとの値: A社 100.0%、B社 '))).toBeTruthy()
    // 算出できる企業は、すべて棒になる。算出できない企業が無いので、そのお知らせは出ない
    expect(screen.queryByText(/棒を出していない企業/)).toBeNull()
  })

  test('横にスクロールする表は、キーボードで届く領域(名前つき)にしてある', () => {
    renderView([A, B])
    const regions = screen.getAllByRole('region')
    expect(regions).toHaveLength(6)
    expect(regions.every((r) => r.getAttribute('tabindex') === '0')).toBe(true)
    expect(regions[0].getAttribute('aria-label')).toBe('企業ごとの、成長性・収益性・安定性の判定')
  })

  test('選び方の案内(足りない・上限)は、読み上げ領域に入れる', () => {
    const many = Array.from({ length: 7 }, (_, i) => company({ id: `X${i}`, unit: '百万円' }))
    renderView(many)
    const boxes = () => screen.getAllByRole('checkbox')
    fireEvent.click(boxes()[4])
    fireEvent.click(boxes()[5])
    expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('選べるのは 6 社までです'))).toBe(true)
    for (let i = 0; i < 6; i += 1) fireEvent.click(boxes()[i])
    expect(screen.getAllByRole('status').some((s) => s.textContent?.includes('2 社以上を選ぶと'))).toBe(true)
  })

  test('グラフの読み上げ用の文: 算出できない企業は、「算出できません」と書く', () => {
    const insolvent = company({ id: 'I', unit: '百万円', bs: { equity: 0, otherFixedLiabilities: 500 } })
    renderView([A, insolvent])
    fireEvent.change(screen.getByLabelText('比べる指標'), { target: { value: 'roe' } })
    expect(screen.getByText(/I社 算出できません/)).toBeTruthy()
    // 棒が出ない企業は、見える文でも知らせる(グラフから、黙って消えないように)
    expect(screen.getByText((t) => t.includes('算出できないため、棒を出していない企業') && t.includes('I社(債務超過)'))).toBeTruthy()
  })
})

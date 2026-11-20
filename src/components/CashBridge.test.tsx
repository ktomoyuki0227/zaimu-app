// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SAMPLE_COMPANY } from '../data/sample'
import type { CashBridge } from '../domain/cashReconciliation'
import { basePeriod } from '../domain/fixtures'
import type { Company, IncomeStatementInput, PeriodData } from '../domain/types'
import { CashBridgeView } from './CashBridge'
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

const MATCHING: CashBridge = {
  begin: 1000,
  beginSource: 'previous',
  operating: 500,
  investing: -300,
  financing: -100,
  fx: 20,
  fxReported: true,
  other: 0,
  end: 1120,
  matches: true,
  tolerance: 3,
  balanceSheetCash: 1120,
  balanceSheetGap: 0,
}

function rowTexts(): string[] {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => r.textContent ?? '')
}

describe('CashBridgeView: 期首 → 営業・投資・財務・為替 → 期末', () => {
  test('式の順(期首、営業、投資、財務、為替、期末)に、符号つきで並べ、単位を出す', () => {
    render(<CashBridgeView bridge={MATCHING} unit="百万円" />)
    const rows = rowTexts()
    expect(rows).toHaveLength(6)
    expect(rows[0]).toContain('期首の現金及び現金同等物')
    expect(rows[0]).toContain('1,000')
    expect(rows[1]).toContain('営業活動によるキャッシュフロー')
    expect(rows[1]).toContain('+500')
    expect(rows[2]).toContain('投資活動によるキャッシュフロー')
    expect(rows[2]).toContain('-300')
    expect(rows[3]).toContain('財務活動によるキャッシュフロー')
    expect(rows[3]).toContain('-100')
    expect(rows[4]).toContain('為替の影響')
    expect(rows[4]).toContain('+20')
    expect(rows[5]).toContain('期末の現金及び現金同等物')
    expect(rows[5]).toContain('1,120')
    expect(screen.getByText('単位: 百万円')).toBeTruthy()
  })

  test('合っているときは、色だけでなく言葉で「確認: 合っています」と伝え、「その他」の行は出さない', () => {
    render(<CashBridgeView bridge={MATCHING} unit="百万円" />)
    expect(screen.getByRole('heading', { level: 5, name: '確認: 現金の増減と合っています' })).toBeTruthy()
    expect(rowTexts().some((r) => r.includes('その他'))).toBe(false)
  })

  test('合わないときは「注意」と差の大きさ・向きを言葉で伝え、「その他」の行を足す', () => {
    render(<CashBridgeView bridge={{ ...MATCHING, other: 400, end: 1520, matches: false }} unit="百万円" />)
    expect(screen.getByRole('heading', { level: 5, name: '注意: 式が合いません(差 +400)' })).toBeTruthy()
    expect(screen.getByText(/より 400 多くなっています/)).toBeTruthy()
    const rows = rowTexts()
    expect(rows).toHaveLength(7)
    expect(rows[5]).toContain('その他の増減')
    expect(rows[5]).toContain('+400')
    expect(rows[6]).toContain('期末の現金及び現金同等物')
  })

  test('期末の現金が式より少ないときは「少なく」と書く', () => {
    render(<CashBridgeView bridge={{ ...MATCHING, other: -115_933, end: 1, matches: false }} unit="百万円" />)
    expect(screen.getByText(/より 115,933 少なくなっています/)).toBeTruthy()
  })

  test('期首の出どころを書く(前の期の期末残高 / 割り出し)。割り出したときは、差の意味も補う', () => {
    const { rerender } = render(<CashBridgeView bridge={MATCHING} unit="百万円" />)
    expect(screen.getByText('前の期の期末残高')).toBeTruthy()
    rerender(<CashBridgeView bridge={{ ...MATCHING, beginSource: 'derived' }} unit="百万円" />)
    expect(screen.getByText(/期末残高から、書類の増減額を引いて割り出しました/)).toBeTruthy()
    rerender(<CashBridgeView bridge={{ ...MATCHING, beginSource: 'derived', other: 50, matches: false }} unit="百万円" />)
    expect(screen.getByText(/期首は割り出した値なので/)).toBeTruthy()
  })

  test('為替の影響が書類に無いときは、0 として計算したことを書く', () => {
    render(<CashBridgeView bridge={{ ...MATCHING, fx: 0, fxReported: false }} unit="百万円" />)
    expect(screen.getByText('書類に記載がないので、0 として計算しました')).toBeTruthy()
  })

  test('貸借対照表の現金預金との関係: 同じなら「同じです」、違えば差と理由(誤りではない)を書く', () => {
    const { rerender } = render(<CashBridgeView bridge={MATCHING} unit="百万円" />)
    expect(screen.getByText('貸借対照表の現金預金(1,120)と同じです。')).toBeTruthy()
    rerender(<CashBridgeView bridge={{ ...MATCHING, balanceSheetCash: 1420, balanceSheetGap: -300 }} unit="百万円" />)
    expect(screen.getByText(/貸借対照表の現金預金は 1,420 で、期末の現金及び現金同等物との差は -300 です/)).toBeTruthy()
    expect(screen.getByText(/範囲が違うため、同じ数字にならないことがあります/)).toBeTruthy()
  })

  test('貸借対照表の現金預金が 0(読み取れなかった仮置きかもしれない)ときは、比べず、もっともらしい説明もしない', () => {
    render(<CashBridgeView bridge={{ ...MATCHING, balanceSheetCash: 0, balanceSheetGap: 1120 }} unit="百万円" />)
    expect(screen.queryByText(/貸借対照表の現金預金/)).toBeNull()
  })

  test('割り出した期首で合っているときは、独立には確かめられていないと正直に書く', () => {
    render(<CashBridgeView bridge={{ ...MATCHING, beginSource: 'derived' }} unit="百万円" />)
    expect(screen.getByRole('heading', { level: 5, name: '確認: 書類の増減額と合っています' })).toBeTruthy()
    expect(screen.getByText(/独立には確かめられていません/)).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 5, name: '確認: 現金の増減と合っています' })).toBeNull()
  })

  test('合っている範囲でも、丸めの差があれば、表の数字が足し合わさるように「丸めによる差」の行を出す', () => {
    render(<CashBridgeView bridge={{ ...MATCHING, other: 2, end: 1122 }} unit="百万円" />)
    const rows = rowTexts()
    expect(rows).toHaveLength(7)
    expect(rows[5]).toContain('丸めによる差')
    expect(rows[5]).toContain('+2')
    expect(screen.getByRole('heading', { level: 5, name: '確認: 現金の増減と合っています' })).toBeTruthy()
  })

  test('画面に出す細かさ(小数 1 桁)より小さい差は、「0」にしか見えないので、行を出さない', () => {
    render(<CashBridgeView bridge={{ ...MATCHING, other: 0.002, end: 1120.002 }} unit="百万円" />)
    expect(rowTexts()).toHaveLength(6)
  })

  test('突き合わせできないときは、そろっていない数字と、取り込み直しを案内する', () => {
    render(<CashBridgeView bridge={null} unit="百万円" />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/突き合わせに必要な数字/)).toBeTruthy()
    expect(screen.getByText(/もう一度取り込むと/)).toBeTruthy()
  })

  test('単位の記録が無いときは「単位: 不明」', () => {
    render(<CashBridgeView bridge={MATCHING} unit={undefined} />)
    expect(screen.getByText('単位: 不明')).toBeTruthy()
  })
})

function period(label: string, pl: Partial<IncomeStatementInput>): PeriodData {
  return { ...basePeriod, label, pl: { ...basePeriod.pl, ...pl } }
}

describe('CashFlowView: 現金の増減との突き合わせ', () => {
  test('練習用データ: 最新の期は、前の期の期末残高を期首にして、式が合う', () => {
    render(<CashFlowView company={SAMPLE_COMPANY} />)
    expect(screen.getByRole('heading', { level: 4, name: '現金の増減との突き合わせ' })).toBeTruthy()
    // 最後の期(2025): 期首 1,150 + 780 − 300 − 130 = 1,500(為替の影響は無し)
    const bridgeRows = within(screen.getAllByRole('table')[0]).getAllByRole('row').slice(1).map((r) => r.textContent ?? '')
    expect(bridgeRows).toHaveLength(6)
    expect(bridgeRows[0]).toContain('1,150')
    expect(bridgeRows[0]).toContain('前の期の期末残高')
    expect(bridgeRows[5]).toContain('1,500')
    expect(screen.getByRole('heading', { level: 5, name: '確認: 現金の増減と合っています' })).toBeTruthy()
  })

  test('期を切り替えると、その期の突き合わせになる(最初の期は、増減額から期首を割り出す)', () => {
    render(<CashFlowView company={SAMPLE_COMPANY} />)
    fireEvent.change(screen.getByLabelText('詳しく見る期'), { target: { value: '0' } })
    const bridge = within(screen.getAllByRole('table')[0])
    const rows = bridge.getAllByRole('row').slice(1).map((r) => r.textContent ?? '')
    // 最初の期: 期末 900、増減額 -50 → 期首 950
    expect(rows[0]).toContain('950')
    expect(rows[0]).toContain('割り出しました')
  })

  test('比較表に、為替の影響・期末残高・突き合わせの結果(言葉)の行が付く', () => {
    render(<CashFlowView company={SAMPLE_COMPANY} />)
    const tables = screen.getAllByRole('table')
    const compare = within(tables[tables.length - 1])
    const rows = compare.getAllByRole('row').map((r) => r.textContent ?? '')
    const fx = rows.find((r) => r.startsWith('為替の影響'))
    const end = rows.find((r) => r.startsWith('現金及び現金同等物の期末残高'))
    const check = rows.find((r) => r.startsWith('現金の増減との突き合わせ'))
    expect(fx).toBeTruthy()
    expect(end).toContain('1,500')
    expect(check).toBe('現金の増減との突き合わせ一致一致一致一致一致')
  })

  test('比較表: 差がある期は「差あり(差)」、突き合わせできない期は「—」', () => {
    const company: Company = {
      id: 'x',
      name: 'テスト社',
      unit: '百万円',
      periods: [
        // 期末残高が無い期(古い保存データ)
        period('2023年3月期', { operatingCashFlow: 1, investingCashFlow: -1, financingCashFlow: -1 }),
        period('2024年3月期', { operatingCashFlow: 500, investingCashFlow: -300, financingCashFlow: -100, cashEnd: 1000, cashChange: 100 }),
        // 前の期の期末 1,000 + 100 = 1,100 のはずが、1,500(400 多い)
        period('2025年3月期', { operatingCashFlow: 500, investingCashFlow: -300, financingCashFlow: -100, cashEnd: 1500 }),
      ],
    }
    render(<CashFlowView company={company} />)
    const tables = screen.getAllByRole('table')
    const compare = within(tables[tables.length - 1])
    const check = compare.getAllByRole('row').map((r) => r.textContent ?? '').find((r) => r.startsWith('現金の増減との突き合わせ'))
    expect(check).toBe('現金の増減との突き合わせ照合不可一致差あり(+400)')
    // 最新の期(差あり)の説明
    expect(screen.getByRole('heading', { level: 5, name: '注意: 式が合いません(差 +400)' })).toBeTruthy()
  })

  test('現金残高の数字が無い企業(古い保存データ)は、突き合わせられないと案内するだけで、ほかの表示は崩さない', () => {
    const company: Company = {
      id: 'x',
      name: 'テスト社',
      unit: '百万円',
      periods: [period('2025年3月期', { operatingCashFlow: 500, investingCashFlow: -300, financingCashFlow: -100 })],
    }
    render(<CashFlowView company={company} />)
    expect(screen.getByText(/突き合わせに必要な数字/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 4, name: '営業活動によるキャッシュフロー' })).toBeTruthy()
  })
})

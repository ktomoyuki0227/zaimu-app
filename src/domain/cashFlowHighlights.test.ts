import { describe, expect, test } from 'vitest'
import { bridgeNote, cashConversionNote, cashFlowHighlights, freeCashFlowNote, streakNote } from './cashFlowHighlights'
import type { CashFlowSummary } from './cashFlow'
import type { CashBridge } from './cashReconciliation'
import { basePeriod } from './fixtures'
import type { Basis, IncomeStatementInput, PeriodData } from './types'

// 基準データの当期純利益は 50
function period(label: string, pl: Partial<IncomeStatementInput> = {}, basis?: Basis): PeriodData {
  return { ...basePeriod, label, ...(basis === undefined ? {} : { basis }), pl: { ...basePeriod.pl, ...pl } }
}

const cf = (operating: number, investing = -10, financing = -10): Partial<IncomeStatementInput> => ({
  operatingCashFlow: operating,
  investingCashFlow: investing,
  financingCashFlow: financing,
})

describe('cashFlowHighlights', () => {
  test('最新の期の、3 区分・フリーキャッシュフロー・型を返す', () => {
    const h = cashFlowHighlights([period('2024年3月期', cf(80)), period('2025年3月期', cf(120, -50, -30))])
    expect(h?.label).toBe('2025年3月期')
    expect(h?.summary).toMatchObject({ operating: 120, investing: -50, financing: -30, free: 70, net: 40 })
    expect(h?.summary.pattern?.title).toBe('安定した型')
  })

  test('最新の期にキャッシュフローの数字が 1 つも無ければ null(古い保存データ)', () => {
    expect(cashFlowHighlights([period('2024年3月期', cf(80)), period('2025年3月期')])).toBeNull()
    expect(cashFlowHighlights([])).toBeNull()
  })

  test('古い期にだけ数字が無くても、最新の期で出す', () => {
    expect(cashFlowHighlights([period('2024年3月期'), period('2025年3月期', cf(80))])?.label).toBe('2025年3月期')
  })

  describe('営業キャッシュフローの続き方', () => {
    test('直近から、同じ符号が続いた期の数(2 期以上のとき)', () => {
      const plus = cashFlowHighlights([period('2023年3月期', cf(-5)), period('2024年3月期', cf(10)), period('2025年3月期', cf(20))])
      expect(plus?.streak).toEqual({ sign: 'plus', count: 2 })
      const minus = cashFlowHighlights([period('2023年3月期', cf(5)), period('2024年3月期', cf(-10)), period('2025年3月期', cf(-20))])
      expect(minus?.streak).toEqual({ sign: 'minus', count: 2 })
    })

    test('1 期だけなら続いていない(null)。符号が変わった期で途切れる', () => {
      expect(cashFlowHighlights([period('2025年3月期', cf(20))])?.streak).toBeNull()
      expect(cashFlowHighlights([period('2024年3月期', cf(-10)), period('2025年3月期', cf(20))])?.streak).toBeNull()
    })

    test('連結と単体が切り替わる所で途切れる(範囲の違う数字を、同じ続きとして数えない)', () => {
      const h = cashFlowHighlights([
        period('2022年12月期', cf(10), 'individual'),
        period('2023年12月期', cf(10), 'individual'),
        period('2024年12月期', cf(10), 'individual'),
        period('2025年12月期', cf(10), 'consolidated'),
      ])
      expect(h?.streak).toBeNull()
      const twoSame = cashFlowHighlights([
        period('2023年12月期', cf(10), 'individual'),
        period('2024年12月期', cf(10), 'consolidated'),
        period('2025年12月期', cf(10), 'consolidated'),
      ])
      expect(twoSame?.streak).toEqual({ sign: 'plus', count: 2 })
    })

    test('期が抜けている所(1 年おきでない)で途切れる。期の名前が読めないときは、つながっているとみなす', () => {
      const gap = cashFlowHighlights([period('2021年3月期', cf(10)), period('2023年3月期', cf(10)), period('2025年3月期', cf(10))])
      expect(gap?.streak).toBeNull()
      const unnamed = cashFlowHighlights([period('前々期', cf(10)), period('前期', cf(10)), period('当期', cf(10))])
      expect(unnamed?.streak).toEqual({ sign: 'plus', count: 3 })
    })

    test('数字の無い期・0 の期で途切れる(0 は、プラスにもマイナスにも数えない)', () => {
      const gap = cashFlowHighlights([period('2023年3月期', cf(10)), period('2024年3月期'), period('2025年3月期', cf(20))])
      expect(gap?.streak).toBeNull()
      const zero = cashFlowHighlights([period('2024年3月期', cf(10)), period('2025年3月期', cf(0))])
      expect(zero?.streak).toBeNull()
    })
  })

  describe('利益との関係(営業キャッシュフロー ÷ 当期純利益)', () => {
    test('純利益(50)がプラスなら、営業キャッシュフローとの比', () => {
      expect(cashFlowHighlights([period('2025年3月期', cf(100))])?.cashConversion).toBe(2)
      expect(cashFlowHighlights([period('2025年3月期', cf(25))])?.cashConversion).toBe(0.5)
      expect(cashFlowHighlights([period('2025年3月期', cf(-25))])?.cashConversion).toBe(-0.5)
    })

    test('純利益が 0 以下、または営業キャッシュフローが無いときは null(比にならない)', () => {
      const loss = period('2025年3月期', { ...cf(100), sales: 500 })
      expect(cashFlowHighlights([loss])?.cashConversion).toBeNull()
      // 純利益がちょうど 0(売上 1000 − 原価 600 − 販管費 300 + 営業外 20 − 利息 10 − その他 10 − 特損 10 − 税 40 = 50 から、売上を 50 減らす)
      const zero = period('2025年3月期', { ...cf(100), sales: 950 })
      expect(cashFlowHighlights([zero])?.cashConversion).toBeNull()
      const noOperating = period('2025年3月期', { investingCashFlow: -10, financingCashFlow: -10 })
      expect(cashFlowHighlights([noOperating])?.cashConversion).toBeNull()
    })
  })

  test('連結と単体が混ざる企業は、最新の期がどちらの数字かを書く。混ざらなければ null', () => {
    const mixed = cashFlowHighlights([period('2024年12月期', cf(10), 'individual'), period('2025年12月期', cf(10), 'consolidated')])
    expect(mixed?.basisNote).toBe('連結と単体が混ざる企業です。2025年12月期は、連結の数字です。')
    const same = cashFlowHighlights([period('2024年12月期', cf(10), 'consolidated'), period('2025年12月期', cf(10), 'consolidated')])
    expect(same?.basisNote).toBeNull()
    expect(cashFlowHighlights([period('2025年12月期', cf(10))])?.basisNote).toBeNull()
  })

  test('現金の突き合わせ: 前の期の期末残高があれば、期首に使って合わせる。無ければ null', () => {
    const previous = period('2024年3月期', { ...cf(0), cashEnd: 1000 })
    const latest = period('2025年3月期', { operatingCashFlow: 500, investingCashFlow: -300, financingCashFlow: -100, cashEnd: 1100 })
    expect(cashFlowHighlights([previous, latest])?.bridge).toMatchObject({ matches: true, beginSource: 'previous' })
    expect(cashFlowHighlights([latest])?.bridge).toBeNull()
  })
})

describe('文章', () => {
  test('続き方: プラスは安心、マイナスは注意と、期数を書く', () => {
    expect(streakNote({ sign: 'plus', count: 3 })).toBe('営業キャッシュフローは、直近 3 期、続けてプラスです(本業で、現金を稼ぎ続けています)。')
    expect(streakNote({ sign: 'minus', count: 2 })).toContain('続けてマイナス')
    expect(streakNote({ sign: 'minus', count: 2 })).toContain('資金繰りが苦しくなります')
  })

  test('利益との関係: 1 倍以上 / 1 倍未満 / マイナス の 3 通り(1 倍ちょうどは、裏付けあり)', () => {
    expect(cashConversionNote(1.5)).toContain('1.5 倍')
    expect(cashConversionNote(1.5)).toContain('現金でも裏付けられています')
    expect(cashConversionNote(1)).toContain('裏付けられています')
    expect(cashConversionNote(0.4)).toContain('0.4 倍')
    expect(cashConversionNote(0.4)).toContain('利益ほどには、現金が入っていません')
    expect(cashConversionNote(0)).toContain('利益ほどには')
    // 画面に出す倍率(小数 1 桁)に合わせて読む: 0.96 は「1.0 倍」と出るので、「利益ほどには…」とは言わない
    expect(cashConversionNote(0.96)).toContain('1.0 倍')
    expect(cashConversionNote(0.96)).toContain('裏付けられています')
    expect(cashConversionNote(0.94)).toContain('0.9 倍')
    expect(cashConversionNote(0.94)).toContain('利益ほどには')
    // 純利益が小さいだけで、倍率が膨らむときは「以上」
    expect(cashConversionNote(9.96)).toContain('10.0 倍')
    expect(cashConversionNote(10)).toContain('10 倍以上')
    expect(cashConversionNote(5000)).toContain('10 倍以上')
    expect(cashConversionNote(5000)).not.toContain('5000')
    expect(cashConversionNote(-0.2)).toBe('利益は出ていますが、営業キャッシュフローはマイナスです(利益が、現金になっていません)。')
  })

  test('フリーキャッシュフロー: 営業の符号で読み方を変える(営業マイナスのプラスは、稼ぎではない)', () => {
    const note = (operating: number | null, investing: number | null) =>
      freeCashFlowNote({
        operating,
        investing,
        financing: null,
        free: operating === null || investing === null ? null : operating + investing,
      } as CashFlowSummary)
    expect(note(100, -40)).toBe('本業の稼ぎで、投資をまかなえています')
    expect(note(100, -150)).toBe('投資が、本業の稼ぎを上回っています')
    expect(note(100, -100)).toBe('本業の稼ぎと、投資が、同じ額です')
    expect(note(-20, 50)).toContain('本業で現金が出ていますが')
    expect(note(-20, 50)).not.toContain('まかなえています')
    expect(note(-30, -40)).toBe('本業で現金が出ていて、さらに投資にも使っています')
    expect(note(0, 0)).toContain('本業で現金が出ていますが')
    expect(note(null, -10)).toBeNull()
    expect(note(10, null)).toBeNull()
  })

  test('現金の突き合わせ: 合っている / 期首を割り出した / 差がある / できない', () => {
    const base: CashBridge = {
      begin: 1000,
      beginSource: 'previous',
      operating: 500,
      investing: -300,
      financing: -100,
      fx: 0,
      fxReported: false,
      other: 0,
      end: 1100,
      matches: true,
      tolerance: 3,
      balanceSheetCash: 1100,
      balanceSheetGap: 0,
    }
    expect(bridgeNote(base)).toContain('期首の現金から期末の現金への流れが')
    expect(bridgeNote({ ...base, beginSource: 'derived' })).toContain('書類の現金の増減額は')
    expect(bridgeNote({ ...base, other: 400, matches: false })).toContain('現金の突き合わせに差があります')
    expect(bridgeNote(null)).toBeNull()
  })
})

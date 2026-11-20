import { describe, expect, test } from 'vitest'
import {
  CASH_FLOW_KINDS,
  cashFlowMeaning,
  cashFlowPattern,
  cashFlowValue,
  hasCashFlow,
  signOf,
  summarizeCashFlow,
} from './cashFlow'
import { basePeriod } from './fixtures'
import { CASH_FLOW_KEYS, type PeriodData } from './types'

function withCashFlow(operating?: number, investing?: number, financing?: number): PeriodData {
  return {
    ...basePeriod,
    pl: {
      ...basePeriod.pl,
      ...(operating === undefined ? {} : { operatingCashFlow: operating }),
      ...(investing === undefined ? {} : { investingCashFlow: investing }),
      ...(financing === undefined ? {} : { financingCashFlow: financing }),
    },
  }
}

describe('キャッシュフローの並び', () => {
  test('正式な順(営業 → 投資 → 財務)で、データの項目の順と一致する', () => {
    expect(CASH_FLOW_KEYS).toEqual(['operatingCashFlow', 'investingCashFlow', 'financingCashFlow'])
    expect(CASH_FLOW_KINDS.map((k) => k.key)).toEqual([...CASH_FLOW_KEYS])
    expect(CASH_FLOW_KINDS.map((k) => k.label)).toEqual([
      '営業活動によるキャッシュフロー',
      '投資活動によるキャッシュフロー',
      '財務活動によるキャッシュフロー',
    ])
  })
})

describe('符号と意味', () => {
  test('プラス・マイナス・ゼロ', () => {
    expect(signOf(1)).toBe('plus')
    expect(signOf(-0.5)).toBe('minus')
    expect(signOf(0)).toBe('zero')
  })

  test('区分ごとに、プラスとマイナスで意味が違う(投資は、マイナスが普通の「投資している」)', () => {
    expect(cashFlowMeaning('operatingCashFlow', 100)).toContain('稼いで')
    expect(cashFlowMeaning('operatingCashFlow', -100)).toContain('出ていって')
    expect(cashFlowMeaning('investingCashFlow', -100)).toContain('投資')
    expect(cashFlowMeaning('investingCashFlow', 100)).toContain('売却')
    expect(cashFlowMeaning('financingCashFlow', 100)).toContain('調達')
    expect(cashFlowMeaning('financingCashFlow', -100)).toContain('返しました')
    expect(cashFlowMeaning('financingCashFlow', 0)).toContain('出入りはありません')
  })
})

describe('お金の流れの型(営業・投資・財務の符号の組み合わせ)', () => {
  const cases: readonly [number, number, number, string, boolean][] = [
    [1, -1, -1, '安定した型', false],
    [1, -1, 1, '積極的に投資している型', false],
    [1, 1, -1, '投資を減らし、返済している型', false],
    [1, 1, 1, 'どの区分でも資金が入った型', false],
    [-1, -1, 1, '借入に頼る型', true],
    [-1, 1, -1, '資産を売って、返済している型', true],
    [-1, 1, 1, '資産の売却と借入で、穴埋めしている型', true],
    [-1, -1, -1, '手元の資金を取り崩している型', true],
  ]

  test.each(cases)('営業 %i・投資 %i・財務 %i → %s', (op, inv, fin, title, caution) => {
    const pattern = cashFlowPattern(op * 100, inv * 100, fin * 100)
    expect(pattern?.title).toBe(title)
    expect(pattern?.caution).toBe(caution)
  })

  test('8 通りは、すべて違う型(題名が重ならない)', () => {
    const titles = new Set(cases.map(([o, i, f]) => cashFlowPattern(o, i, f)?.title))
    expect(titles.size).toBe(8)
  })

  test('「注意」の型は、営業がマイナスの 4 つだけ(営業がプラスの 4 つは、注意にしない)', () => {
    for (const [o, i, f] of cases) {
      expect(cashFlowPattern(o, i, f)?.caution, `${o} ${i} ${f}`).toBe(o < 0)
    }
  })

  test('「どの区分でも資金が入った型」は、1 期だけで「増え続ける」とは言わない', () => {
    const pattern = cashFlowPattern(1, 1, 1)
    expect(pattern?.title).not.toContain('増え続ける')
  })

  test('3 つがそろっていない・どれかが 0 のときは、型を決めない(営業・投資・財務のどれが 0 でも)', () => {
    expect(cashFlowPattern(null, -1, -1)).toBeNull()
    expect(cashFlowPattern(1, null, -1)).toBeNull()
    expect(cashFlowPattern(1, -1, null)).toBeNull()
    expect(cashFlowPattern(0, -1, -1)).toBeNull()
    expect(cashFlowPattern(1, 0, -1)).toBeNull()
    expect(cashFlowPattern(1, -1, 0)).toBeNull()
  })

  test('営業 + 投資がマイナス(投資が本業の稼ぎを上回る)ときは、符号が同じ型でも、金額についての補足を付ける', () => {
    const big = cashFlowPattern(100, -900, -50)
    expect(big?.title).toBe('安定した型')
    expect(big?.note).toContain('投資が本業の稼ぎを上回っています')
    const bigPlus = cashFlowPattern(100, -900, 800)
    expect(bigPlus?.title).toBe('積極的に投資している型')
    expect(bigPlus?.note).toContain('フリーキャッシュフローがマイナス')
  })

  test('本業の稼ぎが投資をまかなえているときは、補足を付けない', () => {
    expect(cashFlowPattern(1000, -400, -200)?.note).toBeNull()
    // 営業がマイナスの型には、この補足は付けない(型そのものが注意)
    expect(cashFlowPattern(-100, -900, 800)?.note).toBeNull()
  })
})

describe('summarizeCashFlow', () => {
  test('フリーキャッシュフローは営業 + 投資、合計は 3 区分の和', () => {
    const s = summarizeCashFlow(withCashFlow(1000, -400, -200))
    expect(s.operating).toBe(1000)
    expect(s.investing).toBe(-400)
    expect(s.financing).toBe(-200)
    expect(s.free).toBe(600)
    expect(s.net).toBe(400)
    expect(s.pattern?.title).toBe('安定した型')
  })

  test('古いデータで営業しか無いときは、投資・財務・フリー・合計・型を、無いものとして扱う(0 にしない)', () => {
    const s = summarizeCashFlow(withCashFlow(1000))
    expect(s.operating).toBe(1000)
    expect(s.investing).toBeNull()
    expect(s.financing).toBeNull()
    expect(s.free).toBeNull()
    expect(s.net).toBeNull()
    expect(s.pattern).toBeNull()
  })

  test('営業と投資がそろえば、財務が無くても、フリーキャッシュフローは出せる', () => {
    const s = summarizeCashFlow(withCashFlow(500, -700))
    expect(s.free).toBe(-200)
    expect(s.net).toBeNull()
  })

  test('hasCashFlow: 1 つでも数字があれば true、1 つも無ければ false', () => {
    expect(hasCashFlow(withCashFlow(1))).toBe(true)
    expect(hasCashFlow(withCashFlow(undefined, undefined, -1))).toBe(true)
    expect(hasCashFlow(withCashFlow())).toBe(false)
  })
})

describe('cashFlowValue', () => {
  test('区分の名前から、営業・投資・財務の数字を取り出す', () => {
    const s = summarizeCashFlow(withCashFlow(10, -20, 30))
    expect(CASH_FLOW_KINDS.map((k) => cashFlowValue(s, k.key))).toEqual([10, -20, 30])
  })
})

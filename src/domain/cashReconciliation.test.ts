import { describe, expect, test } from 'vitest'
import { CASH_TOLERANCE_STEPS, cashCheckStatus, reconcileCash } from './cashReconciliation'
import { basePeriod } from './fixtures'
import type { Basis, IncomeStatementInput, PeriodData } from './types'

interface Spec {
  readonly label: string
  readonly basis?: Basis
  readonly bsCash?: number
  readonly cf?: Partial<IncomeStatementInput>
}

function period(spec: Spec): PeriodData {
  return {
    ...basePeriod,
    label: spec.label,
    ...(spec.basis === undefined ? {} : { basis: spec.basis }),
    bs: { ...basePeriod.bs, cash: spec.bsCash ?? basePeriod.bs.cash },
    pl: { ...basePeriod.pl, ...spec.cf },
  }
}

/** 営業 500 − 投資 300 − 財務 100 = 100、為替 +20 → 増減 120 */
const FLOWS = { operatingCashFlow: 500, investingCashFlow: -300, financingCashFlow: -100 }

describe('現金の増減との突き合わせ', () => {
  test('前の期の期末残高を期首にして、式が合う(期首 + 3 区分 + 為替 = 期末)', () => {
    const previous = period({ label: '2024年3月期', cf: { cashEnd: 1000 } })
    const current = period({ label: '2025年3月期', cf: { ...FLOWS, fxEffect: 20, cashEnd: 1120 } })
    const bridge = reconcileCash(previous, current)
    expect(bridge).not.toBeNull()
    expect(bridge).toMatchObject({
      begin: 1000,
      beginSource: 'previous',
      operating: 500,
      investing: -300,
      financing: -100,
      fx: 20,
      fxReported: true,
      end: 1120,
      other: 0,
      matches: true,
    })
    expect(cashCheckStatus(bridge)).toBe('match')
  })

  test('為替の影響が書類に無ければ 0 として扱い、無かったことを覚えておく', () => {
    const previous = period({ label: '2024年3月期', cf: { cashEnd: 1000 } })
    const current = period({ label: '2025年3月期', cf: { ...FLOWS, cashEnd: 1100 } })
    const bridge = reconcileCash(previous, current)
    expect(bridge).toMatchObject({ fx: 0, fxReported: false, matches: true })
  })

  test('式が合わないときは、合わない分(その他)を出し、差があると判定する', () => {
    // 合併・連結の範囲の変更などで、現金が 400 増えた
    const previous = period({ label: '2024年3月期', cf: { cashEnd: 1000 } })
    const current = period({ label: '2025年3月期', cf: { ...FLOWS, cashEnd: 1500 } })
    const bridge = reconcileCash(previous, current)
    expect(bridge?.other).toBe(400)
    expect(bridge?.matches).toBe(false)
    expect(cashCheckStatus(bridge)).toBe('gap')
  })

  test('丸めによる数単位の差は、合っていると見なす(許す差の境目)', () => {
    const previous = period({ label: '2024年3月期', cf: { cashEnd: 1000 } })
    const within = period({ label: '2025年3月期', cf: { ...FLOWS, cashEnd: 1100 + CASH_TOLERANCE_STEPS } })
    const beyond = period({ label: '2025年3月期', cf: { ...FLOWS, cashEnd: 1100 + CASH_TOLERANCE_STEPS + 1 } })
    expect(reconcileCash(previous, within)?.matches).toBe(true)
    expect(reconcileCash(previous, beyond)?.matches).toBe(false)
    // マイナス側も同じ
    const below = period({ label: '2025年3月期', cf: { ...FLOWS, cashEnd: 1100 - CASH_TOLERANCE_STEPS } })
    expect(reconcileCash(previous, below)?.matches).toBe(true)
    expect(reconcileCash(previous, within)?.tolerance).toBe(CASH_TOLERANCE_STEPS)
  })

  test('許す差は、書類の金額の刻みに合わせる(千円で出す書類を百万円で表示するときは、0.001 百万円の 3 個分)', () => {
    // 千円の刻みの数字: 期首 1,000.000 + 営業 500.250 − 投資 300.125 − 財務 100.100 + 為替 20.000 = 1,120.025
    const flows = { operatingCashFlow: 500.25, investingCashFlow: -300.125, financingCashFlow: -100.1, fxEffect: 20 }
    const previous = period({ label: '2024年3月期', cf: { cashEnd: 1000 } })
    const exact = reconcileCash(previous, period({ label: '2025年3月期', cf: { ...flows, cashEnd: 1120.025 } }))
    expect(exact).toMatchObject({ matches: true })
    expect(exact?.tolerance).toBeCloseTo(0.003, 9)
    // 2.9 百万円の差は、百万円の書類なら丸めの範囲だが、千円の書類では、本当に説明できない差
    const off = reconcileCash(previous, period({ label: '2025年3月期', cf: { ...flows, cashEnd: 1120.025 + 2.9 } }))
    expect(off?.matches).toBe(false)
    // 3 個分(0.003)までは丸めの範囲、4 個分(0.004)は範囲外
    expect(reconcileCash(previous, period({ label: '2025年3月期', cf: { ...flows, cashEnd: 1120.028 } }))?.matches).toBe(true)
    expect(reconcileCash(previous, period({ label: '2025年3月期', cf: { ...flows, cashEnd: 1120.029 } }))?.matches).toBe(false)
  })

  test('前の期が無いときは、期末残高から増減額を引いて期首を割り出す(その他の分は、増減額と 3 区分 + 為替の差になる)', () => {
    const first = period({ label: '2025年3月期', cf: { ...FLOWS, fxEffect: 20, cashChange: 120, cashEnd: 1120 } })
    const bridge = reconcileCash(undefined, first)
    expect(bridge).toMatchObject({ begin: 1000, beginSource: 'derived', other: 0, matches: true })

    // 書類の増減額(170)が、3 区分 + 為替(120)より 50 多ければ、その分が「その他」に出る(現金が、式の外から 50 増えた)
    const off = period({ label: '2025年3月期', cf: { ...FLOWS, fxEffect: 20, cashChange: 170, cashEnd: 1170 } })
    expect(reconcileCash(undefined, off)).toMatchObject({ begin: 1000, beginSource: 'derived', other: 50, matches: false })
  })

  test('前の期があっても、期末残高が無ければ使えない。増減額が無ければ割り出せない', () => {
    const noEnd = period({ label: '2024年3月期' })
    const current = period({ label: '2025年3月期', cf: { ...FLOWS, cashEnd: 1100 } })
    // 前の期に期末残高が無く、増減額も無いので、期首が決められない
    expect(reconcileCash(noEnd, current)).toBeNull()
    // 増減額があれば割り出せる
    const withChange = period({ label: '2025年3月期', cf: { ...FLOWS, cashEnd: 1100, cashChange: 100 } })
    expect(reconcileCash(noEnd, withChange)).toMatchObject({ beginSource: 'derived', begin: 1000 })
  })

  test('3 区分のどれか、または期末残高が書類に無ければ、突き合わせない', () => {
    const previous = period({ label: '2024年3月期', cf: { cashEnd: 1000 } })
    const full = { ...FLOWS, cashEnd: 1100 }
    for (const key of ['operatingCashFlow', 'investingCashFlow', 'financingCashFlow', 'cashEnd'] as const) {
      const cf: Partial<IncomeStatementInput> = { ...full }
      delete (cf as Record<string, unknown>)[key]
      expect(reconcileCash(previous, period({ label: '2025年3月期', cf }))).toBeNull()
    }
    expect(cashCheckStatus(null)).toBe('none')
  })

  test('0 の区分は「無い」とは違い、突き合わせに使う', () => {
    const previous = period({ label: '2024年3月期', cf: { cashEnd: 1000 } })
    const current = period({
      label: '2025年3月期',
      cf: { operatingCashFlow: 100, investingCashFlow: 0, financingCashFlow: 0, cashEnd: 1100 },
    })
    expect(reconcileCash(previous, current)).toMatchObject({ investing: 0, financing: 0, matches: true })
  })

  describe('前の期を期首に使えない場合(範囲や期がつながっていない)', () => {
    const current = (label: string, basis?: Basis): PeriodData =>
      period({ label, ...(basis === undefined ? {} : { basis }), cf: { ...FLOWS, cashChange: 100, cashEnd: 5000 } })

    test('連結と単体が切り替わる期は、前の期の期末残高を使わず、割り出した期首を使う', () => {
      const previous = period({ label: '2024年3月期', basis: 'individual', cf: { cashEnd: 1000 } })
      const bridge = reconcileCash(previous, current('2025年3月期', 'consolidated'))
      // 前の期(単体)の 1000 ではなく、5000 − 100 = 4900 が期首
      expect(bridge).toMatchObject({ beginSource: 'derived', begin: 4900, matches: true })
    })

    test('1 年おいていない期(間が抜けている)は、前の期として使わない', () => {
      const previous = period({ label: '2023年3月期', cf: { cashEnd: 1000 } })
      expect(reconcileCash(previous, current('2025年3月期'))).toMatchObject({ beginSource: 'derived', begin: 4900 })
    })

    test('決算月が変わった期は、前の期として使わない', () => {
      const previous = period({ label: '2024年12月期', cf: { cashEnd: 1000 } })
      expect(reconcileCash(previous, current('2025年3月期'))).toMatchObject({ beginSource: 'derived' })
    })

    test('期の名前が読めなければ(練習用データなど)、前の期として使わない', () => {
      const previous = period({ label: '前期', cf: { cashEnd: 1000 } })
      expect(reconcileCash(previous, current('当期'))).toMatchObject({ beginSource: 'derived' })
    })

    test('範囲の記録が無い期どうしは、つながっていれば使う(古い保存データ)', () => {
      const previous = period({ label: '2024年3月期', cf: { cashEnd: 4900 } })
      expect(reconcileCash(previous, current('2025年3月期'))).toMatchObject({ beginSource: 'previous', begin: 4900 })
    })
  })

  describe('前の期の並びや範囲の記録が食い違う場合', () => {
    const current = period({ label: '2025年3月期', cf: { ...FLOWS, cashChange: 100, cashEnd: 5000 } })

    test('期が新しい順に並んでいる(前の期のつもりの期が、1 年後)ときは、期首に使わない', () => {
      const later = period({ label: '2026年3月期', cf: { cashEnd: 1000 } })
      expect(reconcileCash(later, current)).toMatchObject({ beginSource: 'derived', begin: 4900 })
    })

    test('範囲の記録が、片方の期にだけあるときは、期首に使わない', () => {
      const previous = period({ label: '2024年3月期', basis: 'consolidated', cf: { cashEnd: 1000 } })
      expect(reconcileCash(previous, current)).toMatchObject({ beginSource: 'derived', begin: 4900 })
    })
  })

  test('実際の書類(トヨタ自動車)の数字: 2025 年 3 月期は合い、2026 年 3 月期は、売却目的保有への振替の分だけ差が出る', () => {
    const y2025 = period({
      label: '2025年3月期',
      basis: 'consolidated',
      cf: {
        operatingCashFlow: 3_696_934,
        investingCashFlow: -4_189_736,
        financingCashFlow: 197_236,
        fxEffect: -134_089,
        cashChange: -429_656,
        cashEnd: 8_982_404,
      },
    })
    const y2024 = period({ label: '2024年3月期', basis: 'consolidated', cf: { cashEnd: 9_412_060 } })
    const y2026 = period({
      label: '2026年3月期',
      basis: 'consolidated',
      cf: {
        operatingCashFlow: 5_472_920,
        investingCashFlow: -1_520_307,
        financingCashFlow: -536_659,
        fxEffect: 377_197,
        cashChange: 3_793_150,
        cashEnd: 12_659_622,
      },
    })
    expect(reconcileCash(y2024, y2025)).toMatchObject({ other: -1, matches: true })
    // 書類の注記: 売却目的保有への振替による現金の減少 115,932(百万円)。丸めの 1 を足して、差は 115,933
    expect(reconcileCash(y2025, y2026)).toMatchObject({ other: -115_933, matches: false, beginSource: 'previous' })
  })

  test('貸借対照表の現金預金との差を出す(現金同等物の定義の違い)', () => {
    const previous = period({ label: '2024年3月期', cf: { cashEnd: 1000 } })
    const current = period({ label: '2025年3月期', bsCash: 1400, cf: { ...FLOWS, cashEnd: 1100 } })
    expect(reconcileCash(previous, current)).toMatchObject({ balanceSheetCash: 1400, balanceSheetGap: -300 })
  })
})

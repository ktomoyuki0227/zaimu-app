import type { PeriodData } from './types'

/**
 * 現金の増減との突き合わせ。
 * キャッシュフロー計算書は、次の式で、期首の現金が期末の現金になる流れを表す。
 *   期首残高 + 営業 + 投資 + 財務 + 為替の影響 = 期末残高
 * 3 区分の数字が、現金の実際の増減と合っているかを確かめる。
 */

/**
 * 突き合わせで許す差(書類の金額の刻みの、何個分まで)。
 * 書類の金額は、百万円・千円などに丸められているので、5〜6 個の数字を足し引きすると、数個分ずれることがある。
 * 刻みは、取り込んだ数字の小数の桁から割り出す(千円で出す書類を、百万円で表示するときは、刻みが 0.001 百万円になる)。
 */
export const CASH_TOLERANCE_STEPS = 3

/** 小数の桁の最大(円まで)。これでも割り切れない数字は、この刻みとして扱う */
const MAX_DECIMALS = 6

/** 数字が、どの刻みの整数倍か(1・0.1・0.01 …)。丸められた書類の金額の、丸めの単位を割り出す */
function granularity(values: readonly number[]): number {
  for (let decimals = 0; decimals <= MAX_DECIMALS; decimals += 1) {
    const scale = 10 ** decimals
    if (values.every((v) => Math.abs(v * scale - Math.round(v * scale)) < 1e-6)) {
      return 1 / scale
    }
  }
  return 1 / 10 ** MAX_DECIMALS
}

/** 期首残高の出どころ。previous: 前の期の期末残高 / derived: 期末残高から増減額を引いて割り出した */
export type BeginSource = 'previous' | 'derived'

export interface CashBridge {
  /** 現金及び現金同等物の期首残高 */
  readonly begin: number
  readonly beginSource: BeginSource
  readonly operating: number
  readonly investing: number
  readonly financing: number
  /** 為替の影響。書類に無ければ 0(fxReported が false) */
  readonly fx: number
  readonly fxReported: boolean
  /**
   * 式が合わない分(期末残高 − 期首残高 − 3 区分 − 為替の影響)。
   * 連結の範囲の変更・合併による現金の増減や、書類の読み取り漏れなど。
   */
  readonly other: number
  /** 現金及び現金同等物の期末残高 */
  readonly end: number
  /** 式が、許す差の範囲で合っているか */
  readonly matches: boolean
  /** 許す差(書類の金額の刻みの CASH_TOLERANCE_STEPS 個分) */
  readonly tolerance: number
  /** 貸借対照表の現金預金 */
  readonly balanceSheetCash: number
  /** 期末残高 − 貸借対照表の現金預金 */
  readonly balanceSheetGap: number
}

/** 「2025年3月期」を、年と月にする。読めなければ null */
function yearMonth(label: string): { readonly year: number; readonly month: number } | null {
  const match = /^(\d{4})年(\d{1,2})月期$/.exec(label)
  return match === null ? null : { year: Number(match[1]), month: Number(match[2]) }
}

/** 前の期が、ちょうど 1 年前の同じ月の決算で、数字の範囲(連結・単体)も同じか。そうでなければ、期首残高としては使えない */
function isDirectPredecessor(previous: PeriodData, period: PeriodData): boolean {
  if (previous.basis !== period.basis) return false
  const before = yearMonth(previous.label)
  const now = yearMonth(period.label)
  return before !== null && now !== null && now.year - before.year === 1 && now.month === before.month
}

/** 期首残高。前の期の期末残高があればそれ。無ければ、期末残高から増減額を引いて割り出す。どちらも無ければ null */
function beginBalance(
  previous: PeriodData | undefined,
  period: PeriodData,
  end: number,
): { readonly value: number; readonly source: BeginSource } | null {
  const previousEnd = previous !== undefined && isDirectPredecessor(previous, period) ? previous.pl.cashEnd : undefined
  if (previousEnd !== undefined) {
    return { value: previousEnd, source: 'previous' }
  }
  const change = period.pl.cashChange
  return change === undefined ? null : { value: end - change, source: 'derived' }
}

/**
 * 1 期分の、現金の増減の流れ(期首 → 営業・投資・財務・為替 → 期末)と、式が合うか。
 * 営業・投資・財務の 3 区分か、期末残高が書類に無いとき、期首残高を決められないときは null。
 * previous は、リストでその期のすぐ前にある期(無ければ undefined)。
 */
export function reconcileCash(previous: PeriodData | undefined, period: PeriodData): CashBridge | null {
  const { operatingCashFlow, investingCashFlow, financingCashFlow, cashEnd, fxEffect } = period.pl
  if (
    operatingCashFlow === undefined ||
    investingCashFlow === undefined ||
    financingCashFlow === undefined ||
    cashEnd === undefined
  ) {
    return null
  }
  const begin = beginBalance(previous, period, cashEnd)
  if (begin === null) {
    return null
  }
  const fx = fxEffect ?? 0
  const other = cashEnd - begin.value - (operatingCashFlow + investingCashFlow + financingCashFlow) - fx
  // 浮動小数の端数で、境目の判定がぶれないように、ごく小さな余裕を足す
  const tolerance =
    CASH_TOLERANCE_STEPS * granularity([cashEnd, begin.value, operatingCashFlow, investingCashFlow, financingCashFlow, fx])
  return {
    begin: begin.value,
    beginSource: begin.source,
    operating: operatingCashFlow,
    investing: investingCashFlow,
    financing: financingCashFlow,
    fx,
    fxReported: fxEffect !== undefined,
    other,
    end: cashEnd,
    matches: Math.abs(other) <= tolerance + 1e-9,
    tolerance,
    balanceSheetCash: period.bs.cash,
    balanceSheetGap: cashEnd - period.bs.cash,
  }
}

/** 突き合わせの結果の見出し用の区分。none: 突き合わせできない / match: 合っている / gap: 差がある */
export type CashCheckStatus = 'none' | 'match' | 'gap'

export function cashCheckStatus(bridge: CashBridge | null): CashCheckStatus {
  if (bridge === null) return 'none'
  return bridge.matches ? 'match' : 'gap'
}

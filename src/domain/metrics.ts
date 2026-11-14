import { deriveStatements } from './statements'
import type { PeriodData } from './types'

/** 債務償還年数の計算に使ったキャッシュフローの出所 */
export type DebtRepaymentBasis = 'operatingCashFlow' | 'approximate' | 'none'

export const METRIC_KEYS = [
  // 収益性
  'grossMargin', // 売上高総利益率
  'operatingMargin', // 売上高営業利益率
  'ordinaryMargin', // 売上高経常利益率
  'ordinaryReturnOnAssets', // 総資本経常利益率
  'roa', // 当期純利益 / 総資産
  'roe', // 当期純利益 / 自己資本
  'totalAssetTurnover', // 総資本回転率(回)
  // 安定性
  'currentRatio', // 流動比率
  'quickRatio', // 当座比率
  'equityRatio', // 自己資本比率
  'fixedRatio', // 固定比率
  'fixedLongTermRatio', // 固定長期適合率
  'debtToEquity', // 負債比率
  'interestBearingDebtMultiple', // 有利子負債倍率(倍)
  'debtRepaymentYears', // 債務償還年数(年)
  'interestCoverage', // インタレスト・カバレッジ・レシオ(倍)
] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

/**
 * 指標を算出できなかった理由。
 * - insolvent: 自己資本が 0 以下(債務超過)で、自己資本を分母にする指標が意味を持たない
 * - cashFlowShortfall: 借入があるのにキャッシュフローが 0 以下で、返済年数が計算できない
 * - noInterest: 支払利息が 0 で、利息の何倍かを計算できない(良い状態)
 * - noDenominator: 売上高や総資産などの分母が 0 以下
 */
export type UnavailableReason = 'insolvent' | 'cashFlowShortfall' | 'noInterest' | 'noDenominator'

/**
 * 1期分の財務指標。比率は % 、回転率・倍率は倍、償還年数は年。
 * 算出できない指標は null とし、理由を unavailable に残す。
 * 残高を使う指標はすべて期末値ベース(期中平均は使わない)。
 */
export interface Metrics extends Record<MetricKey, number | null> {
  readonly debtRepaymentBasis: DebtRepaymentBasis
  readonly unavailable: Partial<Record<MetricKey, UnavailableReason>>
}

/** 分母が正のときだけ割り算する。0 や負の分母は意味のある指標にならないので null */
function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

function percent(numerator: number, denominator: number): number | null {
  const r = ratio(numerator, denominator)
  return r === null ? null : r * 100
}

interface Repayment {
  readonly years: number | null
  readonly basis: DebtRepaymentBasis
}

/**
 * 債務償還年数 = 有利子負債 ÷ キャッシュフロー。
 * 営業CFが入力されていればそれを使い、無ければ「当期純利益 + 減価償却費」で近似する。
 */
function calcRepayment(
  debt: number,
  netIncome: number,
  depreciation: number,
  operatingCashFlow: number | undefined,
): Repayment {
  if (debt <= 0) {
    return { years: 0, basis: 'none' }
  }
  const hasOcf = operatingCashFlow !== undefined
  const cashFlow = hasOcf ? operatingCashFlow : netIncome + depreciation
  return {
    years: ratio(debt, cashFlow),
    basis: hasOcf ? 'operatingCashFlow' : 'approximate',
  }
}

type Unavailable = Partial<Record<MetricKey, UnavailableReason>>

/** 理由が個別に決まらなかった null には、分母なしの理由を付ける */
function withDefaultReasons(
  values: Record<MetricKey, number | null>,
  specific: Unavailable,
): Unavailable {
  const reasons: Unavailable = { ...specific }
  for (const key of METRIC_KEYS) {
    if (values[key] === null && reasons[key] === undefined) {
      reasons[key] = 'noDenominator'
    }
  }
  return reasons
}

export function calcMetrics(period: PeriodData): Metrics {
  const d = deriveStatements(period)
  const { bs, pl } = period

  const repayment = calcRepayment(
    d.interestBearingDebt,
    d.netIncome,
    pl.depreciation,
    pl.operatingCashFlow,
  )

  const values: Record<MetricKey, number | null> = {
    grossMargin: percent(d.grossProfit, pl.sales),
    operatingMargin: percent(d.operatingProfit, pl.sales),
    ordinaryMargin: percent(d.ordinaryProfit, pl.sales),
    ordinaryReturnOnAssets: percent(d.ordinaryProfit, d.totalAssets),
    roa: percent(d.netIncome, d.totalAssets),
    roe: percent(d.netIncome, bs.equity),
    totalAssetTurnover: ratio(pl.sales, d.totalAssets),
    currentRatio: percent(d.currentAssets, d.currentLiabilities),
    quickRatio: percent(d.quickAssets, d.currentLiabilities),
    equityRatio: percent(bs.equity, d.totalAssets),
    fixedRatio: percent(bs.fixedAssets, bs.equity),
    fixedLongTermRatio: percent(bs.fixedAssets, bs.equity + d.fixedLiabilities),
    debtToEquity: percent(d.totalLiabilities, bs.equity),
    interestBearingDebtMultiple: ratio(d.interestBearingDebt, bs.equity),
    debtRepaymentYears: repayment.years,
    // 受取利息は別項目で持たないため、分子は営業利益 + 営業外収益とする
    interestCoverage: ratio(d.operatingProfit + pl.nonOperatingIncome, pl.interestExpense),
  }

  const specific: Unavailable = {}
  if (bs.equity <= 0) {
    for (const key of ['roe', 'fixedRatio', 'debtToEquity', 'interestBearingDebtMultiple'] as const) {
      specific[key] = 'insolvent'
    }
  }
  if (bs.equity + d.fixedLiabilities <= 0) {
    specific.fixedLongTermRatio = 'insolvent'
  }
  if (repayment.years === null) {
    specific.debtRepaymentYears = 'cashFlowShortfall'
  }
  if (pl.interestExpense <= 0) {
    specific.interestCoverage = 'noInterest'
  }

  return {
    ...values,
    debtRepaymentBasis: repayment.basis,
    unavailable: withDefaultReasons(values, specific),
  }
}

import { deriveStatements } from './statements'
import type { PeriodData } from './types'

/** 前期比の増減率(%)。前期が 0 なら null。赤字の期は絶対値を分母にして改善を正の値で表す */
export function growthRate(previous: number, current: number): number | null {
  if (previous === 0) {
    return null
  }
  return ((current - previous) / Math.abs(previous)) * 100
}

/** 1期分の前期比(%) */
export interface GrowthPoint {
  readonly label: string
  readonly sales: number | null
  readonly grossProfit: number | null
  readonly operatingProfit: number | null
  readonly ordinaryProfit: number | null
  readonly netIncome: number | null
}

/** 2期目以降について、売上と各利益の前期比を並べる */
export function buildGrowthSeries(periods: readonly PeriodData[]): readonly GrowthPoint[] {
  return periods.slice(1).map((curr, i) => {
    const prev = periods[i]
    const p = deriveStatements(prev)
    const c = deriveStatements(curr)
    return {
      label: curr.label,
      sales: growthRate(prev.pl.sales, curr.pl.sales),
      grossProfit: growthRate(p.grossProfit, c.grossProfit),
      operatingProfit: growthRate(p.operatingProfit, c.operatingProfit),
      ordinaryProfit: growthRate(p.ordinaryProfit, c.ordinaryProfit),
      netIncome: growthRate(p.netIncome, c.netIncome),
    }
  })
}

export type GrowthPattern = '増収増益' | '増収減益' | '減収増益' | '減収減益'

/** 売上と営業利益の増減の組み合わせで、成長のパターンを分類する */
export function classifyGrowthPattern(
  salesGrowth: number | null,
  operatingProfitGrowth: number | null,
): GrowthPattern | null {
  if (salesGrowth === null || operatingProfitGrowth === null) {
    return null
  }
  if (salesGrowth >= 0) {
    return operatingProfitGrowth >= 0 ? '増収増益' : '増収減益'
  }
  return operatingProfitGrowth >= 0 ? '減収増益' : '減収減益'
}

/** 売上高を 100% としたときの PL 各項目の構成比(%) */
export interface CommonSizePl {
  readonly costOfSales: number | null
  readonly grossProfit: number | null
  readonly sga: number | null
  readonly operatingProfit: number | null
  readonly ordinaryProfit: number | null
  readonly netIncome: number | null
}

export function commonSizePl(period: PeriodData): CommonSizePl {
  const d = deriveStatements(period)
  const { sales, costOfSales, sga } = period.pl
  const pct = (value: number): number | null => (sales > 0 ? (value / sales) * 100 : null)
  return {
    costOfSales: pct(costOfSales),
    grossProfit: pct(d.grossProfit),
    sga: pct(sga),
    operatingProfit: pct(d.operatingProfit),
    ordinaryProfit: pct(d.ordinaryProfit),
    netIncome: pct(d.netIncome),
  }
}

export type BridgeStepKey = 'salesEffect' | 'marginEffect' | 'sgaEffect' | 'nonOperatingEffect'

export interface BridgeStep {
  readonly key: BridgeStepKey
  readonly label: string
  readonly value: number
}

/** 経常利益の増減要因(ウォーターフォール用) */
export interface ProfitBridge {
  readonly start: number // 前期の経常利益
  readonly steps: readonly BridgeStep[]
  readonly end: number // 今期の経常利益
}

/**
 * 前期から今期への経常利益の増減を、4 つの要因に分解する。
 * - 売上増の効果 = (今期売上 - 前期売上) × 前期の売上総利益率
 * - 粗利率変化の効果 = (今期粗利率 - 前期粗利率) × 今期売上
 *   (この 2 つの合計が売上総利益の増減額と一致する)
 * - 販管費の増減 = -(今期販管費 - 前期販管費)
 * - 営業外損益の増減 = 今期の営業外損益 - 前期の営業外損益
 */
export function profitBridge(previous: PeriodData, current: PeriodData): ProfitBridge {
  const p = deriveStatements(previous)
  const c = deriveStatements(current)

  const prevSales = previous.pl.sales
  const grossProfitChange = c.grossProfit - p.grossProfit

  // 前期売上が 0 だと前期の粗利率が定義できないので、増減をすべて粗利率変化に寄せる
  const salesEffect =
    prevSales > 0 ? (current.pl.sales - prevSales) * (p.grossProfit / prevSales) : 0
  const marginEffect = grossProfitChange - salesEffect

  const nonOperating = (period: PeriodData): number =>
    period.pl.nonOperatingIncome - period.pl.interestExpense - period.pl.otherNonOperatingExpense

  return {
    start: p.ordinaryProfit,
    steps: [
      { key: 'salesEffect', label: '売上増減の効果', value: salesEffect },
      { key: 'marginEffect', label: '粗利率変化の効果', value: marginEffect },
      { key: 'sgaEffect', label: '販管費の増減', value: -(current.pl.sga - previous.pl.sga) },
      {
        key: 'nonOperatingEffect',
        label: '営業外損益の増減',
        value: nonOperating(current) - nonOperating(previous),
      },
    ],
    end: c.ordinaryProfit,
  }
}

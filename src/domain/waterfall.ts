import { deriveStatements } from './statements'
import type { PeriodData } from './types'

export type WaterfallKind = 'total' | 'delta'

export interface WaterfallItem {
  readonly label: string
  readonly value: number
  /** total: 0 から立ち上がる合計・小計 / delta: 直前の累計からの増減 */
  readonly kind: WaterfallKind
}

export interface WaterfallRow {
  readonly label: string
  readonly kind: WaterfallKind
  readonly value: number
  /** 棒の下端と上端。0 をまたぐ場合も [小, 大] の順で入る */
  readonly range: readonly [number, number]
}

/** ウォーターフォール(滝グラフ)用に、各項目の棒の範囲を計算する */
export function buildWaterfall(items: readonly WaterfallItem[]): readonly WaterfallRow[] {
  let running = 0
  return items.map((item) => {
    if (item.kind === 'total') {
      running = item.value
      return {
        label: item.label,
        kind: item.kind,
        value: item.value,
        range: [Math.min(0, item.value), Math.max(0, item.value)] as const,
      }
    }
    const start = running
    running = start + item.value
    return {
      label: item.label,
      kind: item.kind,
      value: item.value,
      range: [Math.min(start, running), Math.max(start, running)] as const,
    }
  })
}

/** 売上高から当期純利益までを 1 段ずつ落としていく PL の階段グラフ用データ */
export function plStaircase(period: PeriodData): readonly WaterfallRow[] {
  const d = deriveStatements(period)
  const { pl } = period
  const nonOperating = pl.nonOperatingIncome - pl.interestExpense - pl.otherNonOperatingExpense
  const extraordinary = pl.extraordinaryGain - pl.extraordinaryLoss

  return buildWaterfall([
    { label: '売上高', value: pl.sales, kind: 'total' },
    { label: '売上原価', value: -pl.costOfSales, kind: 'delta' },
    { label: '売上総利益', value: d.grossProfit, kind: 'total' },
    { label: '販管費', value: -pl.sga, kind: 'delta' },
    { label: '営業利益', value: d.operatingProfit, kind: 'total' },
    { label: '営業外損益', value: nonOperating, kind: 'delta' },
    { label: '経常利益', value: d.ordinaryProfit, kind: 'total' },
    { label: '特別損益', value: extraordinary, kind: 'delta' },
    { label: '法人税等', value: -pl.incomeTaxes, kind: 'delta' },
    { label: '当期純利益', value: d.netIncome, kind: 'total' },
  ])
}

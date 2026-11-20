import { basisLabel } from './basis'
import {
  METRIC_CATALOG,
  evaluateMetric,
  getMetricDefinition,
  roundForDisplay,
  type EvaluationLevel,
  type MetricGroup,
  type MetricKey,
  type MetricUnit,
} from './catalog'
import { summarizeCashFlow } from './cashFlow'
import { calcMetrics, type UnavailableReason } from './metrics'
import { summarize, type AxisKey, type AxisSummary } from './overview'
import { deriveStatements } from './statements'
import type { AmountUnit, Basis, Company, PeriodData } from './types'
import { UNIT_DIVISOR } from './units'

/**
 * 他社比較。取り込んだ企業を、それぞれの最新の期で並べる。
 * 金額は、単位の違う企業を並べられるように、百万円にそろえる(単位の記録が無い企業は、金額を比べない)。
 * 比率の指標は、単位に依らないので、そのまま比べられる。
 */

export const MIN_COMPARE = 2
export const MAX_COMPARE = 6

/** 金額をそろえる単位 */
export const COMPARE_UNIT: AmountUnit = '百万円'

export interface CompareColumn {
  readonly id: string
  readonly name: string
  /** 最新の期の名前 */
  readonly label: string
  readonly basis: Basis | undefined
  readonly unit: AmountUnit | undefined
}

export type AmountKey =
  | 'sales'
  | 'operatingProfit'
  | 'netIncome'
  | 'totalAssets'
  | 'operatingCashFlow'
  | 'investingCashFlow'
  | 'financingCashFlow'
  | 'freeCashFlow'

export interface AmountRow {
  readonly key: AmountKey
  readonly label: string
  /** 企業ごとの金額(百万円)。単位が分からない企業・書類に無い数字は null */
  readonly values: readonly (number | null)[]
}

export interface MetricCell {
  readonly value: number | null
  readonly level: EvaluationLevel
  readonly reason: UnavailableReason | null
  /** 同じ行で、最も良い値か(同じ値は、すべて) */
  readonly best: boolean
}

export interface MetricRow {
  readonly key: MetricKey
  readonly label: string
  readonly unit: MetricUnit
  readonly group: MetricGroup
  /** どちらが良いか。higher: 大きいほど良い / lower: 小さいほど良い */
  readonly direction: 'higher' | 'lower'
  readonly cells: readonly MetricCell[]
}

export interface GrowthRow {
  readonly key: 'salesGrowth' | 'operatingProfitGrowth'
  readonly label: string
  /** 前期比(%)。前期が無い・範囲が違う・前期が 0 のときは null */
  readonly values: readonly (number | null)[]
}

export interface Comparison {
  readonly columns: readonly CompareColumn[]
  /** 企業ごとの、成長性・収益性・安定性の判定 */
  readonly axes: readonly (readonly AxisSummary[])[]
  readonly amountRows: readonly AmountRow[]
  readonly growthRows: readonly GrowthRow[]
  readonly metricRows: readonly MetricRow[]
  /** 企業ごとの、お金の流れの型の名前。3 区分がそろっていなければ null */
  readonly patterns: readonly (string | null)[]
  /** 比べるときの注意(決算期・範囲・単位の違い) */
  readonly notices: readonly string[]
}

/** 目安の無い指標のうち、どちらが良いか分かるもの(利益率・資産の効率は、大きいほど良い) */
function directionOf(key: MetricKey): 'higher' | 'lower' {
  return getMetricDefinition(key).guideline?.direction ?? 'higher'
}

/** 金額を、百万円にそろえる。単位が分からなければ null */
export function toMillions(value: number, unit: AmountUnit | undefined): number | null {
  return unit === undefined ? null : (value * UNIT_DIVISOR[unit]) / UNIT_DIVISOR[COMPARE_UNIT]
}

function latestOf(company: Company): PeriodData {
  return company.periods[company.periods.length - 1]
}

/** 3 つの軸のうち、指定した軸の判定。判定は、いつも 3 つそろう */
export function axisOf(axes: readonly AxisSummary[], key: AxisKey): AxisSummary {
  const axis = axes.find((a) => a.key === key)
  if (axis === undefined) {
    throw new Error(`判定がありません: ${key}`)
  }
  return axis
}

/** 算出できなかった理由の、表に入る短い言い方 */
export function reasonShort(reason: UnavailableReason): string {
  switch (reason) {
    case 'insolvent':
      return '債務超過'
    case 'cashFlowShortfall':
      return '返済不能'
    case 'noInterest':
      return '利息なし'
    case 'noDenominator':
      return '算出不可'
  }
}

/**
 * 最も良い値の位置(同じ値はすべて)。比べる数字が 2 つ未満、または、すべて同じ値なら、
 * 優劣が付かないので、無し。
 */
function bestIndexes(values: readonly (number | null)[], direction: 'higher' | 'lower'): ReadonlySet<number> {
  const numbers = values.flatMap((v) => (v === null ? [] : [v]))
  if (numbers.length < 2) return new Set()
  const target = direction === 'higher' ? Math.max(...numbers) : Math.min(...numbers)
  const best = values.flatMap((v, i) => (v === target ? [i] : []))
  return best.length === numbers.length ? new Set() : new Set(best)
}

/**
 * 比べるための数字。表に出す桁で同じ値になるものは、同じ値として扱う(表で同じに見えるのに、片方だけ最良にしない)。
 * 利息が無くて算出できない指標(インタレスト・カバレッジ)は、利息の負担が無い、最も良い状態なので、最良の側に置く。
 */
function comparable(
  value: number | null,
  reason: UnavailableReason | undefined,
  unit: MetricUnit,
  direction: 'higher' | 'lower',
): number | null {
  if (value !== null) return roundForDisplay(value, unit)
  if (reason === 'noInterest') return direction === 'higher' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  return null
}

function metricRows(latests: readonly PeriodData[]): readonly MetricRow[] {
  const metrics = latests.map(calcMetrics)
  return METRIC_CATALOG.map((def) => {
    const direction = directionOf(def.key)
    const levels = metrics.map((m) => evaluateMetric(def.key, m[def.key], m.unavailable[def.key]))
    const best = bestIndexes(
      metrics.map((m) => comparable(m[def.key], m.unavailable[def.key], def.unit, direction)),
      direction,
    )
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      group: def.group,
      direction,
      cells: metrics.map((m, i) => ({
        value: m[def.key],
        level: levels[i],
        reason: m.unavailable[def.key] ?? null,
        // 全員が目安に届かない行で、「最良」が、良い値のように見えないようにする(要注意の値には、付けない)
        best: best.has(i) && levels[i] !== 'danger',
      })),
    }
  })
}

/** 金額の行の定義(見出しと、企業の最新の期から金額(単位は会社のまま)を取り出す方法)。表に出す順 */
const AMOUNTS: readonly {
  readonly key: AmountKey
  readonly label: string
  readonly get: (period: PeriodData) => number | null
}[] = [
  { key: 'sales', label: '売上高', get: (p) => p.pl.sales },
  { key: 'operatingProfit', label: '営業利益', get: (p) => deriveStatements(p).operatingProfit },
  { key: 'netIncome', label: '当期純利益', get: (p) => deriveStatements(p).netIncome },
  { key: 'totalAssets', label: '総資産', get: (p) => deriveStatements(p).totalAssets },
  { key: 'operatingCashFlow', label: '営業キャッシュフロー', get: (p) => summarizeCashFlow(p).operating },
  { key: 'investingCashFlow', label: '投資キャッシュフロー', get: (p) => summarizeCashFlow(p).investing },
  { key: 'financingCashFlow', label: '財務キャッシュフロー', get: (p) => summarizeCashFlow(p).financing },
  { key: 'freeCashFlow', label: 'フリーキャッシュフロー(営業 + 投資)', get: (p) => summarizeCashFlow(p).free },
]

function distinct<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)]
}

/** 比べるときの注意。決算期・範囲・単位が企業ごとに違うと、単純には比べられない */
function notices(columns: readonly CompareColumn[]): readonly string[] {
  const out: string[] = []
  if (distinct(columns.map((c) => c.label)).length > 1) {
    out.push(
      `最新の期が企業ごとに違います(${columns.map((c) => `${c.name}: ${c.label}`).join('、')})。決算期がずれると、景気や為替などの影響が違うため、数字は単純には比べられません。`,
    )
  }
  const bases = distinct(columns.flatMap((c) => (c.basis === undefined ? [] : [c.basis])))
  if (bases.length > 1) {
    out.push(
      `連結と単体の数字が混ざっています(${columns.flatMap((c) => (c.basis === undefined ? [] : [`${c.name}: ${basisLabel(c.basis)}`])).join('、')})。範囲が違うので、規模や利益は単純には比べられません。`,
    )
  }
  const noUnit = columns.filter((c) => c.unit === undefined).map((c) => c.name)
  if (noUnit.length > 0) {
    out.push(
      `${noUnit.join('、')}は、金額の単位の記録が無いため、金額の行は「—」にしています(比率の行は、そのまま比べられます)。書類を取り込み直すと、単位が入ります。`,
    )
  }
  return out
}

/**
 * 企業を、最新の期で比べる形にまとめる。MIN_COMPARE 社に満たなければ null(比べるものが無い)。
 * 企業の並びは、渡した順のまま。MAX_COMPARE 社を超える分は、無視する。
 */
export function compareCompanies(input: readonly Company[]): Comparison | null {
  const companies = input.slice(0, MAX_COMPARE)
  if (companies.length < MIN_COMPARE) return null
  const columns: CompareColumn[] = companies.map((c) => ({
    id: c.id,
    name: c.name,
    label: latestOf(c).label,
    basis: latestOf(c).basis,
    unit: c.unit,
  }))
  const overviews = companies.map((c) => summarize(c))
  const growths = overviews.map((o) => axisOf(o.axes, 'growth').growth)
  return {
    columns,
    axes: overviews.map((o) => o.axes),
    amountRows: AMOUNTS.map(({ key, label, get }) => ({
      key,
      label,
      values: companies.map((c) => {
        const raw = get(latestOf(c))
        return raw === null ? null : toMillions(raw, c.unit)
      }),
    })),
    growthRows: [
      { key: 'salesGrowth', label: '売上高の前期比', values: growths.map((g) => g?.salesGrowth ?? null) },
      { key: 'operatingProfitGrowth', label: '営業利益の前期比', values: growths.map((g) => g?.operatingProfitGrowth ?? null) },
    ],
    metricRows: metricRows(companies.map(latestOf)),
    patterns: companies.map((c) => summarizeCashFlow(latestOf(c)).pattern?.title ?? null),
    notices: notices(columns),
  }
}

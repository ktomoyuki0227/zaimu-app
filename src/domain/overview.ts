import {
  METRIC_CATALOG,
  evaluateMetric,
  type EvaluationLevel,
  type MetricGroup,
  type MetricKey,
  type MetricUnit,
} from './catalog'
import { gapToGuideline } from './benchmark'
import { basisChangeNote, isBasisChange } from './basis'
import { classifyGrowthPattern, growthRate, type GrowthPattern } from './growth'
import { calcMetrics, type UnavailableReason } from './metrics'
import { deriveStatements } from './statements'
import type { Company, PeriodData } from './types'

export type AxisKey = 'growth' | 'profitability' | 'stability'
export type Verdict = EvaluationLevel

export interface LevelCounts {
  readonly good: number
  readonly caution: number
  readonly danger: number
}

export interface GrowthSummary {
  readonly pattern: GrowthPattern
  /** 売上高の前期比(%) */
  readonly salesGrowth: number | null
  /** 営業利益の前期比(%) */
  readonly operatingProfitGrowth: number | null
}

/** 1 つの軸(成長性・収益性・安定性)の、ひとことでの判定 */
export interface AxisSummary {
  readonly key: AxisKey
  readonly label: string
  readonly verdict: Verdict
  /** 指標ごとの評価の件数。成長性は指標ではなくパターンで判定するので null */
  readonly counts: LevelCounts | null
  /** 成長性のときだけ入る。前期がない・比べられないときは null */
  readonly growth: GrowthSummary | null
  /** 判定できない理由を、利用者に伝える文(連結と単体の切り替わりなど)。無ければ null */
  readonly note: string | null
}

/** 気をつけたい指標(要注意・注意) */
export interface Concern {
  readonly key: MetricKey
  readonly label: string
  readonly level: 'caution' | 'danger'
  readonly value: number | null
  readonly unit: MetricUnit
  /** 目安との差(プラスなら目安より良い)。値が算出できないときは null */
  readonly gap: number | null
  /** 値が算出できなかった理由 */
  readonly reason: UnavailableReason | null
}

export type KpiId = 'sales' | 'operatingMargin' | 'equityRatio' | 'roe'

/** 概要に並べる主要な数字 */
export interface Kpi {
  readonly id: KpiId
  readonly label: string
  readonly value: number | null
  readonly previous: number | null
  /** 売上高は会社の金額の単位(無ければ空)、ほかは % */
  readonly unit: string
}

export interface Overview {
  readonly latestLabel: string
  readonly previousLabel: string | null
  readonly axes: readonly AxisSummary[]
  readonly concerns: readonly Concern[]
  readonly kpis: readonly Kpi[]
}

const DEFAULT_CONCERN_LIMIT = 3

/** 値が算出できない指標を、「目安から最も遠い」ものとして並べるための差 */
const WORST_GAP = Number.NEGATIVE_INFINITY

/** 目安に対する相対的な不足(負なら目安に届いていない)。単位の違う指標を同じ物差しで比べる */
function relativeGap(gap: number | null, good: number): number {
  if (gap === null) {
    return WORST_GAP
  }
  return gap / Math.max(Math.abs(good), 1)
}

function verdictOf(counts: LevelCounts): Verdict {
  if (counts.danger > 0) return 'danger'
  if (counts.caution > 0) return 'caution'
  if (counts.good > 0) return 'good'
  return 'unknown'
}

function metricAxis(key: AxisKey, label: string, group: MetricGroup, period: PeriodData): AxisSummary {
  const metrics = calcMetrics(period)
  const tally = { good: 0, caution: 0, danger: 0 }
  for (const def of METRIC_CATALOG) {
    if (def.group !== group) continue
    const level = evaluateMetric(def.key, metrics[def.key], metrics.unavailable[def.key])
    if (level !== 'unknown') {
      tally[level] += 1
    }
  }
  return { key, label, verdict: verdictOf(tally), counts: tally, growth: null, note: null }
}

function growthAxis(previous: PeriodData | null, latest: PeriodData): AxisSummary {
  const base = { key: 'growth', label: '成長性', counts: null, note: null } as const
  if (previous === null) {
    return { ...base, verdict: 'unknown', growth: null }
  }
  if (isBasisChange(previous, latest)) {
    return { ...base, verdict: 'unknown', growth: null, note: basisChangeNote(previous, latest) }
  }
  const salesGrowth = growthRate(previous.pl.sales, latest.pl.sales)
  const operatingProfitGrowth = growthRate(
    deriveStatements(previous).operatingProfit,
    deriveStatements(latest).operatingProfit,
  )
  const pattern = classifyGrowthPattern(salesGrowth, operatingProfitGrowth)
  if (pattern === null) {
    return { ...base, verdict: 'unknown', growth: null }
  }
  const verdict: Verdict =
    pattern === '増収増益' ? 'good' : pattern === '減収減益' ? 'danger' : 'caution'
  return { ...base, verdict, growth: { pattern, salesGrowth, operatingProfitGrowth } }
}

/** 要注意・注意の指標を、要注意が先、同じ段階では目安から遠い順に並べて上位を返す */
function topConcerns(period: PeriodData, limit: number): readonly Concern[] {
  const metrics = calcMetrics(period)
  const concerns: { concern: Concern; sortKey: number }[] = []
  for (const def of METRIC_CATALOG) {
    if (def.guideline === undefined) continue
    const value = metrics[def.key]
    const reason = metrics.unavailable[def.key] ?? null
    const level = evaluateMetric(def.key, value, reason ?? undefined)
    if (level !== 'caution' && level !== 'danger') continue
    const gap = gapToGuideline(def.key, value)
    concerns.push({
      concern: { key: def.key, label: def.label, level, value, unit: def.unit, gap, reason },
      sortKey: relativeGap(gap, def.guideline.good),
    })
  }
  concerns.sort((a, b) => {
    if (a.concern.level !== b.concern.level) {
      return a.concern.level === 'danger' ? -1 : 1
    }
    return a.sortKey - b.sortKey
  })
  return concerns.slice(0, limit).map((c) => c.concern)
}

function kpis(company: Company, rawPrevious: PeriodData | null, latest: PeriodData): readonly Kpi[] {
  // 範囲(連結・単体)が違う前期とは、増減を出さない
  const previous = rawPrevious !== null && !isBasisChange(rawPrevious, latest) ? rawPrevious : null
  const now = calcMetrics(latest)
  const before = previous === null ? null : calcMetrics(previous)
  return [
    {
      id: 'sales',
      label: '売上高',
      value: latest.pl.sales,
      previous: previous === null ? null : previous.pl.sales,
      unit: company.unit ?? '',
    },
    { id: 'operatingMargin', label: '売上高営業利益率', value: now.operatingMargin, previous: before?.operatingMargin ?? null, unit: '%' },
    { id: 'equityRatio', label: '自己資本比率', value: now.equityRatio, previous: before?.equityRatio ?? null, unit: '%' },
    { id: 'roe', label: 'ROE', value: now.roe, previous: before?.roe ?? null, unit: '%' },
  ]
}

/**
 * 最新期の財務を、概要画面に出す形にまとめる(3 軸の判定・気をつけたい点・主要な数字)。
 * 判定は目安に照らした評価の件数から決める: 要注意が 1 つでもあれば danger、注意があれば caution。
 */
export function summarize(company: Company, concernLimit: number = DEFAULT_CONCERN_LIMIT): Overview {
  const periods = company.periods
  const latest = periods[periods.length - 1]
  const previous = periods.length > 1 ? periods[periods.length - 2] : null
  return {
    latestLabel: latest.label,
    previousLabel: previous === null ? null : previous.label,
    axes: [
      growthAxis(previous, latest),
      metricAxis('profitability', '収益性', 'profitability', latest),
      metricAxis('stability', '安定性', 'stability', latest),
    ],
    concerns: topConcerns(latest, concernLimit),
    kpis: kpis(company, previous, latest),
  }
}

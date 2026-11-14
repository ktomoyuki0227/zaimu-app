import { useMemo } from 'react'
import { METRIC_CATALOG, getMetricDefinition, unavailableText, type EvaluationLevel } from '../domain/catalog'
import { growthRate } from '../domain/growth'
import { growthInsights } from '../domain/insights'
import { summarize, type AxisSummary, type Concern, type Kpi } from '../domain/overview'
import type { Company } from '../domain/types'
import { companyLabel, formatAmount, formatChange, formatMetric, formatSignedPercent } from '../lib/format'
import { gapText } from '../lib/gap'
import { AXIS_VERDICT_LABEL, LEVEL_STYLE } from './levelStyle'
import { LevelBadge, Panel, Section } from './ui'

export type DetailTab = 'growth' | 'profitability' | 'stability'

const AXIS_BORDER: Record<EvaluationLevel, string> = {
  good: 'border-green-800',
  caution: 'border-yellow-900',
  danger: 'border-red-900',
  unknown: 'border-solid-gray-420',
}

function axisDetail(axis: AxisSummary): string {
  if (axis.note !== null) {
    return axis.note
  }
  if (axis.growth !== null) {
    const { pattern, salesGrowth, operatingProfitGrowth } = axis.growth
    return `${pattern}(売上高 ${formatSignedPercent(salesGrowth)}、営業利益 ${formatSignedPercent(operatingProfitGrowth)})`
  }
  if (axis.counts !== null) {
    const { good, caution, danger } = axis.counts
    return `目安をクリア ${good} / 注意 ${caution} / 要注意 ${danger}`
  }
  return '前の期と比べられるデータがありません'
}

function AxisCard({ axis, onOpen }: { readonly axis: AxisSummary; readonly onOpen: (tab: DetailTab) => void }) {
  const style = LEVEL_STYLE[axis.verdict]
  return (
    <li className={`flex flex-col rounded-8 border border-solid-gray-420 border-t-8 bg-white p-4 ${AXIS_BORDER[axis.verdict]}`}>
      <h3 className="font-bold text-solid-gray-900">{axis.label}</h3>
      <p className={`mt-2 inline-flex w-fit items-center gap-2 rounded-6 border px-3 py-1 text-xl font-bold ${style.className}`}>
        <span aria-hidden="true">{style.mark}</span>
        {AXIS_VERDICT_LABEL[axis.verdict]}
      </p>
      <p className="tnum mt-3 grow text-solid-gray-800">{axisDetail(axis)}</p>
      <button
        type="button"
        onClick={() => onOpen(axis.key)}
        className="mt-1 min-h-11 w-fit text-left font-bold text-blue-900 underline underline-offset-4 hover:text-blue-1000"
      >
        {axis.label}をくわしく見る →
      </button>
    </li>
  )
}

/** 前期との差。金額は増減率(%)、率の指標は差(pt) */
function kpiChange(kpi: Kpi): string {
  if (kpi.id !== 'sales') {
    return formatChange('%', kpi.value, kpi.previous)
  }
  if (kpi.value === null || kpi.previous === null) {
    return '前期との比較はできません'
  }
  const g = growthRate(kpi.previous, kpi.value)
  return g === null ? '前期との比較はできません' : `前期比 ${formatSignedPercent(g)}`
}

function KpiTile({ kpi }: { readonly kpi: Kpi }) {
  const value = kpi.id === 'sales' ? (kpi.value === null ? '—' : formatAmount(kpi.value)) : formatMetric(kpi.value, '%')
  return (
    <li className="rounded-8 border border-solid-gray-420 bg-white p-4">
      <p className="text-solid-gray-800">{kpi.label}</p>
      <p className="tnum mt-1 text-[2rem] font-bold leading-tight text-solid-gray-900">
        {value}
        {kpi.id === 'sales' ? (
          <span className="ml-1 text-base font-normal text-solid-gray-700">{kpi.unit === '' ? '(単位不明)' : kpi.unit}</span>
        ) : null}
      </p>
      <p className="tnum text-solid-gray-700">{kpiChange(kpi)}</p>
    </li>
  )
}

/** 気をつけたい指標が、どのタブにあるか */
function tabOf(concern: Concern): DetailTab {
  return getMetricDefinition(concern.key).group
}

function ConcernRow({ concern, onOpen }: { readonly concern: Concern; readonly onOpen: (tab: DetailTab) => void }) {
  const def = getMetricDefinition(concern.key)
  const detail = concern.reason !== null ? unavailableText(concern.reason) : gapText(def, concern.gap)
  const tab = tabOf(concern)
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-solid-gray-200 py-3 last:border-b-0">
      <LevelBadge level={concern.level} />
      <span className="font-bold">{concern.label}</span>
      <span className="tnum">{formatMetric(concern.value, concern.unit)}</span>
      <span className="grow text-solid-gray-800">{detail}</span>
      <button
        type="button"
        onClick={() => onOpen(tab)}
        className="min-h-11 font-bold text-blue-900 underline underline-offset-4 hover:text-blue-1000"
      >
        {tab === 'profitability' ? '収益性' : '安定性'}で見る
      </button>
    </li>
  )
}

interface Props {
  readonly company: Company
  readonly onOpen: (tab: DetailTab) => void
}

/** 最初に開く画面。最新期を 3 つの軸で一言にまとめ、気をつけたい点と主要な数字を並べる */
export function OverviewView({ company, onOpen }: Props) {
  const overview = useMemo(() => summarize(company), [company])
  const insights = useMemo(() => {
    const periods = company.periods
    return periods.length > 1 ? growthInsights(periods[periods.length - 2], periods[periods.length - 1]) : []
  }, [company.periods])
  const metricCount = METRIC_CATALOG.filter((d) => d.guideline !== undefined).length

  return (
    <div>
      <Section
        title={`${companyLabel(company)}の概要(${overview.latestLabel})`}
        lead={`最新期の財務を、成長性・収益性・安定性の 3 つの軸でひとことにまとめました。判定は、目安のある ${metricCount} 指標を一般的な基準に照らした結果です。`}
      >
        <ul className="grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
          {overview.axes.map((axis) => (
            <AxisCard key={axis.key} axis={axis} onOpen={onOpen} />
          ))}
        </ul>
      </Section>

      <Section title="主要な数字">
        <ul className="grid list-none grid-cols-2 gap-4 p-0 lg:grid-cols-4">
          {overview.kpis.map((kpi) => (
            <KpiTile key={kpi.id} kpi={kpi} />
          ))}
        </ul>
      </Section>

      <Section
        title="気をつけたい点"
        lead="目安に届いていない指標を、目安から遠い順に最大 3 つ挙げます。"
      >
        <Panel>
          {overview.concerns.length === 0 ? (
            <p className="font-bold text-green-1000">✓ 目安に届いていない指標はありません。</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {overview.concerns.map((c) => (
                <ConcernRow key={c.key} concern={c} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </Panel>
      </Section>

      {insights.length > 0 ? (
        <Section title={`${overview.latestLabel}の読み解き`}>
          <div className="rounded-8 border-l-8 border-blue-900 bg-blue-50 p-4 sm:p-5">
            <ul className="list-disc space-y-1 pl-5 text-solid-gray-900">
              {insights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </Section>
      ) : null}
    </div>
  )
}

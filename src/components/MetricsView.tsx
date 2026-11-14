import { useMemo } from 'react'
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { gapToGuideline } from '../domain/benchmark'
import {
  METRIC_CATALOG,
  evaluateMetric,
  guidelineText,
  unavailableText,
  type MetricDefinition,
  type MetricGroup,
  type MetricKey,
} from '../domain/catalog'
import { calcMetrics, type UnavailableReason } from '../domain/metrics'
import type { Company } from '../domain/types'
import { formatChange, formatMetric } from '../lib/format'
import { gapText } from '../lib/gap'
import { Bullet } from './Bullet'
import { levelLabel, levelMark } from './levelStyle'
import { LevelBadge, Panel, Section } from './ui'

const GROUP_COPY: Record<MetricGroup, { title: string; lead: string }> = {
  profitability: {
    title: '収益性',
    lead: '事業でどれだけ効率よく儲けているかを見ます。売上に対する利益の割合(利益率)と、資産・自己資本に対する利益の割合(ROA・ROE)が中心です。',
  },
  stability: {
    title: '安定性',
    lead: '会社が倒れにくいか、借金を無理なく返せるかを見ます。短期の支払い能力、資金の調達バランス、借入の重さの 3 つの面から確かめます。',
  },
}

/** 指標を、見る目的ごとのまとまりに分ける */
const SUBGROUPS: Record<MetricGroup, readonly { readonly title: string; readonly keys: readonly MetricKey[] }[]> = {
  profitability: [
    { title: '売上に対する利益率', keys: ['grossMargin', 'operatingMargin', 'ordinaryMargin'] },
    { title: '資産・資本に対する効率', keys: ['ordinaryReturnOnAssets', 'roa', 'roe', 'totalAssetTurnover'] },
  ],
  stability: [
    { title: '短期の支払い能力', keys: ['currentRatio', 'quickRatio'] },
    { title: '資金の調達バランス', keys: ['equityRatio', 'fixedRatio', 'fixedLongTermRatio', 'debtToEquity'] },
    { title: '借入の重さ', keys: ['interestBearingDebtMultiple', 'debtRepaymentYears', 'interestCoverage'] },
  ],
}

/** 目安が無い指標の推移を、小さな折れ線で見せる */
function Sparkline({ labels, series }: { readonly labels: readonly string[]; readonly series: readonly (number | null)[] }) {
  if (series.length < 2) {
    return null
  }
  const data = labels.map((label, i) => ({ label, value: series[i] ?? null }))
  return (
    <div aria-hidden="true" className="mt-2 h-14">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
          <XAxis dataKey="label" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <Line dataKey="value" stroke="var(--color-blue-900)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

interface CardProps {
  readonly def: MetricDefinition
  readonly labels: readonly string[]
  readonly series: readonly (number | null)[]
  /** 各期の「算出できなかった理由」。算出できた期は undefined */
  readonly reasons: readonly (UnavailableReason | undefined)[]
}

function MetricCard({ def, labels, series, reasons }: CardProps) {
  const now = series[series.length - 1] ?? null
  const nowReason = reasons[reasons.length - 1]
  const before = series.length > 1 ? (series[series.length - 2] ?? null) : null
  const level = evaluateMetric(def.key, now, nowReason)
  const guide = guidelineText(def.key)
  const gap = gapText(def, gapToGuideline(def.key, now))

  return (
    <li className="flex flex-col rounded-8 border border-solid-gray-420 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-bold leading-snug">{def.label}</h4>
        <LevelBadge level={level} />
      </div>
      <p className="tnum mt-2 text-[2rem] font-bold leading-tight text-solid-gray-900">
        {formatMetric(now, def.unit)}
      </p>
      <p className={now === null && nowReason ? 'font-bold text-solid-gray-900' : 'text-solid-gray-700'}>
        {now === null && nowReason ? unavailableText(nowReason) : formatChange(def.unit, now, before)}
      </p>

      {guide ? (
        <>
          <Bullet def={def} value={now} />
          <p className="mt-1 text-solid-gray-800">
            {gap ? <span className="font-bold">{gap}。</span> : null}
            {guide}
          </p>
        </>
      ) : (
        <>
          <Sparkline labels={labels} series={series} />
          <p className="mt-1 text-solid-gray-700">一律の目安はありません。自社の推移や同業他社と比べて見ます。</p>
        </>
      )}

      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-2 font-bold text-blue-900 underline underline-offset-4">
          計算式と見方
        </summary>
        <p className="mt-2">
          <span className="font-bold">式: </span>
          {def.formula}
        </p>
        <p className="mt-1">{def.meaning}</p>
      </details>
    </li>
  )
}

interface Props {
  readonly company: Company
  readonly group: MetricGroup
}

export function MetricsView({ company, group }: Props) {
  const metrics = useMemo(() => company.periods.map(calcMetrics), [company.periods])
  const labels = useMemo(() => company.periods.map((p) => p.label), [company.periods])
  const defs = useMemo(() => METRIC_CATALOG.filter((d) => d.group === group), [group])
  const copy = GROUP_COPY[group]

  const latest = metrics[metrics.length - 1]
  const usesApproximateCashFlow = group === 'stability' && latest.debtRepaymentBasis === 'approximate'

  return (
    <div>
      <Section title={`${copy.title}の指標(${labels[labels.length - 1]})`} lead={copy.lead}>
        {SUBGROUPS[group].map((sub) => (
          <div key={sub.title} className="mt-8 first:mt-0">
            <h3 className="text-lg font-bold text-solid-gray-900">{sub.title}</h3>
            <ul className="mt-3 grid list-none grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4 p-0">
              {sub.keys.map((key) => {
                const def = defs.find((d) => d.key === key)
                if (def === undefined) return null
                return (
                  <MetricCard
                    key={key}
                    def={def}
                    labels={labels}
                    series={metrics.map((m) => m[key])}
                    reasons={metrics.map((m) => m.unavailable[key])}
                  />
                )
              })}
            </ul>
          </div>
        ))}
        {usesApproximateCashFlow ? (
          <p className="mt-4 rounded-8 border border-yellow-900 bg-yellow-50 p-3 text-yellow-1100">
            債務償還年数は、営業キャッシュフローが書類に無いため「当期純利益 + 減価償却費」で近似しています。
          </p>
        ) : null}
      </Section>

      <Section title="期ごとの比較表" lead="記号は目安に照らした評価です(◎ クリア / △ 注意 / ▲ 要注意 / − 目安なし)。">
        <Panel>
          <div className="relative overflow-x-auto">
            <table className="tnum w-full min-w-[36rem] border-collapse text-right">
              <caption className="sr-only">{copy.title}の指標を期ごとに並べた表</caption>
              <thead>
                <tr className="border-b-2 border-solid-gray-900">
                  <th scope="col" className="py-2 pr-4 text-left">
                    指標
                  </th>
                  {labels.map((label, i) => (
                    <th key={`${label}-${i}`} scope="col" className="px-3 py-2">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {defs.map((def) => (
                  <tr key={def.key} className="border-b border-solid-gray-200">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">
                      {def.label}
                    </th>
                    {metrics.map((m, i) => {
                      const reason = m.unavailable[def.key]
                      const level = evaluateMetric(def.key, m[def.key], reason)
                      return (
                        <td
                          key={`${labels[i]}-${i}`}
                          className="px-3 py-2"
                          title={reason ? unavailableText(reason) : undefined}
                        >
                          <span aria-hidden="true" className="mr-1.5 text-solid-gray-700">
                            {levelMark(level)}
                          </span>
                          <span className="sr-only">{levelLabel(level)}: </span>
                          {formatMetric(m[def.key], def.unit)}
                          {reason ? <span className="sr-only">({unavailableText(reason)})</span> : null}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </Section>

      <p className="mt-8 text-solid-gray-700">
        目安の値は、一般的な財務分析の解説で広く使われている基準です。業種によって適正な水準は大きく異なるため、同業他社との比較とあわせて判断してください。
      </p>
    </div>
  )
}

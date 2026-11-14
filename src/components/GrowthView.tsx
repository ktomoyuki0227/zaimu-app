import { useId, useMemo, useState } from 'react'
import { basisChangeLabels, hasMixedBasis, isBasisChange, periodHeading } from '../domain/basis'
import { buildGrowthSeries, commonSizePl, profitBridge } from '../domain/growth'
import { growthInsights } from '../domain/insights'
import { deriveStatements } from '../domain/statements'
import type { Company } from '../domain/types'
import { buildWaterfall, plStaircase } from '../domain/waterfall'
import { formatAmount } from '../lib/format'
import { yAxisWidth } from './chartTheme'
import { CompositionChart, GrowthRateChart, ProfitTrendChart, SalesTrendChart } from './GrowthCharts'
import { Panel, Section } from './ui'
import { WaterfallChart } from './WaterfallChart'

const MIN_PERIODS_FOR_TREND = 2

interface Props {
  readonly company: Company
}

export function GrowthView({ company }: Props) {
  const { periods } = company
  const selectId = useId()
  const [selectedIndex, setSelectedIndex] = useState(periods.length - 1)
  const index = Math.min(selectedIndex, periods.length - 1)
  const selected = periods[index]
  const previous = index > 0 ? periods[index - 1] : null

  const trend = useMemo(
    () =>
      periods.map((p) => {
        const d = deriveStatements(p)
        return {
          label: p.label,
          sales: p.pl.sales,
          grossProfit: d.grossProfit,
          operatingProfit: d.operatingProfit,
          ordinaryProfit: d.ordinaryProfit,
          netIncome: d.netIncome,
        }
      }),
    [periods],
  )
  const amountAxisWidth = useMemo(
    () =>
      yAxisWidth(
        trend.flatMap((t) => [t.sales, t.grossProfit, t.operatingProfit, t.ordinaryProfit, t.netIncome]),
        formatAmount,
      ),
    [trend],
  )
  const growth = useMemo(() => buildGrowthSeries(periods), [periods])
  const composition = useMemo(
    () =>
      periods.map((p) => {
        const c = commonSizePl(p)
        return {
          label: p.label,
          // 売上高が 0 以下で計算できない期は、0% にせず、null(棒を描かない)にする
          costOfSales: c.costOfSales,
          sga: c.sga,
          operatingProfit: c.operatingProfit,
        }
      }),
    [periods],
  )
  const staircase = useMemo(() => plStaircase(selected), [selected])
  const bridge = useMemo(() => {
    // 前期と数字の範囲(連結・単体)が違うと、増減の要因に分けられない
    if (previous === null || isBasisChange(previous, selected)) return null
    const b = profitBridge(previous, selected)
    return buildWaterfall([
      { label: '前期の経常利益', value: b.start, kind: 'total' },
      ...b.steps.map((s) => ({ label: s.label, value: s.value, kind: 'delta' as const })),
      { label: '当期の経常利益', value: b.end, kind: 'total' },
    ])
  }, [previous, selected])
  const mixed = hasMixedBasis(periods)
  const basisChanges = useMemo(() => (mixed ? basisChangeLabels(periods) : []), [mixed, periods])
  const insights = useMemo(
    () => (previous === null ? [] : growthInsights(previous, selected)),
    [previous, selected],
  )

  if (periods.length < MIN_PERIODS_FOR_TREND) {
    return (
      <Panel title="成長性を見るには 2 期以上のデータが必要です">
        <p>2 期以上が入ったファイルを読み込んでください。「サンプルを読み込む」で 5 期分を試せます。</p>
      </Panel>
    )
  }

  return (
    <div>
      <Section
        title="成長性とは"
        lead="売上や利益が、期を追うごとにどれだけ伸びているか(または縮んでいるか)を見ます。売上だけでなく、利益がそれ以上に伸びているかが大切です。"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={selectId} className="font-bold">
            詳しく見る期
          </label>
          <select
            id={selectId}
            value={index}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            className="min-h-11 rounded-8 border border-solid-gray-536 bg-white px-3 py-2"
          >
            {periods.map((p, i) => (
              <option key={`${p.label}-${i}`} value={i}>
                {periodHeading(p, mixed)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 rounded-8 border-l-8 border-blue-900 bg-blue-50 p-4 sm:p-5">
          <h3 className="font-bold text-blue-1100">{selected.label}の読み解き</h3>
          {insights.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-solid-gray-900">
              {insights.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-solid-gray-900">
              {previous === null
                ? '最初の期には前期がないため、前期との比較はできません。2 期目以降を選んでください。'
                : '前期の売上高または営業利益が 0 のため、増減率を計算できません。'}
            </p>
          )}
        </div>
      </Section>

      <div className="mt-12 grid grid-cols-1 gap-x-6 lg:grid-cols-2 [&>section]:mt-12 lg:[&>section]:mt-0">
        <Section title="売上高の推移" lead="年ごとの売上高です。">
          <Panel>
            <SalesTrendChart trend={trend} basisChanges={basisChanges} axisWidth={amountAxisWidth} unit={company.unit} />
          </Panel>
        </Section>

        <Section
          title="各段階の利益の推移"
          lead="営業・経常・当期純利益です。売上が伸びているのに線が寝ている期は、儲けにくくなっているサインです。"
        >
          <Panel>
            <ProfitTrendChart trend={trend} basisChanges={basisChanges} axisWidth={amountAxisWidth} unit={company.unit} />
          </Panel>
        </Section>
      </div>

      <Section
        title={`${selected.label}の PL 階段`}
        lead="売上高から当期純利益まで、どこでどれだけ減って最終的な利益が残ったかを 1 段ずつ追います。"
      >
        <Panel>
          <WaterfallChart rows={staircase} unit={company.unit} />
        </Panel>
      </Section>

      <Section
        title={`${selected.label}の経常利益は、なぜ増減したか`}
        lead="前期の経常利益から今期の経常利益までを、売上の増減・粗利率の変化・販管費・営業外損益の 4 つの要因に分けて見ます。"
      >
        <Panel>
          {bridge === null ? (
            <p>
              {previous !== null && isBasisChange(previous, selected)
                ? '前期と数字の範囲(連結・単体)が違うため、増減の要因には分けられません。'
                : '最初の期には前期がないため、増減要因は表示できません。2 期目以降を選んでください。'}
            </p>
          ) : (
            <WaterfallChart rows={bridge} unit={company.unit} />
          )}
        </Panel>
      </Section>

      <details className="mt-12">
        <summary className="min-h-11 cursor-pointer py-2 text-[1.125rem] font-bold text-blue-900 underline underline-offset-4">
          さらに詳しく見る(前期比の増減率・売上高に対する中身)
        </summary>
        <div className="mt-6">
          <Section
            title="前期比の増減率"
            lead="金額の大小に関係なく、伸び方だけを同じ物差しで比べます。営業利益の線が売上高の線より上にあれば、売上の伸び以上に利益が増えています。"
          >
            <Panel>
              <GrowthRateChart growth={growth} basisChanges={basisChanges} />
            </Panel>
          </Section>

          <Section
            title="売上高を 100% としたときの中身"
            lead="売上 100 のうち、原価・販管費に何%使い、営業利益が何%残ったかを期ごとに並べます。黒い点線が売上高の 100% で、棒がこの線を超えている期は営業赤字です。"
          >
            <Panel>
              <CompositionChart composition={composition} basisChanges={basisChanges} />
            </Panel>
          </Section>
        </div>
      </details>
    </div>
  )
}

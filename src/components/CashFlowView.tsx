import { useId, useMemo, useState } from 'react'
import { basisChangeLabels, hasMixedBasis, periodHeading } from '../domain/basis'
import {
  CASH_FLOW_KINDS,
  cashFlowMeaning,
  cashFlowValue,
  hasCashFlow,
  signOf,
  summarizeCashFlow,
  type CashFlowSummary,
} from '../domain/cashFlow'
import type { Company } from '../domain/types'
import { amountUnitText, formatSignedAmount } from '../lib/format'
import { CashFlowChart } from './CashFlowCharts'
import { Panel, Section, UnitNote } from './ui'

interface Props {
  readonly company: Company
}

/** 符号つきの数字(「+1,000」「-500」)。数字が無いときは「—」 */
function signed(value: number | null): string {
  return value === null ? '—' : formatSignedAmount(value)
}

/** プラス・マイナスを、色だけでなく、言葉と記号でも伝える */
function SignBadge({ value }: { readonly value: number | null }) {
  if (value === null) return <span className="text-solid-gray-700">数字なし</span>
  const sign = signOf(value)
  const text = sign === 'plus' ? '＋ 資金が入った' : sign === 'minus' ? '− 資金が出た' : '0 出入りなし'
  const style =
    sign === 'plus'
      ? 'border-green-800 bg-green-50 text-green-1100'
      : sign === 'minus'
        ? 'border-red-900 bg-red-50 text-red-1100'
        : 'border-solid-gray-420 bg-solid-gray-50 text-solid-gray-800'
  return (
    <span className={`inline-flex w-fit items-center rounded-6 border px-2 py-0.5 text-sm font-bold ${style}`}>{text}</span>
  )
}

/** 選んだ期の、3 区分(営業 → 投資 → 財務)の数字と意味 */
function PeriodCards({ summary, unit }: { readonly summary: CashFlowSummary; readonly unit: string | undefined }) {
  return (
    <>
      <UnitNote>{amountUnitText(unit)}</UnitNote>
      <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
        {CASH_FLOW_KINDS.map((kind, i) => {
          const value = cashFlowValue(summary, kind.key)
          return (
            <li key={kind.key} className="flex flex-col rounded-8 border border-solid-gray-420 bg-white p-4">
              <p className="text-sm text-solid-gray-700">
                {i + 1}. {kind.what}
              </p>
              <h4 className="mt-1 font-bold text-solid-gray-900">{kind.label}</h4>
              <p className="tnum mt-2 text-[2rem] font-bold leading-tight text-solid-gray-900">{signed(value)}</p>
              <div className="mt-2">
                <SignBadge value={value} />
              </div>
              <p className="mt-3 text-solid-gray-800">
                {value === null ? 'この期の数字は、書類にありません。' : cashFlowMeaning(kind.key, value)}
              </p>
            </li>
          )
        })}
      </ol>
      <dl className="tnum mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="font-bold">フリーキャッシュフロー(営業 + 投資)</dt>
          <dd className="text-solid-gray-800">
            {signed(summary.free)}
            <span className="ml-2 text-sm text-solid-gray-700">営業と投資の合計(簡易的な見方)。マイナスは、投資が本業の稼ぎを上回っている</span>
          </dd>
        </div>
        <div>
          <dt className="font-bold">3 区分の合計(現金の増減)</dt>
          <dd className="text-solid-gray-800">
            {signed(summary.net)}
            <span className="ml-2 text-sm text-solid-gray-700">為替の影響などを除く</span>
          </dd>
        </div>
      </dl>
    </>
  )
}

/** 期ごとの比較表(行: 営業・投資・財務・フリー・合計、列: 期) */
function CashFlowTable({
  summaries,
  headings,
}: {
  readonly summaries: readonly CashFlowSummary[]
  readonly headings: readonly string[]
}) {
  const rows: readonly { readonly label: string; readonly pick: (s: CashFlowSummary) => number | null }[] = [
    ...CASH_FLOW_KINDS.map((k, i) => ({
      label: `${i + 1}. ${k.label}`,
      pick: (s: CashFlowSummary) => cashFlowValue(s, k.key),
    })),
    { label: 'フリーキャッシュフロー(営業 + 投資)', pick: (s) => s.free },
    { label: '3 区分の合計', pick: (s) => s.net },
  ]
  return (
    <div className="relative overflow-x-auto">
      <table className="tnum w-full min-w-[36rem] border-collapse text-right">
        <caption className="sr-only">キャッシュフローを期ごとに並べた表(プラスは資金が入った、マイナスは資金が出た)</caption>
        <thead>
          <tr className="border-b-2 border-solid-gray-900">
            <th scope="col" className="py-2 pr-4 text-left">
              区分
            </th>
            {headings.map((h, i) => (
              <th key={`${h}-${i}`} scope="col" className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-solid-gray-200">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {row.label}
              </th>
              {summaries.map((s, i) => (
                <td key={`${row.label}-${i}`} className="px-3 py-2">
                  {signed(row.pick(s))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CashFlowView({ company }: Props) {
  const selectId = useId()
  const { periods } = company
  const summaries = useMemo(() => periods.map(summarizeCashFlow), [periods])
  const withData = useMemo(() => periods.map(hasCashFlow), [periods])
  const lastWithData = withData.lastIndexOf(true)
  // 利用者が選ぶまでは null(その間は、数字のある最新の期)。データが入れ替わっても、選び直しが要らない
  const [selected, setSelected] = useState<number | null>(null)
  const mixed = hasMixedBasis(periods)
  const headings = useMemo(() => periods.map((p) => periodHeading(p, mixed)), [periods, mixed])
  // グラフに出す(キャッシュフローの数字がある)期だけで、範囲の切り替わりを調べる
  const chartPeriods = useMemo(() => periods.filter((_, i) => withData[i]), [periods, withData])
  const chartSummaries = useMemo(() => summaries.filter((_, i) => withData[i]), [summaries, withData])
  const basisChanges = useMemo(() => (mixed ? basisChangeLabels(chartPeriods) : []), [mixed, chartPeriods])

  if (lastWithData < 0) {
    return (
      <Panel title="キャッシュフローの数字がありません">
        <p>
          この企業には、キャッシュフロー計算書の数字が入っていません(キャッシュフローを読み取る前に取り込んだ保存データです)。
          書類をもう一度取り込むと、表示されます。
        </p>
      </Panel>
    )
  }

  const index = Math.min(Math.max(selected ?? lastWithData, 0), periods.length - 1)
  const summary = summaries[index]

  return (
    <div>
      <Section
        title="キャッシュフローとは"
        lead="お金の出入りを、3 つに分けて見ます。計算書の正式な順は、営業 → 投資 → 財務です。プラスは「資金が入った」、マイナスは「資金が出た」。利益が出ていても、現金が増えているとは限りません。"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={selectId} className="font-bold">
            詳しく見る期
          </label>
          <select
            id={selectId}
            value={index}
            onChange={(e) => setSelected(Number(e.target.value))}
            className="min-h-11 rounded-8 border border-solid-gray-536 bg-white px-3 py-2"
          >
            {periods.map((p, i) => (
              <option key={`${p.label}-${i}`} value={i}>
                {headings[i]}
              </option>
            ))}
          </select>
        </div>

        <h3 className="mt-6 text-lg font-bold">{headings[index]}のキャッシュフロー</h3>
        {withData[index] ? (
          <div className="mt-3">
            <PeriodCards summary={summary} unit={company.unit} />
            {summary.pattern !== null ? (
              <div
                className={`mt-5 rounded-8 border-l-8 p-4 sm:p-5 ${summary.pattern.caution ? 'border-yellow-900 bg-yellow-50' : 'border-blue-900 bg-blue-50'}`}
              >
                <h4 className="font-bold">
                  {summary.pattern.caution ? <span>注意: </span> : null}お金の流れの型: {summary.pattern.title}
                </h4>
                <p className="mt-2 text-solid-gray-900">{summary.pattern.meaning}</p>
                {summary.pattern.note !== null ? <p className="mt-2 font-bold text-solid-gray-900">{summary.pattern.note}</p> : null}
                <p className="mt-2 text-sm text-solid-gray-700">
                  1 期だけでは決めつけず、推移で見ます。業種や会社の成長段階でも、型は変わります。
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3">この期のキャッシュフローの数字は、書類にありません。</p>
        )}
      </Section>

      {periods.length > 1 ? (
        <Section
          title="期ごとの推移"
          lead="3 つの区分を、期ごとに並べます(左から、営業 → 投資 → 財務)。0 の線より上がプラス、下がマイナスです。"
        >
          <Panel>
            <CashFlowChart
              summaries={chartSummaries}
              basisChanges={basisChanges}
              unit={company.unit}
            />
          </Panel>
        </Section>
      ) : null}

      <Section title="期ごとの比較表">
        <Panel>
          <UnitNote>{amountUnitText(company.unit)}</UnitNote>
          <CashFlowTable summaries={summaries} headings={headings} />
        </Panel>
      </Section>
    </div>
  )
}

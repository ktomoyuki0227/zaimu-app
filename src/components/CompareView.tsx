import { useMemo, useState } from 'react'
import type { EvaluationLevel } from '../domain/catalog'
import { guidelineText } from '../domain/catalog'
import {
  COMPARE_UNIT,
  MAX_COMPARE,
  MIN_COMPARE,
  axisOf,
  compareCompanies,
  reasonShort,
  type Comparison,
  type MetricRow,
} from '../domain/compare'
import type { Company } from '../domain/types'
import { companyLabel, formatAmount, formatMetric, formatSignedOrDash, formatSignedPercent } from '../lib/format'
import { CompareChart } from './CompareChart'
import { CompareTable, type CompareTableRow } from './CompareTable'
import { AXIS_VERDICT_LABEL, LEVEL_STYLE } from './levelStyle'
import { BUTTON_SECONDARY } from './styles'
import { Section, UnitNote } from './ui'

/** 最初に選んでおく企業の数 */
const DEFAULT_SELECTED = 4

interface Props {
  readonly companies: readonly Company[]
  readonly onBack: () => void
  readonly onOpenCompany: (id: string) => void
}

/** 表の狭い列に入る、評価の短い言い方(記号と一緒に出す) */
const CHIP_TEXT: Record<EvaluationLevel, string> = { good: 'クリア', caution: '注意', danger: '要注意', unknown: '' }

/** 評価の段階を、記号と文字で小さく示す(色だけに頼らない)。目安が無いときは何も出さない */
function LevelChip({ level, text }: { readonly level: EvaluationLevel; readonly text: string }) {
  if (level === 'unknown') return null
  return (
    <span className={`mt-1 inline-flex w-fit items-center gap-1 rounded-6 border px-1.5 text-sm font-bold ${LEVEL_STYLE[level].className}`}>
      <span aria-hidden="true">{LEVEL_STYLE[level].mark}</span>
      {text}
    </span>
  )
}

function metricCell(row: MetricRow, i: number) {
  const cell = row.cells[i]
  return (
    <div className="flex flex-col">
      <span className="font-bold">
        {cell.value === null ? (cell.reason === null ? '—' : reasonShort(cell.reason)) : formatMetric(cell.value, row.unit)}
      </span>
      <LevelChip level={cell.level} text={CHIP_TEXT[cell.level]} />
      {cell.best ? <span className="text-sm font-bold text-blue-900">★ 最良</span> : null}
    </div>
  )
}

function metricRows(comparison: Comparison, group: MetricRow['group']): readonly CompareTableRow[] {
  return comparison.metricRows
    .filter((r) => r.group === group)
    .map((r) => ({
      key: r.key,
      label: `${r.label}(${r.unit})`,
      hint: guidelineText(r.key) ?? undefined,
      cells: r.cells.map((_, i) => metricCell(r, i)),
    }))
}

function amountCells(values: readonly (number | null)[], signedValues: boolean): readonly string[] {
  return values.map((v) => (v === null ? '—' : signedValues ? formatSignedOrDash(v) : formatAmount(v)))
}

/**
 * 他社比較のページ。取り込んだ企業から 2〜6 社を選び、それぞれの最新の期を、同じ物差しで横に並べる。
 * 金額は百万円にそろえ、指標は目安に照らした評価と「その行で最も良い値」を付ける。
 */
export function CompareView({ companies, onBack, onOpenCompany }: Props) {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() =>
    companies.slice(0, DEFAULT_SELECTED).map((c) => c.id),
  )
  // 一覧から無くなった企業の選択は、外す。表の並びは、一覧の並びに従う(選んだ順ではない)
  const selected = useMemo(() => companies.filter((c) => selectedIds.includes(c.id)), [companies, selectedIds])
  const comparison = useMemo(() => compareCompanies(selected), [selected])
  const full = selected.length >= MAX_COMPARE

  const toggle = (id: string, checked: boolean): void => {
    setSelectedIds((ids) => (checked ? [...ids, id] : ids.filter((x) => x !== id)))
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className={BUTTON_SECONDARY}>
          ← 企業の一覧へ
        </button>
        <p className="font-bold text-blue-900">財務ビュー</p>
      </div>
      <h1 className="mt-3 text-[2rem] font-bold leading-tight sm:text-[2.25rem]">他社比較</h1>
      <p className="mt-2 max-w-[44rem] text-solid-gray-800">
        取り込んだ企業の最新の期を、同じ物差しで並べます。金額は{COMPARE_UNIT}にそろえ、比率の指標は目安に照らした評価を付けます。
      </p>

      <div className="mt-8">
        <Section
          title="比べる企業"
          lead={`${MIN_COMPARE}〜${MAX_COMPARE} 社を選びます(最初は、一覧の先頭から ${DEFAULT_SELECTED} 社)。`}
        >
          <fieldset className="m-0 border-0 p-0">
            <legend className="sr-only">比べる企業を選ぶ</legend>
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
              {companies.map((c) => {
                const checked = selectedIds.includes(c.id)
                return (
                  <li key={c.id}>
                    <label className="flex min-h-11 items-center gap-3 rounded-8 border border-solid-gray-420 bg-white px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && full}
                        onChange={(e) => toggle(c.id, e.target.checked)}
                        className="size-5"
                      />
                      <span>
                        {companyLabel(c)}
                        <span className="tnum ml-2 text-sm text-solid-gray-700">
                          {c.periods[c.periods.length - 1].label}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
          {/* 選ぶたびに変わる案内は、読み上げられるように、いつもある領域の中身を入れ替える */}
          <div role="status" className="mt-2 text-solid-gray-800">
            {full ? `選べるのは ${MAX_COMPARE} 社までです。外すと、別の企業を選べます。` : null}
          </div>
        </Section>
      </div>

      <div role="status">
        {comparison === null ? (
          <p className="mt-8 rounded-8 border border-solid-gray-420 bg-solid-gray-50 p-4 font-bold">
            {MIN_COMPARE} 社以上を選ぶと、比較の表が出ます(いま {selected.length} 社)。
          </p>
        ) : null}
      </div>
      {comparison === null ? null : <ComparisonBody comparison={comparison} onOpenCompany={onOpenCompany} />}
    </div>
  )
}

function ComparisonBody({
  comparison,
  onOpenCompany,
}: {
  readonly comparison: Comparison
  readonly onOpenCompany: (id: string) => void
}) {
  const { columns } = comparison
  const amount = (keys: readonly string[], signedValues: boolean): readonly CompareTableRow[] =>
    comparison.amountRows
      .filter((r) => keys.includes(r.key))
      .map((r) => ({ key: r.key, label: r.label, cells: amountCells(r.values, signedValues) }))

  const axisRows: readonly CompareTableRow[] = (['growth', 'profitability', 'stability'] as const).map((key) => ({
    key,
    label: axisOf(comparison.axes[0], key).label,
    cells: comparison.axes.map((axes) => {
      const axis = axisOf(axes, key)
      return (
        <span
          key={axis.key}
          className={`inline-flex items-center gap-1.5 rounded-6 border px-2 py-0.5 font-bold ${LEVEL_STYLE[axis.verdict].className}`}
        >
          <span aria-hidden="true">{LEVEL_STYLE[axis.verdict].mark}</span>
          {AXIS_VERDICT_LABEL[axis.verdict]}
        </span>
      )
    }),
  }))

  const growth: readonly CompareTableRow[] = comparison.growthRows.map((r) => ({
    key: r.key,
    label: r.label,
    cells: r.values.map((v) => (v === null ? '—' : formatSignedPercent(v))),
  }))

  const cashRows: readonly CompareTableRow[] = [
    ...amount(['operatingCashFlow', 'investingCashFlow', 'financingCashFlow', 'freeCashFlow'], true),
    { key: 'pattern', label: 'お金の流れの型', cells: comparison.patterns.map((p) => p ?? '—') },
  ]

  return (
    <div className="mt-8">
      {comparison.notices.length > 0 ? (
        <div role="note" className="mb-8 rounded-8 border border-yellow-900 bg-yellow-50 p-4 text-yellow-1100">
          <p className="font-bold">
            <span aria-hidden="true">△ </span>比べるときの注意
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {comparison.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mb-8 max-w-[44rem] text-solid-gray-800">
        目安は、業種によって大きく変わります。違う業種どうしの数字は、あくまで参考にとどめ、同じ業種の企業を比べてください。
        「★ 最良」は、その行で最も良い値です(利益率などは大きいほど、負債比率などは小さいほど良い)。
      </p>

      <Section title="3 つの軸の判定">
        <CompareTable caption="企業ごとの、成長性・収益性・安定性の判定" columns={columns} rows={axisRows} />
      </Section>

      <Section title="規模と利益" lead="最新の期の金額です。企業の規模(売上高・総資産)を、そろえた単位で見られます。">
        <UnitNote>{`単位: ${COMPARE_UNIT}`}</UnitNote>
        <CompareTable
          caption="企業ごとの、売上高・営業利益・当期純利益・総資産"
          columns={columns}
          rows={amount(['sales', 'operatingProfit', 'netIncome', 'totalAssets'], false)}
        />
      </Section>

      <Section title="成長性" lead="前の期との比べです。前の期が無い・連結と単体が切り替わった企業は「—」です。">
        <CompareTable caption="企業ごとの、売上高・営業利益の前期比" columns={columns} rows={growth} />
      </Section>

      <Section title="収益性の指標">
        <CompareTable caption="企業ごとの、収益性の指標" columns={columns} rows={metricRows(comparison, 'profitability')} />
      </Section>

      <Section title="安定性の指標">
        <CompareTable caption="企業ごとの、安定性の指標" columns={columns} rows={metricRows(comparison, 'stability')} />
      </Section>

      <Section title="キャッシュフロー" lead="営業 → 投資 → 財務の順です。プラスは資金が入った、マイナスは資金が出た。">
        <UnitNote>{`単位: ${COMPARE_UNIT}`}</UnitNote>
        <CompareTable caption="企業ごとの、キャッシュフローの 3 区分とフリーキャッシュフロー" columns={columns} rows={cashRows} />
      </Section>

      <Section title="指標をグラフで比べる" lead="指標を 1 つ選ぶと、企業ごとの値を棒で並べます。点線は、目安です。">
        <CompareChart columns={columns} rows={comparison.metricRows} />
      </Section>

      <Section title="企業の詳しい分析へ">
        <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-1 p-0">
          {columns.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpenCompany(c.id)}
                className="min-h-11 font-bold text-blue-900 underline underline-offset-4 hover:text-blue-1000"
              >
                {c.name}の分析を見る →
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

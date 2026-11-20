import { useId, useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getMetricDefinition } from '../domain/catalog'
import { reasonShort, type CompareColumn, type MetricRow } from '../domain/compare'
import { formatMetric } from '../lib/format'
import { AXIS_TICK, GRID_STROKE, SERIES, ZERO_LINE_STROKE } from './chartTheme'
import { FIELD } from './styles'

const BAR_HEIGHT = 44
const CHART_PADDING = 76
/** 企業名の、グラフの軸に出す最大の文字数(長い名前は切る。全文は、表と読み上げ用の文に出る) */
const NAME_CHARS = 8
const NAME_HEAD = 5
const NAME_TAIL = 2

interface Props {
  readonly columns: readonly CompareColumn[]
  readonly rows: readonly MetricRow[]
}

/** 軸に出す短い名前。「株式会社」は省く。長い名前は、中を省いて、先頭と末尾を残す(末尾だけが違う名前を、見分けられるように) */
function shortName(name: string): string {
  const chars = Array.from(name.replaceAll('株式会社', ''))
  if (chars.length <= NAME_CHARS) return chars.join('')
  return `${chars.slice(0, NAME_HEAD).join('')}…${chars.slice(-NAME_TAIL).join('')}`
}

/** 指標を 1 つ選んで、企業ごとの値を棒グラフで比べる(算出できない企業は、棒を出さず、読み上げ用の文に書く) */
export function CompareChart({ columns, rows }: Props) {
  const selectId = useId()
  const [selected, setSelected] = useState<string>('operatingMargin')
  const row = rows.find((r) => r.key === selected) ?? rows[0]
  const def = getMetricDefinition(row.key)
  // 軸の区分は、企業の id で分ける(名前の先頭が同じ企業が、1 本に重ならないように)。表示する名前は、目盛りの書式で短くする
  const data = columns.map((c, i) => ({ id: c.id, name: c.name, value: row.cells[i].value, reason: row.cells[i].reason }))
  const bars = data.filter((d) => d.value !== null)
  const missing = data.filter((d) => d.value === null)
  const nameOf = (id: string): string => shortName(data.find((d) => d.id === id)?.name ?? id)
  const guideline = def.guideline
  const text = data
    .map((d) => `${d.name} ${d.value === null ? '算出できません' : formatMetric(d.value, row.unit)}`)
    .join('、')
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={selectId} className="font-bold">
          比べる指標
        </label>
        <select id={selectId} value={row.key} onChange={(e) => setSelected(e.target.value)} className={FIELD}>
          {rows.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-solid-gray-800">
        {def.label}: {def.formula}
        {row.direction === 'higher' ? '(大きいほど良い)' : '(小さいほど良い)'}
      </p>
      <p className="sr-only">{`${def.label}(単位: ${row.unit})の企業ごとの値: ${text}`}</p>
      {missing.length > 0 ? (
        <p className="mt-2 text-solid-gray-800">
          算出できないため、棒を出していない企業:{' '}
          {missing.map((d) => `${d.name}(${d.reason === null ? '算出不可' : reasonShort(d.reason)})`).join('、')}
        </p>
      ) : null}
      <p className="tnum mb-1 mt-2 text-right text-sm text-solid-gray-700">単位: {row.unit}</p>
      <ResponsiveContainer width="100%" height={Math.max(1, bars.length) * BAR_HEIGHT + CHART_PADDING}>
        <BarChart data={bars} layout="vertical" margin={{ top: 28, right: 56, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} tickFormatter={(v: number) => String(v)} />
          <YAxis type="category" dataKey="id" tick={AXIS_TICK} width={132} tickFormatter={nameOf} />
          <Tooltip
            labelFormatter={(id) => data.find((d) => d.id === id)?.name ?? String(id)}
            formatter={(v) => (typeof v === 'number' ? formatMetric(v, row.unit) : String(v))}
          />
          <ReferenceLine x={0} stroke={ZERO_LINE_STROKE} />
          {guideline === undefined ? null : (
            <ReferenceLine
              x={guideline.good}
              stroke="var(--color-solid-gray-800)"
              strokeDasharray="6 4"
              label={{ value: `目安 ${guideline.good}`, position: 'top', fontSize: 12 }}
            />
          )}
          <Bar dataKey="value" fill={SERIES.sales.color} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: unknown) => (typeof v === 'number' ? formatMetric(v, row.unit) : '')}
              style={{ fontSize: 14 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

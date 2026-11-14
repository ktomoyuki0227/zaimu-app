import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { WaterfallRow } from '../domain/waterfall'
import { formatAmount, formatSignedAmount } from '../lib/format'
import { AXIS_TICK, GRID_STROKE, ZERO_LINE_STROKE, yAxisWidth } from './chartTheme'

/** 横軸のラベルが重ならないよう、1 項目に確保する最小の幅(px) */
const MIN_BAR_SLOT_PX = 96
/** 横軸のラベルを折り返す文字数・行の高さ(px)・最大の行数(1 項目の幅 96px に収まる) */
const TICK_LINE_CHARS = 6
const TICK_LINE_PX = 17
const TICK_MAX_LINES = 3
/** 横の幅が足りず、グラフを横にスクロールすることになる項目数(PC の幅でも収まらない数) */
const SCROLL_HINT_MIN_ROWS = 4
const COLOR_TOTAL = 'var(--color-blue-900)'
const COLOR_UP = 'var(--color-green-700)'
const COLOR_DOWN = 'var(--color-red-900)'
const COLOR_TOTAL_NEGATIVE = 'var(--color-red-1100)'

function rowColor(row: WaterfallRow): string {
  if (row.kind === 'total') {
    return row.value >= 0 ? COLOR_TOTAL : COLOR_TOTAL_NEGATIVE
  }
  return row.value >= 0 ? COLOR_UP : COLOR_DOWN
}

function rowLabel(row: WaterfallRow): string {
  return row.kind === 'total' ? formatAmount(row.value) : formatSignedAmount(row.value)
}

interface TooltipPayload {
  readonly payload?: WaterfallRow
}

function WaterfallTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const row = payload?.[0]?.payload
  if (!active || !row) {
    return null
  }
  return (
    <div className="rounded-6 border border-solid-gray-420 bg-white px-3 py-2 shadow-1">
      <p className="font-bold">{row.label}</p>
      <p className="tnum">{rowLabel(row)}</p>
      <p className="text-sm text-solid-gray-700">
        {row.kind === 'total' ? '合計・小計' : '前の項目からの増減'}
      </p>
    </div>
  )
}

/** 折り返して描く横軸のラベル。長い項目名が、隣のラベルと重ならないようにする */
function WrappedTick({ x = 0, y = 0, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  const chars = Array.from(payload?.value ?? '')
  const lines: string[] = []
  for (let i = 0; i < chars.length && lines.length < TICK_MAX_LINES; i += TICK_LINE_CHARS) {
    lines.push(chars.slice(i, i + TICK_LINE_CHARS).join(''))
  }
  const last = lines.length - 1
  if (chars.length > TICK_LINE_CHARS * TICK_MAX_LINES && last >= 0) {
    lines[last] = `${lines[last].slice(0, -1)}…`
  }
  return (
    <text x={x} y={y} textAnchor="middle" fill={AXIS_TICK.fill} fontSize={AXIS_TICK.fontSize}>
      {lines.map((line, i) => (
        <tspan key={`${i}-${line}`} x={x} dy={i === 0 ? TICK_LINE_PX - 2 : TICK_LINE_PX}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

interface Props {
  readonly rows: readonly WaterfallRow[]
  /** 金額の単位(読み上げの文に添える) */
  readonly unit?: string
  readonly height?: number
}

/** 滝グラフ。合計は 0 から立ち上がり、増減は直前の累計から浮かせて描く */
export function WaterfallChart({ rows, height = 340, unit }: Props) {
  const axisWidth = yAxisWidth(
    rows.flatMap((r) => r.range),
    formatAmount,
  )
  // 棒の上に出す文字は、行ごとに先に作っておく(グラフの部品に、行を探させない)
  const data = rows.map((row) => ({ ...row, text: rowLabel(row) }))
  const summary = rows.map((r) => `${r.label} ${rowLabel(r)}`).join('、')
  return (
    <div>
      <p className="sr-only">{`${unit === undefined ? '' : `(単位: ${unit})`}${summary}`}</p>
      {/* 項目が多いので、狭い画面では 1 項目あたりの幅を確保して、横にスクロールできるようにする */}
      <div className="relative overflow-x-auto">
        <div style={{ minWidth: rows.length * MIN_BAR_SLOT_PX + axisWidth }}>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} margin={{ top: 24, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="label"
                tick={<WrappedTick />}
                interval={0}
                height={TICK_LINE_PX * TICK_MAX_LINES + 12}
              />
              <YAxis tick={AXIS_TICK} width={axisWidth} tickFormatter={(v: number) => formatAmount(v)} />
              <Tooltip content={<WaterfallTooltip />} cursor={{ fill: 'var(--color-solid-gray-50)' }} />
              <ReferenceLine y={0} stroke={ZERO_LINE_STROKE} />
              <Bar dataKey="range" isAnimationActive={false}>
                {rows.map((row, i) => (
                  <Cell key={`${row.label}-${i}`} fill={rowColor(row)} />
                ))}
                <LabelList dataKey="text" position="top" fill="var(--color-solid-gray-900)" fontSize={13} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      {rows.length >= SCROLL_HINT_MIN_ROWS ? (
        <p className="mt-1 text-sm text-solid-gray-700 lg:hidden">グラフは左右にスクロールできます。</p>
      ) : null}
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-solid-gray-800">
        <LegendItem color={COLOR_TOTAL} label="合計・小計" />
        <LegendItem color={COLOR_UP} label="増加" />
        <LegendItem color={COLOR_DOWN} label="減少(費用など)" />
      </ul>
    </div>
  )
}

function LegendItem({ color, label }: { readonly color: string; readonly label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-block size-3.5 rounded-sm"
        style={{ background: color }}
      />
      {label}
    </li>
  )
}

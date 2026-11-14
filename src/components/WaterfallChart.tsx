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
import { AXIS_TICK, GRID_STROKE, ZERO_LINE_STROKE } from './chartTheme'

/** 横軸のラベルが重ならないよう、1 項目に確保する最小の幅(px) */
const MIN_BAR_SLOT_PX = 96
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

interface Props {
  readonly rows: readonly WaterfallRow[]
  readonly height?: number
}

/** 滝グラフ。合計は 0 から立ち上がり、増減は直前の累計から浮かせて描く */
export function WaterfallChart({ rows, height = 340 }: Props) {
  return (
    <div>
      {/* 項目が多いので、狭い画面では 1 項目あたりの幅を確保して、横にスクロールできるようにする */}
      <div className="relative overflow-x-auto">
        <div style={{ minWidth: rows.length * MIN_BAR_SLOT_PX }}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={[...rows]} margin={{ top: 24, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} interval={0} />
          <YAxis tick={AXIS_TICK} width={64} tickFormatter={(v: number) => formatAmount(v)} />
          <Tooltip content={<WaterfallTooltip />} cursor={{ fill: 'var(--color-solid-gray-50)' }} />
          <ReferenceLine y={0} stroke={ZERO_LINE_STROKE} />
          <Bar dataKey="range" isAnimationActive={false}>
            {rows.map((row, i) => (
              <Cell key={`${row.label}-${i}`} fill={rowColor(row)} />
            ))}
            <LabelList
              dataKey="range"
              position="top"
              fill="var(--color-solid-gray-900)"
              fontSize={13}
              formatter={(range: unknown) => {
                const row = rows.find((r) => r.range === range)
                return row ? rowLabel(row) : ''
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
        </div>
      </div>
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

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { GrowthPoint } from '../domain/growth'
import { formatAmount, formatSignedPercent, shortPeriodLabel } from '../lib/format'
import { AXIS_TICK, GRID_STROKE, LINE_DASH, SERIES, ZERO_LINE_STROKE } from './chartTheme'

/** グラフの高さ(px) */
const HEIGHT_TREND = 300
const HEIGHT_RATE = 340
/** 割合(%)の縦軸の幅(px)。「-1,234%」まで収まる */
const PERCENT_AXIS_WIDTH = 64
const MARGIN = { top: 8, right: 16, bottom: 8, left: 0 } as const

export interface TrendPoint {
  readonly label: string
  readonly sales: number
  readonly operatingProfit: number
  readonly ordinaryProfit: number
  readonly netIncome: number
}

export interface CompositionPoint {
  readonly label: string
  readonly costOfSales: number
  readonly sga: number
  readonly operatingProfit: number
}

type LineSeriesKey = 'sales' | 'operatingProfit' | 'ordinaryProfit' | 'netIncome'

const amountTooltip = (v: unknown): string => (typeof v === 'number' ? formatAmount(v) : String(v))

/** 折れ線の定義(色と線の種類は、系列ごとに決まっている)。dots: 点を付けるか */
function seriesLines(keys: readonly LineSeriesKey[], dots: boolean) {
  return keys.map((key) => (
    <Line
      key={key}
      dataKey={key}
      name={SERIES[key].label}
      stroke={SERIES[key].color}
      strokeWidth={3}
      dot={dots ? { r: 4 } : undefined}
      strokeDasharray={LINE_DASH[key]}
      isAnimationActive={false}
    />
  ))
}

/** 売上高の棒グラフ */
export function SalesTrendChart({ trend, axisWidth }: { readonly trend: readonly TrendPoint[]; readonly axisWidth: number }) {
  return (
    <ResponsiveContainer width="100%" height={HEIGHT_TREND}>
      <BarChart data={[...trend]} margin={{ ...MARGIN, right: 8 }}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={shortPeriodLabel} />
        <YAxis tick={AXIS_TICK} width={axisWidth} tickFormatter={(v: number) => formatAmount(v)} />
        <Tooltip formatter={amountTooltip} />
        <Bar dataKey="sales" name={SERIES.sales.label} fill={SERIES.sales.color} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** 営業・経常・当期純利益の折れ線 */
export function ProfitTrendChart({ trend, axisWidth }: { readonly trend: readonly TrendPoint[]; readonly axisWidth: number }) {
  return (
    <ResponsiveContainer width="100%" height={HEIGHT_TREND}>
      <LineChart data={[...trend]} margin={MARGIN}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={shortPeriodLabel} />
        <YAxis tick={AXIS_TICK} width={axisWidth} tickFormatter={(v: number) => formatAmount(v)} />
        <Tooltip formatter={amountTooltip} />
        <Legend />
        <ReferenceLine y={0} stroke={ZERO_LINE_STROKE} />
        {seriesLines(['operatingProfit', 'ordinaryProfit', 'netIncome'], true)}
      </LineChart>
    </ResponsiveContainer>
  )
}

/** 前期比の増減率の折れ線。下に、同じ数値の表(折りたたみ)を付ける */
export function GrowthRateChart({ growth }: { readonly growth: readonly GrowthPoint[] }) {
  return (
    <>
      <ResponsiveContainer width="100%" height={HEIGHT_RATE}>
        <LineChart data={[...growth]} margin={MARGIN}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={shortPeriodLabel} />
          <YAxis tick={AXIS_TICK} width={PERCENT_AXIS_WIDTH} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip formatter={(v) => (typeof v === 'number' ? formatSignedPercent(v) : String(v))} />
          <Legend />
          <ReferenceLine y={0} stroke={ZERO_LINE_STROKE} />
          {seriesLines(['sales', 'operatingProfit', 'ordinaryProfit', 'netIncome'], false)}
        </LineChart>
      </ResponsiveContainer>

      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer py-2 font-bold text-blue-900 underline underline-offset-4">
          数値を表で見る
        </summary>
        <div className="relative mt-3 overflow-x-auto">
          <table className="tnum w-full min-w-[32rem] border-collapse text-right">
            <caption className="sr-only">売上高と各利益の前期比(%)の表</caption>
            <thead>
              <tr className="border-b-2 border-solid-gray-900">
                <th scope="col" className="py-2 pr-4 text-left">
                  期
                </th>
                <th scope="col" className="px-3 py-2">
                  売上高
                </th>
                <th scope="col" className="px-3 py-2">
                  営業利益
                </th>
                <th scope="col" className="px-3 py-2">
                  経常利益
                </th>
                <th scope="col" className="px-3 py-2">
                  当期純利益
                </th>
              </tr>
            </thead>
            <tbody>
              {growth.map((g, i) => (
                <tr key={`${g.label}-${i}`} className="border-b border-solid-gray-200">
                  <th scope="row" className="py-2 pr-4 text-left font-normal">
                    {g.label}
                  </th>
                  <td className="px-3 py-2">{formatSignedPercent(g.sales)}</td>
                  <td className="px-3 py-2">{formatSignedPercent(g.operatingProfit)}</td>
                  <td className="px-3 py-2">{formatSignedPercent(g.ordinaryProfit)}</td>
                  <td className="px-3 py-2">{formatSignedPercent(g.netIncome)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}

/** 売上高を 100% としたときの、原価・販管費・営業利益の積み上げ棒グラフ */
export function CompositionChart({ composition }: { readonly composition: readonly CompositionPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={HEIGHT_RATE}>
      <BarChart data={[...composition]} margin={MARGIN}>
        <CartesianGrid stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={shortPeriodLabel} />
        <YAxis tick={AXIS_TICK} width={PERCENT_AXIS_WIDTH} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip formatter={(v) => (typeof v === 'number' ? `${v.toFixed(1)}%` : String(v))} />
        <Legend />
        <ReferenceLine y={100} stroke={ZERO_LINE_STROKE} strokeDasharray="6 4" />
        <Bar dataKey="costOfSales" name="売上原価" stackId="pl" fill="var(--color-solid-gray-300)" isAnimationActive={false} />
        <Bar dataKey="sga" name="販管費" stackId="pl" fill="var(--color-solid-gray-500)" isAnimationActive={false} />
        <Bar
          dataKey="operatingProfit"
          name="営業利益"
          stackId="pl"
          fill={SERIES.operatingProfit.color}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

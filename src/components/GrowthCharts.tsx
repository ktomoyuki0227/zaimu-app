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
import { amountUnitText, formatAmount, formatSignedPercent, shortPeriodLabel, withUnit } from '../lib/format'
import { AXIS_TICK, GRID_STROKE, LINE_DASH, SERIES, ZERO_LINE_STROKE } from './chartTheme'
import { UnitNote } from './ui'

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

/** 売上高を 100% としたときの割合(%)。売上高が 0 以下の期は、計算できないので null */
export interface CompositionPoint {
  readonly label: string
  readonly costOfSales: number | null
  readonly sga: number | null
  readonly operatingProfit: number | null
}

type LineSeriesKey = 'sales' | 'operatingProfit' | 'ordinaryProfit' | 'netIncome'

/** 吹き出しの金額に、単位を添える */
const amountTooltip =
  (unit: string | undefined) =>
  (v: unknown): string =>
    typeof v === 'number' ? withUnit(formatAmount(v), unit) : String(v)

/** グラフの中身を、グラフが見えない人にも伝える文(画面には出さない。読み上げ用) */
function ChartSummary({ children }: { readonly children: string }) {
  return <p className="sr-only">{children}</p>
}

function unitSuffix(unit: string | undefined): string {
  return `(${amountUnitText(unit)})`
}

/**
 * 折れ線の定義(色と線の種類は、系列ごとに決まっている)。
 * 点は必ず付ける(連結・単体の切り替わりで線が途切れても、前後の 1 点だけの期が、見えなくならないように)。
 */
function seriesLines(keys: readonly LineSeriesKey[], dotRadius: number) {
  return keys.map((key) => (
    <Line
      key={key}
      dataKey={key}
      name={SERIES[key].label}
      stroke={SERIES[key].color}
      strokeWidth={3}
      dot={{ r: dotRadius }}
      strokeDasharray={LINE_DASH[key]}
      isAnimationActive={false}
    />
  ))
}

/** 数字の範囲(連結・単体)が変わる期の、グラフの下の注意。前後の棒・線を、伸びとして読ませない */
export function BasisNote({ changes }: { readonly changes: readonly string[] }) {
  if (changes.length === 0) return null
  return (
    <p role="note" className="mt-2 text-sm text-solid-gray-700">
      数字の範囲(連結・単体)が変わる期: {changes.join('、')}。その前後は範囲が違うため、増えた・減ったとは読めません。
    </p>
  )
}

interface TrendProps {
  readonly trend: readonly TrendPoint[]
  /** 数字の範囲(連結・単体)が変わる期の名前 */
  readonly basisChanges: readonly string[]
  readonly axisWidth: number
  /** 金額の単位(読み上げの文に添える) */
  readonly unit?: string
}

/** 売上高の棒グラフ */
export function SalesTrendChart({ trend, basisChanges, axisWidth, unit }: TrendProps) {
  return (
    <>
      <ChartSummary>
        {`売上高の推移${unitSuffix(unit)}: ${trend.map((t) => `${t.label} ${formatAmount(t.sales)}`).join('、')}`}
      </ChartSummary>
      <UnitNote>{amountUnitText(unit)}</UnitNote>
      <ResponsiveContainer width="100%" height={HEIGHT_TREND}>
        <BarChart data={[...trend]} margin={{ ...MARGIN, right: 8 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={shortPeriodLabel} />
          <YAxis tick={AXIS_TICK} width={axisWidth} tickFormatter={(v: number) => formatAmount(v)} />
          <Tooltip formatter={amountTooltip(unit)} />
          <Bar dataKey="sales" name={SERIES.sales.label} fill={SERIES.sales.color} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <BasisNote changes={basisChanges} />
    </>
  )
}

/** 営業・経常・当期純利益の折れ線 */
export function ProfitTrendChart({ trend, basisChanges, axisWidth, unit }: TrendProps) {
  const text = trend
    .map(
      (t) =>
        `${t.label} 営業利益 ${formatAmount(t.operatingProfit)}、経常利益 ${formatAmount(t.ordinaryProfit)}、当期純利益 ${formatAmount(t.netIncome)}`,
    )
    .join('。')
  return (
    <>
      <ChartSummary>{`各段階の利益の推移${unitSuffix(unit)}: ${text}`}</ChartSummary>
      <UnitNote>{amountUnitText(unit)}</UnitNote>
      <ResponsiveContainer width="100%" height={HEIGHT_TREND}>
        <LineChart data={[...trend]} margin={MARGIN}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={shortPeriodLabel} />
          <YAxis tick={AXIS_TICK} width={axisWidth} tickFormatter={(v: number) => formatAmount(v)} />
          <Tooltip formatter={amountTooltip(unit)} />
          <Legend />
          <ReferenceLine y={0} stroke={ZERO_LINE_STROKE} />
          {seriesLines(['operatingProfit', 'ordinaryProfit', 'netIncome'], 4)}
        </LineChart>
      </ResponsiveContainer>
      <BasisNote changes={basisChanges} />
    </>
  )
}

/** 前期比の増減率の折れ線。下に、同じ数値の表(折りたたみ。読み上げにも使える)を付ける */
export function GrowthRateChart({
  growth,
  basisChanges,
}: {
  readonly growth: readonly GrowthPoint[]
  /** 前期と数字の範囲(連結・単体)が違うため、増減を計算していない期の名前 */
  readonly basisChanges: readonly string[]
}) {
  return (
    <>
      <UnitNote>単位: %(前期からの増減率)</UnitNote>
      <ResponsiveContainer width="100%" height={HEIGHT_RATE}>
        <LineChart data={[...growth]} margin={MARGIN}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={shortPeriodLabel} />
          <YAxis tick={AXIS_TICK} width={PERCENT_AXIS_WIDTH} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip formatter={(v) => (typeof v === 'number' ? formatSignedPercent(v) : String(v))} />
          <Legend />
          <ReferenceLine y={0} stroke={ZERO_LINE_STROKE} />
          {seriesLines(['sales', 'operatingProfit', 'ordinaryProfit', 'netIncome'], 3)}
        </LineChart>
      </ResponsiveContainer>

      {basisChanges.length > 0 ? (
        <p className="mt-2 text-sm text-solid-gray-700">
          {basisChanges.join('、')}は、前期と連結・単体の範囲が違うため、増減を計算していません(線がつながっていません)。
        </p>
      ) : null}

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

const percentText = (v: number | null): string => (v === null ? '計算できません' : `${v.toFixed(1)}%`)

/**
 * 売上高を 100% としたときの、原価・販管費・営業利益の積み上げ棒グラフ。
 * 売上高が 0 以下の期は割合を計算できないので、0% の棒にせず、棒を描かずに、その旨を書く。
 */
export function CompositionChart({
  composition,
  basisChanges,
}: {
  readonly composition: readonly CompositionPoint[]
  readonly basisChanges: readonly string[]
}) {
  const skipped = composition.filter((c) => c.costOfSales === null).map((c) => c.label)
  const text = composition
    .map(
      (c) =>
        `${c.label} 売上原価 ${percentText(c.costOfSales)}、販管費 ${percentText(c.sga)}、営業利益 ${percentText(c.operatingProfit)}`,
    )
    .join('。')
  return (
    <>
      <ChartSummary>{`売上高を 100% としたときの中身: ${text}`}</ChartSummary>
      <UnitNote>単位: %(売上高を 100% としたときの割合)</UnitNote>
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
      <BasisNote changes={basisChanges} />
      {skipped.length > 0 ? (
        <p className="mt-2 text-sm text-solid-gray-700">
          売上高が 0 以下の期({skipped.join('、')})は、割合を計算できないため、棒を描いていません。
        </p>
      ) : null}
    </>
  )
}

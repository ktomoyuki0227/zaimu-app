import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CASH_FLOW_KINDS, cashFlowValue, type CashFlowSummary } from '../domain/cashFlow'
import { amountUnitText, formatAmount, formatSignedAmount, shortPeriodLabel, withUnit } from '../lib/format'
import { AXIS_TICK, CASH_FLOW_COLORS, GRID_STROKE, ZERO_LINE_STROKE, yAxisWidth } from './chartTheme'
import { BasisNote } from './GrowthCharts'
import { UnitNote } from './ui'

const HEIGHT = 320

/** 短い名前(凡例・吹き出し用)。正式な名前は、表と見出しに出す */
const SHORT_NAME = {
  operatingCashFlow: '営業CF',
  investingCashFlow: '投資CF',
  financingCashFlow: '財務CF',
} as const

interface Props {
  readonly summaries: readonly CashFlowSummary[]
  /** 数字の範囲(連結・単体)が変わる期の名前 */
  readonly basisChanges: readonly string[]
  readonly unit: string | undefined
}

/**
 * 営業・投資・財務の 3 つを、期ごとに並べた棒グラフ(左から、営業 → 投資 → 財務の順)。
 * プラスは 0 の線より上(資金が入った)、マイナスは下(資金が出た)。
 */
export function CashFlowChart({ summaries, basisChanges, unit }: Props) {
  const data = summaries.map((s) => ({
    label: s.label,
    operatingCashFlow: s.operating,
    investingCashFlow: s.investing,
    financingCashFlow: s.financing,
  }))
  const axisWidth = yAxisWidth(
    summaries.flatMap((s) => [s.operating, s.investing, s.financing].filter((v): v is number => v !== null)),
    formatAmount,
  )
  const text = summaries
    .map((s) => {
      const parts = CASH_FLOW_KINDS.map((k) => {
        const value = cashFlowValue(s, k.key)
        return `${SHORT_NAME[k.key]} ${value === null ? '数字なし' : formatSignedAmount(value)}`
      })
      return `${s.label} ${parts.join('、')}`
    })
    .join('。')
  return (
    <>
      <p className="sr-only">{`キャッシュフローの推移(${amountUnitText(unit)}): ${text}`}</p>
      <UnitNote>{amountUnitText(unit)}</UnitNote>
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={GRID_STROKE} vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickFormatter={shortPeriodLabel} />
          <YAxis tick={AXIS_TICK} width={axisWidth} tickFormatter={(v: number) => formatAmount(v)} />
          <Tooltip formatter={(v) => (typeof v === 'number' ? withUnit(formatSignedAmount(v), unit) : String(v))} />
          <Legend />
          <ReferenceLine y={0} stroke={ZERO_LINE_STROKE} />
          {CASH_FLOW_KINDS.map((kind) => (
            <Bar
              key={kind.key}
              dataKey={kind.key}
              name={SHORT_NAME[kind.key]}
              fill={CASH_FLOW_COLORS[kind.key]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <BasisNote changes={basisChanges} />
    </>
  )
}

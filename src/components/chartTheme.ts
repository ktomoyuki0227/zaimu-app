/**
 * グラフの配色。デザインシステムの色トークンを使う(CSS 変数のまま SVG に渡せる)。
 * 4 色(売上高・営業利益・経常利益・当期純利益)は、dataviz の検証スクリプトで、
 * 明るさの帯・彩度・色覚の違いでの見分けやすさ(最小 ΔE 9.1)・背景とのコントラスト(3:1 以上)を確かめて選んだ。
 * 色だけに頼らないよう、折れ線は線の種類(実線・破線・点線)も変えている。
 */
export const SERIES = {
  sales: { label: '売上高', color: 'var(--color-blue-700)' },
  grossProfit: { label: '売上総利益', color: 'var(--color-cyan-800)' },
  operatingProfit: { label: '営業利益', color: 'var(--color-orange-700)' },
  ordinaryProfit: { label: '経常利益', color: 'var(--color-green-600)' },
  netIncome: { label: '当期純利益', color: 'var(--color-purple-600)' },
} as const

export const AXIS_TICK = { fontSize: 14, fill: 'var(--color-solid-gray-800)' } as const
export const GRID_STROKE = 'var(--color-solid-gray-200)'
export const ZERO_LINE_STROKE = 'var(--color-solid-gray-900)'

/** 折れ線を色以外でも見分けられるよう、線の種類を変える */
export const LINE_DASH: Record<string, string | undefined> = {
  sales: undefined,
  operatingProfit: undefined,
  ordinaryProfit: '8 4',
  netIncome: '2 4',
}

/** 数字 1 文字の幅(px)の目安。AXIS_TICK の文字の大きさ(14px)に合わせている */
const TICK_CHAR_PX = 8.5
const Y_AXIS_MIN_PX = 48
const Y_AXIS_MAX_PX = 120

/**
 * 縦軸の数字が切れないように、軸の幅(px)を、いちばん長い数字から決める。
 * 目盛りは「きりの良い数」に切り上がり、桁が 1 つ増えることがあるので、1 文字分の余裕を足す。
 */
export function yAxisWidth(values: readonly number[], format: (value: number) => string): number {
  const longest = Math.max(
    0,
    ...values.flatMap((v) => (Number.isFinite(v) ? [format(v).length] : [])),
  )
  const width = Math.ceil((longest + 1) * TICK_CHAR_PX) + 8
  return Math.min(Y_AXIS_MAX_PX, Math.max(Y_AXIS_MIN_PX, width))
}

/**
 * キャッシュフロー 3 区分の色。他のグラフで色の見分けやすさを確かめた色を使い回す
 * (営業 = 青、投資 = オレンジ、財務 = 紫)。色だけに頼らず、並びと名前、符号でも区別できるようにしている。
 */
export const CASH_FLOW_COLORS = {
  operatingCashFlow: SERIES.sales.color,
  investingCashFlow: SERIES.operatingProfit.color,
  financingCashFlow: SERIES.netIncome.color,
} as const

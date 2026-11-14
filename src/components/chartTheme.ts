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

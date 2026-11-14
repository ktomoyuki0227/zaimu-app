import { displayDigits, type MetricUnit } from '../domain/catalog'

const MISSING = '—'

/** 金額(整数でなくても桁区切りで表示) */
export function formatAmount(value: number): string {
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 1 })
}

/** 小数点以下 digits 桁に丸めた文字列。丸めて 0 になる値は「-0.0」ではなく「0.0」にする */
function fixed(value: number, digits: number): string {
  const text = value.toFixed(digits)
  return Number(text) === 0 ? (0).toFixed(digits) : text
}

/** 指標の値を単位つきで表示する。算出できない値は「—」 */
export function formatMetric(value: number | null, unit: MetricUnit): string {
  if (value === null) {
    return MISSING
  }
  return `${fixed(value, displayDigits(unit))}${unit}`
}

/** 増減率を符号つきで表示する(+12.3% / -4.5%)。丸めて 0 になる値には符号をつけない */
export function formatSignedPercent(value: number | null): string {
  if (value === null) {
    return MISSING
  }
  const text = fixed(value, 1)
  return `${Number(text) > 0 ? '+' : ''}${text}%`
}

/** 増減額を符号つきで表示する */
export function formatSignedAmount(value: number): string {
  return `${value > 0 ? '+' : ''}${formatAmount(value)}`
}

const PERIOD_LABEL = /^(\d{4})年(\d{1,2})月期$/

/** 横軸に並べる短い期の名前。「2025年3月期」→「2025/3」。読めない名前はそのまま */
export function shortPeriodLabel(label: string): string {
  const m = PERIOD_LABEL.exec(label)
  return m === null ? label : `${m[1]}/${Number(m[2])}`
}

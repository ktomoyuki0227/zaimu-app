import { displayDigits, roundForDisplay, type MetricUnit } from '../domain/catalog'

const MISSING = '—'

const UNNAMED = '(名前なし)'

/** 画面に出す企業の名前。名前が空のときは「(名前なし)」 */
export function companyLabel(company: { readonly name: string }): string {
  return company.name || UNNAMED
}

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

const NO_COMPARISON = '前期との比較はできません'

/**
 * 前期からの変化の文。表示する桁に丸めた値どうしの差で決めるので、表示と食い違わない
 * (「12.3%」と「12.3%」なのに、「↑ +0.1pt」と出さない)。率(%)の差は「pt」、ほかは単位のまま。
 */
export function formatChange(unit: MetricUnit, now: number | null, before: number | null): string {
  if (now === null || before === null) {
    return NO_COMPARISON
  }
  const digits = displayDigits(unit)
  const diff = roundForDisplay(now, unit) - roundForDisplay(before, unit)
  // 表示する桁で 0 になる差は「横ばい」とする(「↑ +0.0pt」と出さない)
  if (Math.abs(diff) < 0.5 * 10 ** -digits) {
    return '前期から横ばい'
  }
  const suffix = unit === '%' ? 'pt' : unit
  return `前期から ${diff > 0 ? '↑ +' : '↓ '}${diff.toFixed(digits)}${suffix}`
}

/** 金額の単位の表示。単位の記録が無い(古い保存データ)ときは、「不明」と書く */
export function amountUnitText(unit: string | undefined): string {
  return `単位: ${unit ?? '不明'}`
}

/** 金額の文字に、単位を添える(吹き出しなど、単位が近くに無い場所で使う) */
export function withUnit(text: string, unit: string | undefined): string {
  return unit === undefined ? text : `${text} ${unit}`
}

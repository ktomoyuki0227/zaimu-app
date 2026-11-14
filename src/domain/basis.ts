import type { Basis, PeriodData } from './types'

/**
 * 数字の範囲(連結・単体)を扱う。
 * 連結は子会社を含むグループ全体、単体はその会社だけ。範囲が違う数字を並べて増減を出すと、
 * 子会社の分だけ大きく(小さく)見えて、事業の実際の伸びと違ってしまう。
 */

export function basisLabel(basis: Basis): string {
  return basis === 'consolidated' ? '連結' : '単体'
}

/** 2 つの期の範囲が違うか。どちらかの範囲が分からない(古いデータ・練習用データ)ときは、違うとはみなさない */
export function isBasisChange(previous: PeriodData, current: PeriodData): boolean {
  return previous.basis !== undefined && current.basis !== undefined && previous.basis !== current.basis
}

/** 範囲が違うため、前期と比べられないことの説明 */
export function basisChangeNote(previous: PeriodData, current: PeriodData): string {
  const before = previous.basis === undefined ? '不明' : basisLabel(previous.basis)
  const after = current.basis === undefined ? '不明' : basisLabel(current.basis)
  return `前期(${previous.label})は${before}、${current.label}は${after}の数字です。範囲が違うため、前期との増減は計算していません。`
}

/** 範囲が切り替わる期(その期から、前の期と範囲が違う)の名前 */
export function basisChangeLabels(periods: readonly PeriodData[]): readonly string[] {
  return periods.flatMap((p, i) => (i > 0 && isBasisChange(periods[i - 1], p) ? [p.label] : []))
}

/**
 * 期ごとの範囲を、まとめて説明する(例: 「2022年12月期〜2024年12月期は単体、2025年12月期は連結」)。
 * 範囲が分かる期が無いときは null。
 */
export function basisSummary(periods: readonly PeriodData[]): string | null {
  const runs: { basis: Basis; first: string; last: string }[] = []
  for (const p of periods) {
    if (p.basis === undefined) continue
    const run = runs[runs.length - 1]
    if (run !== undefined && run.basis === p.basis) run.last = p.label
    else runs.push({ basis: p.basis, first: p.label, last: p.label })
  }
  if (runs.length === 0) return null
  return runs
    .map((r) => `${r.first === r.last ? r.first : `${r.first}〜${r.last}`}は${basisLabel(r.basis)}`)
    .join('、')
}

/** 範囲が混ざっているか(連結と単体の両方の期があるか) */
export function hasMixedBasis(periods: readonly PeriodData[]): boolean {
  return new Set(periods.flatMap((p) => (p.basis === undefined ? [] : [p.basis]))).size > 1
}

/** 表や選択肢に出す期の名前。範囲が混ざっている会社では、「2025年12月期(連結)」のように範囲を添える */
export function periodHeading(period: PeriodData, mixed: boolean): string {
  return mixed && period.basis !== undefined ? `${period.label}(${basisLabel(period.basis)})` : period.label
}

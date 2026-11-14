import { displayDigits, type MetricDefinition } from '../domain/catalog'

/** 目安との差を、言葉で言い表す(「+0.0」と出さないよう、表示の桁で 0 なら「ちょうど」) */
export function gapText(def: MetricDefinition, gap: number | null): string {
  if (gap === null) {
    return ''
  }
  const digits = displayDigits(def.unit)
  const unit = def.unit === '%' ? 'pt' : def.unit
  if (Math.abs(gap) < 0.5 * 10 ** -digits) {
    return '目安ちょうど'
  }
  const amount = `${Math.abs(gap).toFixed(digits)}${unit}`
  return gap > 0 ? `目安より ${amount} 良い` : `目安に ${amount} 届いていません`
}

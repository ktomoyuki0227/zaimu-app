import { basisChangeNote, isBasisChange } from './basis'
import { classifyGrowthPattern, commonSizePl, growthRate } from './growth'
import { deriveStatements } from './statements'
import type { PeriodData } from './types'

const FLAT_THRESHOLD_PT = 0.05

/** 小数 1 桁の符号つき表示。丸めて 0 になる値は符号なしの「0.0」にする */
function signed(value: number): string {
  const text = value.toFixed(1)
  const rounded = Number(text)
  if (rounded === 0) {
    return '0.0'
  }
  return `${rounded > 0 ? '+' : ''}${text}`
}

/**
 * 前期から今期への変化を、成長性の観点で文章にする。
 * 1 行目: 増収増益などのパターンと増減率 / 2 行目: 営業利益率の変化 / 3 行目: その内訳。
 * 前期の売上が 0 などで比べられないときは空配列。
 */
export function growthInsights(previous: PeriodData, current: PeriodData): readonly string[] {
  // 連結と単体の数字を比べると、増減が実際の成長と違って見えるので、比べない
  if (isBasisChange(previous, current)) {
    return [basisChangeNote(previous, current)]
  }
  const p = deriveStatements(previous)
  const c = deriveStatements(current)

  const salesGrowth = growthRate(previous.pl.sales, current.pl.sales)
  const operatingGrowth = growthRate(p.operatingProfit, c.operatingProfit)
  const pattern = classifyGrowthPattern(salesGrowth, operatingGrowth)
  if (pattern === null || salesGrowth === null || operatingGrowth === null) {
    return []
  }

  const lines = [
    `${current.label}は「${pattern}」です(売上高 ${signed(salesGrowth)}%、営業利益 ${signed(operatingGrowth)}%)。`,
  ]

  const before = commonSizePl(previous)
  const after = commonSizePl(current)
  if (
    before.operatingProfit === null ||
    after.operatingProfit === null ||
    before.grossProfit === null ||
    after.grossProfit === null ||
    before.sga === null ||
    after.sga === null
  ) {
    return lines
  }

  const operatingDiff = after.operatingProfit - before.operatingProfit
  const range = `${before.operatingProfit.toFixed(1)}% → ${after.operatingProfit.toFixed(1)}%`
  if (Math.abs(operatingDiff) < FLAT_THRESHOLD_PT) {
    lines.push(`営業利益率は ${range} で横ばいです。`)
  } else {
    const direction = operatingDiff > 0 ? '改善' : '悪化'
    lines.push(`営業利益率は ${range}(${signed(operatingDiff)}pt)と${direction}しました。`)
  }

  const grossDiff = after.grossProfit - before.grossProfit
  const sgaDiff = after.sga - before.sga
  lines.push(
    `内訳: 売上総利益率 ${signed(grossDiff)}pt、販管費率 ${signed(sgaDiff)}pt(販管費率が下がると営業利益率は上がります)。`,
  )
  return lines
}

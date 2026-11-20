import { basisLabel, hasMixedBasis, isBasisChange } from './basis'
import { reconcileCash, yearMonth, type CashBridge } from './cashReconciliation'
import { hasCashFlow, signOf, summarizeCashFlow, type CashFlowSummary, type Sign } from './cashFlow'
import { deriveStatements } from './statements'
import type { PeriodData } from './types'

/**
 * 概要ページに出す、キャッシュフローの要点。最新の期について、
 * 3 区分(営業・投資・財務)・お金の流れの型・営業キャッシュフローの続き方・利益との関係・現金の突き合わせをまとめる。
 */

/** 営業キャッシュフローの符号が、直近の期から何期続いているか(2 期以上のとき) */
export interface OperatingStreak {
  readonly sign: Exclude<Sign, 'zero'>
  readonly count: number
}

export interface CashFlowHighlights {
  readonly label: string
  /** 連結と単体が混ざる企業のとき、最新の期がどちらの数字かの説明。そうでなければ null */
  readonly basisNote: string | null
  readonly summary: CashFlowSummary
  readonly streak: OperatingStreak | null
  /** 営業キャッシュフロー ÷ 当期純利益。純利益がプラスで、営業キャッシュフローがあるときだけ */
  readonly cashConversion: number | null
  readonly bridge: CashBridge | null
}

/** 2 つの期が、1 年おきにつながっていないか(期の名前が読める 2 つで、1 年違いでなければ true。読めなければ false) */
function hasYearGap(previous: PeriodData, period: PeriodData): boolean {
  const before = yearMonth(previous.label)
  const now = yearMonth(period.label)
  return before !== null && now !== null && now.year - before.year !== 1
}

/**
 * 営業キャッシュフローの符号が続いている期の数。直近の期が 0・数字なしなら、続いていない。
 * 範囲(連結・単体)が切り替わる所と、期が抜けている所(1 年おきでない)で、数えるのをやめる。
 */
function operatingStreak(periods: readonly PeriodData[]): OperatingStreak | null {
  const latest = periods[periods.length - 1].pl.operatingCashFlow
  if (latest === undefined || latest === 0) return null
  const sign = signOf(latest) as Exclude<Sign, 'zero'>
  let count = 0
  for (let i = periods.length - 1; i >= 0; i -= 1) {
    const value = periods[i].pl.operatingCashFlow
    if (value === undefined || signOf(value) !== sign) break
    if (i < periods.length - 1 && (isBasisChange(periods[i], periods[i + 1]) || hasYearGap(periods[i], periods[i + 1]))) break
    count += 1
  }
  return count >= 2 ? { sign, count } : null
}

/**
 * 最新の期の、キャッシュフローの要点。最新の期にキャッシュフローの数字が 1 つも無ければ null
 * (古い保存データ。概要ページには出さない)。
 */
export function cashFlowHighlights(periods: readonly PeriodData[]): CashFlowHighlights | null {
  const latest = periods[periods.length - 1]
  if (latest === undefined || !hasCashFlow(latest)) return null
  const summary = summarizeCashFlow(latest)
  const netIncome = deriveStatements(latest).netIncome
  const mixed = hasMixedBasis(periods)
  return {
    label: latest.label,
    basisNote:
      mixed && latest.basis !== undefined
        ? `連結と単体が混ざる企業です。${latest.label}は、${basisLabel(latest.basis)}の数字です。`
        : null,
    summary,
    streak: operatingStreak(periods),
    cashConversion: summary.operating !== null && netIncome > 0 ? summary.operating / netIncome : null,
    bridge: reconcileCash(periods[periods.length - 2], latest),
  }
}

export function streakNote(streak: OperatingStreak): string {
  return streak.sign === 'plus'
    ? `営業キャッシュフローは、直近 ${streak.count} 期、続けてプラスです(本業で、現金を稼ぎ続けています)。`
    : `営業キャッシュフローは、直近 ${streak.count} 期、続けてマイナスです(本業で、現金が出ていき続けています。資金繰りが苦しくなります)。`
}

/** 営業キャッシュフロー ÷ 当期純利益が、これ以上なら、大きすぎて(純利益が小さいだけで)意味のある倍率ではないので、「以上」と書く */
const CONVERSION_CAP = 10

/** 営業キャッシュフロー ÷ 当期純利益が、これ未満なら、利益に比べて現金がかなり少ないので、注意を促す */
export const CONVERSION_CAUTION = 0.5

/**
 * 営業キャッシュフローが、当期純利益の何倍か。1 倍以上なら、利益が現金でも裏付けられている。
 * 判定は、画面に出す倍率(小数 1 桁)に合わせる(0.96 は「1.0 倍」と出るので、裏付けありと読む)。
 */
export function cashConversionNote(ratio: number): string {
  const shown = Math.round(ratio * 10) / 10
  const times =
    ratio >= CONVERSION_CAP
      ? `営業キャッシュフローは、当期純利益の ${CONVERSION_CAP} 倍以上です`
      : `営業キャッシュフローは、当期純利益の ${shown.toFixed(1)} 倍です`
  if (shown >= 1) return `${times}(利益が、現金でも裏付けられています)。`
  if (ratio >= 0) return `${times}(利益ほどには、現金が入っていません。売掛金や在庫の増加などで、現金が手元に残りにくい状態です)。`
  return '利益は出ていますが、営業キャッシュフローはマイナスです(利益が、現金になっていません)。'
}

/**
 * フリーキャッシュフロー(営業 + 投資)の読み方の一文。営業の符号で、読み方が変わる。
 * 営業がプラス: 稼ぎで投資をまかなえているか。営業が 0 以下: 稼ぎが無いので、投資の回収(資産の売却など)の有無で読む。
 * 営業・投資のどちらかが書類に無ければ null。
 */
export function freeCashFlowNote(summary: CashFlowSummary): string | null {
  const { operating, free } = summary
  if (operating === null || free === null) return null
  if (operating > 0) {
    if (free > 0) return '本業の稼ぎで、投資をまかなえています'
    return free < 0 ? '投資が、本業の稼ぎを上回っています' : '本業の稼ぎと、投資が、同じ額です'
  }
  return free < 0
    ? '本業で現金が出ていて、さらに投資にも使っています'
    : '本業で現金が出ていますが、資産の売却などで、投資の側が、プラスになっています'
}

/** 現金の突き合わせの結果の一文。突き合わせできなければ null */
export function bridgeNote(bridge: CashBridge | null): string | null {
  if (bridge === null) return null
  if (!bridge.matches) {
    return '現金の突き合わせに差があります(連結範囲の変更・合併・売却目的保有への振替などの可能性)。キャッシュフローのページで、内訳を確かめられます。'
  }
  return bridge.beginSource === 'derived'
    ? '書類の現金の増減額は、3 区分 + 為替の影響と合っています。'
    : '期首の現金から期末の現金への流れが、3 区分 + 為替の影響と合っています。'
}

import { CASH_FLOW_KEYS, type CashFlowKey, type PeriodData } from './types'

/**
 * キャッシュフロー計算書の読み方。
 * 計算書は、お金の出入りを 3 つに分ける(この順が正式な並び)。
 * 営業活動 → 投資活動 → 財務活動。プラスは「資金が入った」、マイナスは「資金が出た」。
 */

export interface CashFlowKindInfo {
  readonly key: CashFlowKey
  /** 計算書での名前 */
  readonly label: string
  /** 何のお金の出入りか */
  readonly what: string
  /** プラスのときの意味 */
  readonly plus: string
  /** マイナスのときの意味 */
  readonly minus: string
}

/** 3 つの区分。計算書の正式な順(営業 → 投資 → 財務) */
export const CASH_FLOW_KINDS: readonly CashFlowKindInfo[] = [
  {
    key: 'operatingCashFlow',
    label: '営業活動によるキャッシュフロー',
    what: '本業の稼ぎによる、お金の出入り',
    plus: '本業で、現金を稼いでいます。',
    minus: '本業で、現金が出ていっています(赤字や、売掛金・在庫の増加など)。',
  },
  {
    key: 'investingCashFlow',
    label: '投資活動によるキャッシュフロー',
    what: '設備・有価証券などへの投資による、お金の出入り',
    plus: '資産の売却や、投資の回収で、現金が入りました。',
    minus: '設備や有価証券などへの投資で、現金が出ました(将来のための支出)。',
  },
  {
    key: 'financingCashFlow',
    label: '財務活動によるキャッシュフロー',
    what: '借入・返済・配当などによる、お金の出入り',
    plus: '借入・社債・増資などで、資金を調達しました。',
    minus: '借入の返済・配当・自己株式の取得などで、資金を返しました。',
  },
]

export type Sign = 'plus' | 'minus' | 'zero'

export function signOf(value: number): Sign {
  if (value > 0) return 'plus'
  return value < 0 ? 'minus' : 'zero'
}

/** 1 つの区分の、符号つきの意味の文 */
export function cashFlowMeaning(key: CashFlowKey, value: number): string {
  const info = CASH_FLOW_KINDS.find((k) => k.key === key)
  if (info === undefined) return ''
  const sign = signOf(value)
  if (sign === 'zero') return '出入りはありませんでした。'
  return sign === 'plus' ? info.plus : info.minus
}

/** 3 区分の符号の組み合わせ(営業・投資・財務の順)から読み取れる、お金の流れの型 */
export interface CashFlowPattern {
  readonly title: string
  readonly meaning: string
  /** 注意が要る型か(営業がマイナス、または、全部がマイナス) */
  readonly caution: boolean
  /** 符号だけでは分からない、金額の大きさからの補足(例: 投資が本業の稼ぎを上回っている)。無ければ null */
  readonly note: string | null
}

type SignKey = '+' | '-'

const PATTERNS: Readonly<Record<`${SignKey}${SignKey}${SignKey}`, CashFlowPattern>> = {
  '+--': {
    title: '安定した型',
    meaning:
      '本業で稼いだお金で、投資をして、借入の返済や配当もしています。お金の流れとしては、健全な形です。',
    caution: false,
    note: null,
  },
  '+-+': {
    title: '積極的に投資している型',
    meaning:
      '本業で稼ぐお金に加えて、借入や増資でも資金を集め、積極的に投資しています。投資が、将来の利益につながっているかが見どころです。',
    caution: false,
    note: null,
  },
  '++-': {
    title: '投資を減らし、返済している型',
    meaning:
      '本業で稼ぐお金と、資産の売却などで入ったお金を、借入の返済や配当に回しています。事業を縮小している場合もあります。',
    caution: false,
    note: null,
  },
  '+++': {
    title: 'どの区分でも資金が入った型',
    meaning:
      'すべての区分で資金が入っています。手元の資金が大きく増えます。投資や返済など、使い道の方針を確かめたい形です。',
    caution: false,
    note: null,
  },
  '--+': {
    title: '借入に頼る型',
    meaning:
      '本業ではお金が出ていっていて、借入や増資で資金を集めて、投資をしています。創業期や、赤字が続く会社に見られ、資金繰りに注意が要ります。',
    caution: true,
    note: null,
  },
  '-+-': {
    title: '資産を売って、返済している型',
    meaning:
      '本業ではお金が出ていっていて、資産の売却で入ったお金を、借入の返済などに回しています。事業の立て直しの途中に見られます。',
    caution: true,
    note: null,
  },
  '-++': {
    title: '資産の売却と借入で、穴埋めしている型',
    meaning:
      '本業ではお金が出ていっていて、資産の売却と借入で、穴埋めしています。続くと、資金繰りが苦しくなります。',
    caution: true,
    note: null,
  },
  '---': {
    title: '手元の資金を取り崩している型',
    meaning:
      'すべての区分で資金が出ています。手元の資金を取り崩している状態です。余裕のある会社の一時的な動きなのか、確かめたい形です。',
    caution: true,
    note: null,
  },
}

/** 3 区分がそろっていて、どれも 0 でないときの、お金の流れの型。そろっていないときは null */
export function cashFlowPattern(
  operating: number | null,
  investing: number | null,
  financing: number | null,
): CashFlowPattern | null {
  if (operating === null || investing === null || financing === null) return null
  const signs = [operating, investing, financing].map(signOf)
  if (signs.includes('zero')) return null
  const key = signs.map((s) => (s === 'plus' ? '+' : '-')).join('') as `${SignKey}${SignKey}${SignKey}`
  const pattern = PATTERNS[key]
  // 営業がプラスで、投資がマイナスの型でも、投資が本業の稼ぎを上回っていれば、手元の資金や借入でまかなっている
  if (operating > 0 && investing < 0 && operating + investing < 0) {
    return {
      ...pattern,
      note: '符号は、よくある形ですが、金額は、投資が本業の稼ぎを上回っています(フリーキャッシュフローがマイナス)。投資を、手元の資金や借入でまかなっているので、金額の大きさも確かめてください。',
    }
  }
  return pattern
}

/** 1 期分の、3 区分と、そこから分かること */
export interface CashFlowSummary {
  readonly label: string
  readonly operating: number | null
  readonly investing: number | null
  readonly financing: number | null
  /**
   * フリーキャッシュフロー = 営業 + 投資。本業で稼いだお金から、投資に使った分を引いた、自由に使えるお金。
   * (教科書の定義には幅がある。ここでは、営業と投資の合計とする)
   */
  readonly free: number | null
  /** 3 区分の合計(現金の増減。為替の影響などは含まない) */
  readonly net: number | null
  /** 為替の影響(現金及び現金同等物に係る換算差額)。書類に無ければ null */
  readonly fx: number | null
  /** 現金及び現金同等物の期末残高。書類に無ければ null */
  readonly cashEnd: number | null
  readonly pattern: CashFlowPattern | null
}

/** 1 期分のまとめから、区分ごとの数字を取り出す(区分の名前から取り出す。無ければ null) */
export function cashFlowValue(summary: CashFlowSummary, key: CashFlowKey): number | null {
  switch (key) {
    case 'operatingCashFlow':
      return summary.operating
    case 'investingCashFlow':
      return summary.investing
    case 'financingCashFlow':
      return summary.financing
  }
}

function sum(values: readonly (number | null)[]): number | null {
  return values.some((v) => v === null) ? null : values.reduce<number>((total, v) => total + (v ?? 0), 0)
}

export function summarizeCashFlow(period: PeriodData): CashFlowSummary {
  const [operating, investing, financing] = CASH_FLOW_KEYS.map((key) => period.pl[key] ?? null)
  return {
    label: period.label,
    operating,
    investing,
    financing,
    free: sum([operating, investing]),
    net: sum([operating, investing, financing]),
    fx: period.pl.fxEffect ?? null,
    cashEnd: period.pl.cashEnd ?? null,
    pattern: cashFlowPattern(operating, investing, financing),
  }
}

/** キャッシュフローの数字が 1 つでもある期か(古い保存データには無い) */
export function hasCashFlow(period: PeriodData): boolean {
  return CASH_FLOW_KEYS.some((key) => period.pl[key] !== undefined)
}

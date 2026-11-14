import { MAX_ABS_AMOUNT, MAX_PERIODS, MAX_TEXT_LENGTH } from './limits'
import type { BalanceSheetInput, Company, IncomeStatementInput, PeriodData } from './types'
import { UNIT_DIVISOR } from './units'

/** 取り込んでおける企業の数の上限 */
export const MAX_COMPANIES = 30

const NAME_ID_PREFIX = 'name-'
const EDINET_ID_PREFIX = 'edinet-'

/**
 * 企業の識別。EDINET コードがあればそれを使い、無ければ会社名を使う。
 * 同じ識別の企業は、あとから読み込んだファイルの期が積み上がる。
 */
export function companyIdFor(edinetCode: string | null, name: string): string {
  if (edinetCode !== null) {
    return `${EDINET_ID_PREFIX}${edinetCode}`
  }
  const room = MAX_TEXT_LENGTH - NAME_ID_PREFIX.length
  return `${NAME_ID_PREFIX}${Array.from(name).slice(0, room).join('')}`
}

const PERIOD_LABEL = /^(\d{4})年(\d{1,2})月期$/

/** 「2025年3月期」を並べ替え用の数にする。読めない名前は null */
function periodOrder(label: string): number | null {
  const m = PERIOD_LABEL.exec(label)
  return m === null ? null : Number(m[1]) * 100 + Number(m[2])
}

/** 古い期から新しい期の順に並べる。年月の読めない期は、読める期のあとに、もとの順で並ぶ */
function sortPeriods(periods: readonly PeriodData[]): PeriodData[] {
  return periods
    .map((period, index) => ({ period, index, order: periodOrder(period.label) }))
    .sort((a, b) => {
      if (a.order !== null && b.order !== null) return a.order - b.order
      if (a.order !== null) return -1
      if (b.order !== null) return 1
      return a.index - b.index
    })
    .map((x) => x.period)
}

function scaleRecord<T extends object>(record: T, factor: (value: number) => number): T {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(record)) {
    out[key] = factor(value as number)
  }
  return out as T
}

function scalePeriod(period: PeriodData, from: number, to: number): PeriodData {
  // 先に掛けてから割る(0.001 のような割り切れない数を掛けて誤差を出さない)
  const convert = (value: number): number => (value * from) / to
  return {
    label: period.label,
    bs: scaleRecord<BalanceSheetInput>(period.bs, convert),
    pl: scaleRecord<IncomeStatementInput>(period.pl, convert),
  }
}

/** どの金額も、保存できる上限(MAX_ABS_AMOUNT)以内か */
function withinAmountLimit(periods: readonly PeriodData[]): boolean {
  return periods.every((p) =>
    [...Object.values(p.bs), ...Object.values(p.pl)].every((v) => Math.abs(v) <= MAX_ABS_AMOUNT),
  )
}

/**
 * 同じ企業の、あとから読み込んだデータ(incoming)を、すでにあるデータ(existing)に積み上げる。
 * - 同じ期は、あとから読み込んだ値(遡及修正後)で置き換える
 * - 金額の単位が違えば、あとから読み込んだ側の単位にそろえる
 * - 単位が不明な古いデータは、混ぜると金額がずれるので、あとから読み込んだものだけにする
 * - 期の数が上限を超えたら、古い期から落とす
 * - 単位をそろえた結果、金額が保存できる上限を超えるときは、混ぜずに、あとから読み込んだものだけにする
 *   (混ぜて保存すると、次に開いたときに「壊れたデータ」として、一覧全体が読めなくなる)
 */
export function mergeCompany(existing: Company, incoming: Company): Company {
  const base: Company = {
    id: existing.id,
    name: incoming.name,
    ...(incoming.unit === undefined ? {} : { unit: incoming.unit }),
    ...((incoming.edinetCode ?? existing.edinetCode) === undefined
      ? {}
      : { edinetCode: incoming.edinetCode ?? existing.edinetCode }),
    periods: incoming.periods,
  }
  if (existing.unit === undefined || incoming.unit === undefined) {
    return base
  }
  const from = UNIT_DIVISOR[existing.unit]
  const to = UNIT_DIVISOR[incoming.unit]
  const existingPeriods = from === to ? existing.periods : existing.periods.map((p) => scalePeriod(p, from, to))

  const byLabel = new Map<string, PeriodData>()
  for (const p of existingPeriods) byLabel.set(p.label, p)
  for (const p of incoming.periods) byLabel.set(p.label, p)
  const merged = sortPeriods([...byLabel.values()]).slice(-MAX_PERIODS)
  return withinAmountLimit(merged) ? { ...base, periods: merged } : base
}

/**
 * 企業の一覧に、読み込んだ企業を足す。同じ識別の企業があれば期を積み上げて、元の位置で更新する。
 * 新しい企業で、一覧がすでに上限なら null(足せない)。
 */
export function upsertCompany(companies: readonly Company[], incoming: Company): readonly Company[] | null {
  const index = companies.findIndex((c) => c.id === incoming.id)
  if (index >= 0) {
    return companies.map((c, i) => (i === index ? mergeCompany(c, incoming) : c))
  }
  if (companies.length >= MAX_COMPANIES) {
    return null
  }
  return [...companies, incoming]
}

export function removeCompany(companies: readonly Company[], id: string): readonly Company[] {
  return companies.filter((c) => c.id !== id)
}

import { BS_FIELDS, PL_FIELDS } from './fields'
import { MAX_ABS_AMOUNT, MAX_PERIODS, MAX_TEXT_LENGTH } from './limits'
import { MAX_COMPANIES } from './portfolio'
import type {
  AmountUnit,
  BalanceSheetInput,
  Company,
  IncomeStatementInput,
  PeriodData,
} from './types'

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 有限で、絶対値が上限以内の数(巨大な値は計算が桁あふれするので受け付けない) */
function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_ABS_AMOUNT
}

/** EDINET コード: E + 数字 5 桁 */
const EDINET_CODE_PATTERN = /^E\d{5}$/

const AMOUNT_UNITS: readonly AmountUnit[] = ['円', '千円', '百万円']

function isAmountUnit(value: unknown): value is AmountUnit {
  return typeof value === 'string' && (AMOUNT_UNITS as readonly string[]).includes(value)
}

function isShortText(value: unknown): value is string {
  // 文字数は、表示や切り詰め(cleanText など)と同じく、コードポイントで数える(𠮷 のような文字を 2 文字に数えない)
  return typeof value === 'string' && Array.from(value).length <= MAX_TEXT_LENGTH
}

/** 必須項目がすべて有限の数なら、その項目だけを取り出した新しいオブジェクトを返す */
function pickNumbers(
  source: Json,
  fields: readonly { key: string; optional?: boolean }[],
): Record<string, number> | null {
  const result: Record<string, number> = {}
  for (const { key, optional } of fields) {
    const value = source[key]
    if (value === undefined && optional) {
      continue
    }
    if (!isAmount(value)) {
      return null
    }
    result[key] = value
  }
  return result
}

function parsePeriod(raw: unknown): PeriodData | null {
  if (!isObject(raw) || !isShortText(raw.label) || !isObject(raw.bs) || !isObject(raw.pl)) {
    return null
  }
  const bs = pickNumbers(raw.bs, BS_FIELDS)
  const pl = pickNumbers(raw.pl, PL_FIELDS)
  if (bs === null || pl === null) {
    return null
  }
  // 範囲は任意。あるなら、決まった 2 つの値のどちらかでなければならない(それ以外は、壊れたデータ)
  if (raw.basis !== undefined && raw.basis !== 'consolidated' && raw.basis !== 'individual') {
    return null
  }
  return {
    label: raw.label,
    ...(raw.basis === undefined ? {} : { basis: raw.basis }),
    bs: bs as unknown as BalanceSheetInput,
    pl: pl as unknown as IncomeStatementInput,
  }
}

/**
 * 外部(localStorage・インポートファイル)から読んだ値を検証して Company にする。
 * 形が正しくなければ null。信頼できない入力なので、型は 1 項目ずつ確かめる。
 */
export function parseCompany(raw: unknown): Company | null {
  if (!isObject(raw) || !isShortText(raw.id) || raw.id === '' || !isShortText(raw.name)) {
    return null
  }
  // 期が 1 つも無い、または多すぎるデータは画面が成り立たない・重くなるので受け付けない
  if (
    !Array.isArray(raw.periods) ||
    raw.periods.length === 0 ||
    raw.periods.length > MAX_PERIODS
  ) {
    return null
  }
  const periods: PeriodData[] = []
  for (const item of raw.periods) {
    const period = parsePeriod(item)
    if (period === null) {
      return null
    }
    periods.push(period)
  }
  return withOptionalFields({ id: raw.id, name: raw.name, periods }, raw)
}

/** 任意の項目(単位・EDINET コード)。付いているなら正しい値でなければならない。正しくなければ null */
function withOptionalFields(base: Company, raw: Json): Company | null {
  let company = base
  if (raw.unit !== undefined) {
    if (!isAmountUnit(raw.unit)) return null
    company = { ...company, unit: raw.unit }
  }
  if (raw.edinetCode !== undefined) {
    if (typeof raw.edinetCode !== 'string' || !EDINET_CODE_PATTERN.test(raw.edinetCode)) return null
    company = { ...company, edinetCode: raw.edinetCode }
  }
  return company
}

/** 保存する企業の一覧の形式の版 */
export const PORTFOLIO_VERSION = 2

/**
 * 外から読んだ値(localStorage)を、企業の一覧にする。形が正しくなければ null。
 * 企業の数が上限を超える、id が重なる、1 社でも読めないものがある、といった場合も null。
 */
export function parsePortfolio(raw: unknown): Company[] | null {
  if (!isObject(raw) || raw.version !== PORTFOLIO_VERSION || !Array.isArray(raw.companies)) {
    return null
  }
  if (raw.companies.length > MAX_COMPANIES) {
    return null
  }
  const companies: Company[] = []
  const ids = new Set<string>()
  for (const item of raw.companies) {
    const company = parseCompany(item)
    if (company === null || ids.has(company.id)) {
      return null
    }
    ids.add(company.id)
    companies.push(company)
  }
  return companies
}

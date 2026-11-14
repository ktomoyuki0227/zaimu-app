import { MAX_TEXT_LENGTH } from '../limits'
import { cleanText } from './text'
import { parseTsv } from './tsv'
import type { DocumentInfo, EdinetParseResult, SourceFact } from './types'

const COLUMN = {
  element: '要素ID',
  label: '項目名',
  context: 'コンテキストID',
  unit: '単位',
  value: '値',
} as const

/** 連結(または単体)の事実と、個別の事実のコンテキスト。セグメント等の次元付きは対象外 */
const CONTEXT_PATTERN = /^(CurrentYear|Prior1Year)(Instant|Duration)(_NonConsolidatedMember)?$/

/**
 * 金額(円)の単位の表記。実際の EDINET の CSV では「単位」列の値は「円」(ユニット ID は JPY)。
 * 株数・倍率などの単位や、文章の行(「－」)は、金額として扱わない。
 */
const MONETARY_UNITS: ReadonlySet<string> = new Set(['', '円', 'JPY'])

/**
 * 金額(円)として受け付ける書式。EDINET の金額は整数なので、整数だけを受け付ける。
 * カンマ・指数・16進・小数・「－」などと、17 桁以上(2^53 を超えて円の足し引きが不正確になる)は受け付けない。
 */
const AMOUNT_PATTERN = /^-?\d{1,16}$/

const DEI_KEYS = {
  accountingStandard: 'jpdei_cor:AccountingStandardsDEI',
  periodType: 'jpdei_cor:TypeOfCurrentPeriodDEI',
  currentEnd: 'jpdei_cor:CurrentFiscalYearEndDateDEI',
  currentEndAlt: 'jpdei_cor:CurrentPeriodEndDateDEI',
  priorEnd: 'jpdei_cor:PreviousFiscalYearEndDateDEI',
  companyName: 'jpcrp_cor:CompanyNameCoverPage',
  edinetCode: 'jpdei_cor:EDINETCodeDEI',
} as const

/** EDINET コード: E + 数字 5 桁 */
const EDINET_CODE_PATTERN = /^E\d{5}$/

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 実在する日付(YYYY-MM-DD)なら true。13 月や 2 月 30 日は false */
function isRealDate(date: string): boolean {
  const m = DATE_PATTERN.exec(date)
  if (m === null) {
    return false
  }
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

/** 日付(YYYY-MM-DD)の 1 年前。うるう日は前の月末に寄せる */
function oneYearBefore(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const target = new Date(Date.UTC(year - 1, month - 1, day))
  if (target.getUTCMonth() !== month - 1) {
    // 2/29 → 前年に無いので 2/28
    target.setUTCDate(0)
  }
  return target.toISOString().slice(0, 10)
}

function validDate(value: string | undefined): string | null {
  return value !== undefined && isRealDate(value) ? value : null
}

function edinetCode(value: string | undefined): string | null {
  const code = value?.trim()
  return code !== undefined && EDINET_CODE_PATTERN.test(code) ? code : null
}

function shortText(value: string | undefined): string | null {
  return cleanText(value, MAX_TEXT_LENGTH)
}

function buildInfo(dei: ReadonlyMap<string, string>): DocumentInfo {
  const currentEnd = validDate(dei.get(DEI_KEYS.currentEnd)) ?? validDate(dei.get(DEI_KEYS.currentEndAlt))
  const declaredPrior = validDate(dei.get(DEI_KEYS.priorEnd))
  // 前期の決算日は、当期より前でなければならない。そうでなければ、当期の 1 年前とする
  const priorEnd =
    declaredPrior !== null && currentEnd !== null && declaredPrior < currentEnd
      ? declaredPrior
      : currentEnd === null
        ? null
        : oneYearBefore(currentEnd)
  return {
    companyName: shortText(dei.get(DEI_KEYS.companyName)),
    edinetCode: edinetCode(dei.get(DEI_KEYS.edinetCode)),
    accountingStandard: shortText(dei.get(DEI_KEYS.accountingStandard)),
    periodType: shortText(dei.get(DEI_KEYS.periodType)),
    currentEndDate: currentEnd,
    priorEndDate: priorEnd,
  }
}

/**
 * EDINET の CSV(XBRL → CSV 変換)の文字列を、金額の事実と表紙情報に分ける。
 * 見出しが想定と違うときは、読み違えないよう拒否する。
 */
export function parseEdinetCsv(text: string, maxRows: number): EdinetParseResult {
  const rows = parseTsv(text, maxRows)
  if (rows === null) {
    return {
      ok: false,
      reason: 'CSV を読み取れませんでした(行や欄が多すぎる、または引用符が閉じていません)。',
    }
  }
  if (rows.length === 0) {
    return { ok: false, reason: 'CSV が空です。' }
  }
  const header = rows[0]
  const col = (name: string): number => header.indexOf(name)
  const iElement = col(COLUMN.element)
  const iContext = col(COLUMN.context)
  const iValue = col(COLUMN.value)
  if (iElement < 0 || iContext < 0 || iValue < 0) {
    return {
      ok: false,
      reason: 'EDINET の CSV の形式ではありません(「要素ID」「コンテキストID」「値」の列が見つかりません)。',
    }
  }
  const iLabel = col(COLUMN.label)
  const iUnit = col(COLUMN.unit)

  const facts: SourceFact[] = []
  // 要素名をオブジェクトのキーにしない(__proto__ 等への書き込みを避ける)
  const dei = new Map<string, string>()

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r]
    const elementId = row[iElement]
    const contextId = row[iContext]
    const rawValue = row[iValue]
    if (elementId === undefined || contextId === undefined || rawValue === undefined) {
      continue
    }

    if (elementId.startsWith('jpdei_cor:') || elementId === DEI_KEYS.companyName) {
      if (!dei.has(elementId)) {
        dei.set(elementId, rawValue)
      }
      continue
    }

    const context = CONTEXT_PATTERN.exec(contextId)
    if (context === null || !AMOUNT_PATTERN.test(rawValue) || !Number.isSafeInteger(Number(rawValue))) {
      continue
    }
    const unit = iUnit >= 0 ? row[iUnit] : undefined
    if (unit !== undefined && !MONETARY_UNITS.has(unit)) {
      continue
    }
    facts.push({
      elementId,
      label: shortText(iLabel >= 0 ? row[iLabel] : undefined) ?? elementId,
      year: context[1] === 'CurrentYear' ? 'current' : 'prior',
      kind: context[2] === 'Instant' ? 'instant' : 'duration',
      scope: context[3] === undefined ? 'primary' : 'individual',
      // -0 は 0 にそろえる
      value: Number(rawValue) || 0,
    })
  }
  return { ok: true, facts, info: buildInfo(dei) }
}

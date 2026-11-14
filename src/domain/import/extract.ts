import { IFRS_ANY_PREFIX_NAMES, readIfrsPeriod } from './ifrsReader'
import { readPeriod, type Entries, type Entry, type PeriodReading } from './periodReader'
import { isUnsureField } from './review'
import type {
  DocumentInfo,
  ExtractedPeriod,
  ExtractionResult,
  FieldExtraction,
  SourceFact,
} from './types'

/** 書類から会社名を読めなかったときの仮の名前 */
export const UNNAMED_COMPANY_NAME = '取り込んだ会社'

const JPPFS_PREFIX = 'jppfs_cor:'
const JPIGP_PREFIX = 'jpigp_cor:'

type Scope = 'primary' | 'individual'

/** 会計基準ごとの読み方: どの要素を使うか・資産合計の科目名・1 期分の読み取り */
interface Profile {
  /** 使う要素なら、接頭辞なしの要素名。使わない要素なら null */
  readonly nameOf: (elementId: string) => string | null
  readonly assetsName: string
  readonly read: (entries: Entries, endDate: string, label: string) => PeriodReading
}

const JGAAP: Profile = {
  nameOf: (id) => (id.startsWith(JPPFS_PREFIX) ? id.slice(JPPFS_PREFIX.length) : null),
  assetsName: 'Assets',
  read: readPeriod,
}

const IFRS_ANY_PREFIX = new Set<string>(IFRS_ANY_PREFIX_NAMES)

/**
 * IFRS は jpigp_cor の科目を使う。売上や売上債権は、会社独自の拡張科目(接頭辞が会社ごと)や
 * 主要な経営指標(jpcrp_cor)にだけ載ることがあるので、決めた科目名に限り、どの接頭辞でも拾う。
 */
const IFRS: Profile = {
  nameOf: (id) => {
    if (id.startsWith(JPIGP_PREFIX)) {
      return id.slice(JPIGP_PREFIX.length)
    }
    const name = id.slice(id.indexOf(':') + 1)
    return IFRS_ANY_PREFIX.has(name) ? name : null
  },
  assetsName: 'AssetsIFRS',
  read: readIfrsPeriod,
}

function failure(companyName: string, errors: readonly string[]): ExtractionResult {
  return {
    companyName,
    edinetCode: null,
    consolidation: 'consolidated',
    periods: [],
    warnings: [],
    notes: [],
    errors,
    needsReview: true,
  }
}

/** 決算日(YYYY-MM-DD)から「2025年3月期」のような期の名前を作る */
function periodLabel(endDate: string): string {
  const [year, month] = endDate.split('-')
  return `${Number(year)}年${Number(month)}月期`
}

interface Collected {
  readonly entries: Entries
  /** 同じ科目に異なる値が複数あった項目名 */
  readonly conflicts: readonly string[]
}

/** 指定した年・範囲の事実を、要素名(接頭辞なし)で引ける形にまとめる */
function collect(facts: readonly SourceFact[], year: 'current' | 'prior', scope: Scope, profile: Profile): Collected {
  const entries = new Map<string, Entry>()
  const conflicts: string[] = []
  for (const f of facts) {
    if (f.year !== year || f.scope !== scope) {
      continue
    }
    const name = profile.nameOf(f.elementId)
    if (name === null) {
      continue
    }
    const existing = entries.get(name)
    if (existing === undefined) {
      entries.set(name, { value: f.value, label: f.label })
    } else if (existing.value !== f.value) {
      conflicts.push(f.label)
    }
  }
  return { entries, conflicts }
}

/** 同じ科目に異なる値が複数あったとき。最初の値を使うので、利用者に確認してもらう */
function conflictWarning(label: string, names: readonly string[]): string {
  return `${label}: 同じ科目に異なる値が複数あります(最初の値を使っています): ${names.slice(0, 3).join('、')}`
}

/**
 * 書類の会計基準に合う読み方を選ぶ。対応していない書類(米国基準・通期以外)なら、その理由を返す。
 * 会計基準は表紙情報(DEI)に従い、無いときだけ IFRS の科目(jpigp_cor)の有無で決める。
 */
function chooseProfile(info: DocumentInfo, facts: readonly SourceFact[]): Profile | string {
  const standard = info.accountingStandard
  if (info.periodType !== null && info.periodType !== 'FY') {
    return `通期(有価証券報告書など 1 年分)の書類だけに対応しています(この書類の期間の種類: ${info.periodType})。`
  }
  if (standard === null) {
    return facts.some((f) => f.elementId.startsWith(JPIGP_PREFIX)) ? IFRS : JGAAP
  }
  if (/ifrs/i.test(standard)) {
    return IFRS
  }
  if (/japan/i.test(standard)) {
    return JGAAP
  }
  return `会計基準「${standard}」の書類は、まだ対応していません(日本基準・IFRS の書類に対応しています)。`
}

function needsReview(periods: readonly ExtractedPeriod[], warnings: readonly string[]): boolean {
  const unsure = (f: FieldExtraction | null): boolean => f !== null && isUnsureField(f)
  return (
    warnings.length > 0 ||
    periods.some(
      (p) =>
        Object.values(p.bs).some(unsure) || Object.values(p.pl).some(unsure) || unsure(p.operatingCashFlow),
    )
  )
}

interface PriorReading {
  readonly period: ExtractedPeriod | null
  readonly warnings: readonly string[]
}

/** 前期を読む。前期が無い・読めないときは、当期だけを取り込み、その理由を確認事項として返す */
function readPrior(
  facts: readonly SourceFact[],
  scope: Scope,
  priorEndDate: string | null,
  profile: Profile,
): PriorReading {
  if (priorEndDate === null) {
    return { period: null, warnings: ['前期の決算日を読み取れなかったため、当期だけを取り込みます。'] }
  }
  const label = periodLabel(priorEndDate)
  const prior = collect(facts, 'prior', scope, profile)
  if (!prior.entries.has(profile.assetsName)) {
    return { period: null, warnings: [`前期(${label})のデータが書類にありません。当期だけを取り込みます。`] }
  }
  const warnings = prior.conflicts.length > 0 ? [conflictWarning(label, prior.conflicts)] : []
  const reading = profile.read(prior.entries, priorEndDate, label)
  if (reading.period === null) {
    return {
      period: null,
      warnings: [...warnings, `前期(${label})は読み取れなかったため除きました: ${reading.errors.join(' ')}`],
    }
  }
  return { period: reading.period, warnings: [...warnings, ...reading.warnings] }
}

/** 連結(または単体)があれば連結を使い、無ければ個別を使う。どちらにも資産合計が無ければ null */
function chooseScope(facts: readonly SourceFact[], profile: Profile): Scope | null {
  const hasAssets = (scope: Scope): boolean =>
    facts.some((f) => f.scope === scope && profile.nameOf(f.elementId) === profile.assetsName)
  if (hasAssets('primary')) return 'primary'
  if (hasAssets('individual')) return 'individual'
  return null
}

/**
 * 読み取った事実と表紙情報から、各期の 22 項目と、突き合わせの結果を作る。
 * 取れなかった項目・差額で求めた項目・突き合わせで合わなかった点は、黙って埋めずに結果へ残す。
 * 反映してはいけない問題は errors に入れ、periods は空にする。
 */
export function extractFromFacts(facts: readonly SourceFact[], info: DocumentInfo): ExtractionResult {
  const companyName = info.companyName ?? UNNAMED_COMPANY_NAME

  const profile = chooseProfile(info, facts)
  if (typeof profile === 'string') {
    return failure(companyName, [profile])
  }
  if (info.currentEndDate === null) {
    return failure(companyName, ['書類から決算日を読み取れませんでした。'])
  }
  const scope = chooseScope(facts, profile)
  if (scope === null) {
    return failure(companyName, ['貸借対照表(資産合計)が書類に見つかりませんでした。'])
  }

  const currentLabel = periodLabel(info.currentEndDate)
  const current = collect(facts, 'current', scope, profile)
  const currentReading = profile.read(current.entries, info.currentEndDate, currentLabel)
  if (currentReading.period === null) {
    return failure(companyName, currentReading.errors)
  }
  const prior = readPrior(facts, scope, info.priorEndDate, profile)

  const periods = prior.period === null ? [currentReading.period] : [prior.period, currentReading.period]
  const warnings = [
    ...(current.conflicts.length > 0 ? [conflictWarning(currentLabel, current.conflicts)] : []),
    ...currentReading.warnings,
    ...prior.warnings,
  ]
  return {
    companyName,
    edinetCode: info.edinetCode,
    consolidation: scope === 'primary' ? 'consolidated' : 'individual',
    periods,
    warnings,
    notes: currentReading.notes,
    errors: [],
    needsReview: needsReview(periods, warnings),
  }
}

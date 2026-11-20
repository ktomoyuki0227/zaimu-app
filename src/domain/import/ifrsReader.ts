import {
  NOT_APPLICABLE,
  TOLERANCE_UNITS,
  assembleBalanceSheet,
  createReader,
  derived,
  found,
  missing,
  readBsTotals,
  readCashFlows,
  roundingUnit,
  total,
  type Entries,
  type Issues,
  type PeriodReading,
  type Reader,
} from './periodReader'
import type { FieldExtraction } from './types'

/**
 * IFRS の連結財務諸表(jpigp_cor)を、日本基準と同じ 22 項目にそろえて読む。
 *
 * IFRS には経常利益・特別損益の区分が無いので、営業利益と税引前利益の間は、次のようにそろえる。
 * - 営業外収益 = 金融収益(足りない分は差引で補う)
 * - 支払利息 = 金融費用
 * - 特別損益 = 0
 * 「その他」は、書類の合計との差額で出す(日本基準の読み取りと同じ考え方)。
 */

/** 売上(売上収益・営業収益)の候補。標準科目のほか、会社独自の拡張科目や主要な経営指標の科目にも載る */
const IFRS_SALES_NAMES = [
  'RevenueIFRS',
  'NetSalesIFRS',
  'SalesRevenuesIFRS',
  'OperatingRevenuesIFRS',
  'TotalNetRevenuesIFRS',
  'RevenueIFRSSummaryOfBusinessResults',
  'OperatingRevenuesIFRSKeyFinancialData',
  'RevenueIFRSKeyFinancialData',
] as const

/** 売上債権の候補。会社独自の拡張科目(接頭辞が会社ごと)で載る書類もある */
const RECEIVABLES_NAMES = ['TradeAndOtherReceivablesCAIFRS', 'TradeReceivablesAndContractAssetsCAIFRSIFRS'] as const
const PAYABLES_NAMES = ['TradeAndOtherPayablesCLIFRS', 'TradePayables3CLIFRS'] as const

/** jpigp_cor 以外の接頭辞(拡張科目・主要な経営指標)でも拾う科目名 */
export const IFRS_ANY_PREFIX_NAMES: readonly string[] = [...IFRS_SALES_NAMES, 'TradeReceivablesAndContractAssetsCAIFRSIFRS']

const BS_NAMES = {
  assets: ['AssetsIFRS'],
  currentAssets: ['CurrentAssetsIFRS'],
  liabilities: ['LiabilitiesIFRS'],
  currentLiabilities: ['TotalCurrentLiabilitiesIFRS', 'CurrentLiabilitiesIFRS'],
  equity: ['EquityIFRS'],
} as const

const SHORT_TERM_DEBT_COMBINED = ['InterestBearingLiabilitiesCLIFRS', 'BondsAndBorrowingsCLIFRS'] as const
const SHORT_TERM_DEBT_PARTS = ['BorrowingsCLIFRS', 'BondsPayableCLIFRS', 'CommercialPapersCLIFRS'] as const
const LONG_TERM_DEBT_COMBINED = [
  'InterestBearingLiabilitiesNCLIFRS',
  'BondsAndBorrowingsNCLIFRS',
  'LongTermDebtNCLIFRS',
] as const
const LONG_TERM_DEBT_PARTS = ['BorrowingsNCLIFRS', 'BondsPayableNCLIFRS'] as const

/** 差で合わせた営業外の項目が、税引前利益のこの割合を超えたら、確認が必要な値にする */
const PLUG_SHARE = 0.25

const NOTE_DEBT =
  'IFRS: 有利子負債は、書類の「有利子負債」(または借入金・社債)の区分のとおりです。リース負債を含めるかは、会社の区分によって違います。'
const NOTE_OPERATING_PROFIT =
  'IFRS: 販売費及び一般管理費は、営業利益に合わせて「売上総利益 − 営業利益」で集計しています(その他の営業収益・費用、研究開発費などを含みます)。'
const NOTE_NO_OPERATING_PROFIT =
  'IFRS: 書類に営業利益の表示が無いため、売上総利益 − 販売費及び一般管理費を営業利益としています(その他の収益・費用は営業外に含めます)。'
const NOTE_NON_OPERATING =
  'IFRS: 営業外収益・支払利息は、金融収益・金融費用を使い、残りは「税引前利益 − 営業利益」との差で調整しています(特別損益の区分はありません)。'

/** 合計があればそれ、無ければ内訳の合計(借入金・社債など) */
function debt(r: Reader, combined: readonly string[], parts: readonly string[]): FieldExtraction {
  return r.first(combined) ?? r.sumOf(parts) ?? NOT_APPLICABLE
}

function readIfrsBalanceSheet(r: Reader, tolerance: number, label: string, issues: Issues) {
  const totals = readBsTotals(r, BS_NAMES, issues)
  if (totals === null) {
    return null
  }
  return assembleBalanceSheet(
    totals,
    {
      cash: r.first(['CashAndCashEquivalentsIFRS']) ?? missing('現金及び現金同等物が見つかりません。0 として仮置きしています。'),
      receivables:
        r.first(RECEIVABLES_NAMES) ?? missing('売上債権の科目が見つかりません。0 として仮置きしています。'),
      // その他の金融資産(流動)は性質が幅広いので、有価証券には入れず「その他」に含める
      securities: NOT_APPLICABLE,
      inventory: r.first(['InventoriesCAIFRS']) ?? NOT_APPLICABLE,
      payables: r.first(PAYABLES_NAMES) ?? missing('仕入債務の科目が見つかりません。0 として仮置きしています。'),
      shortTermDebt: debt(r, SHORT_TERM_DEBT_COMBINED, SHORT_TERM_DEBT_PARTS),
      longTermDebt: debt(r, LONG_TERM_DEBT_COMBINED, LONG_TERM_DEBT_PARTS),
    },
    tolerance,
    label,
    issues,
  )
}

const SGA_MISSING = '販売費及び一般管理費が見つかりません。0 として仮置きしています。'

/**
 * 営業利益から逆算する販管費。営業利益が売上総利益を超える(その他の営業収益が大きい)書類は正当にありうるので、
 * そのときは書類の販管費をそのまま使い、営業利益との差は営業外に入れて、確認事項として知らせる。
 */
function readSga(r: Reader, gross: number, label: string, issues: Issues): FieldExtraction {
  const operatingProfit = r.get('OperatingProfitLossIFRS')
  if (operatingProfit === undefined) {
    issues.notes.push(NOTE_NO_OPERATING_PROFIT)
    return r.first(['SellingGeneralAndAdministrativeExpensesIFRS']) ?? missing(SGA_MISSING)
  }
  const value = gross - operatingProfit.value
  if (value < 0) {
    issues.warnings.push(
      `${label}: 書類の営業利益(${operatingProfit.value} 円)が売上総利益(${gross} 円)を超えています(その他の営業収益が大きい場合など)。販売費及び一般管理費は書類の値を使い、差は営業外に含めています。`,
    )
    return r.first(['SellingGeneralAndAdministrativeExpensesIFRS']) ?? missing(SGA_MISSING)
  }
  const reported = r.get('SellingGeneralAndAdministrativeExpensesIFRS')
  if (reported === undefined || reported.value !== value) {
    issues.notes.push(NOTE_OPERATING_PROFIT)
  }
  return derived(value, ['売上総利益 − 営業利益'])
}

interface NonOperating {
  readonly income: FieldExtraction
  readonly interest: FieldExtraction
  readonly other: FieldExtraction
}

/** 支払利息。金融費用の合計(為替差損・デリバティブ損なども含みうる)で代用したときは、確認が必要な値にする */
function readInterest(r: Reader, debtYen: number): FieldExtraction {
  const interest = r.first(['InterestExpensesIFRS', 'InterestExpenseFinanceCostsIFRS'])
  if (interest !== null) {
    return interest
  }
  const financeCosts = r.get('FinanceCostsIFRS')
  if (financeCosts !== undefined) {
    return found([financeCosts], 'medium')
  }
  return debtYen > 0 ? missing('有利子負債があるのに、金融費用が見つかりません。0 として仮置きしています。') : NOT_APPLICABLE
}

/** 営業利益と税引前利益の差を、営業外収益・支払利息・その他に振り分ける(足し引きが必ず合う) */
function readNonOperating(
  r: Reader,
  known: { readonly operating: number; readonly preTax: number; readonly debtYen: number; readonly tolerance: number },
): NonOperating {
  const { operating, preTax, debtYen, tolerance } = known
  const financeIncome = r.first(['FinanceIncomeIFRS']) ?? NOT_APPLICABLE
  const interest = readInterest(r, debtYen)
  const net = preTax - operating
  const residualExpense = financeIncome.value - interest.value - net
  // 差で合わせた値が税引前利益に比べて大きいときは、持分法損益・為替・減損などが混ざっているので、確認が必要な値にする
  const plugConfidence = (value: number): 'high' | 'medium' =>
    Math.abs(value) > Math.max(tolerance, PLUG_SHARE * Math.abs(preTax)) ? 'medium' : 'high'
  if (residualExpense >= 0) {
    return {
      income: financeIncome,
      interest,
      other: derived(residualExpense, ['金融収益 − 金融費用 − (税引前利益 − 営業利益)'], plugConfidence(residualExpense)),
    }
  }
  const income = net + interest.value
  return {
    income: derived(income, ['税引前利益 − 営業利益 + 金融費用'], plugConfidence(income)),
    interest,
    other: NOT_APPLICABLE,
  }
}

/** 突き合わせ: 書類の売上総利益・当期利益と、取り込んだ項目から計算した値が合うか */
function crossCheck(
  r: Reader,
  calc: { readonly gross: number; readonly profit: number },
  tolerance: number,
  label: string,
  issues: Issues,
): void {
  const checks: readonly (readonly [string, number])[] = [
    ['GrossProfitIFRS', calc.gross],
    ['ProfitLossIFRS', calc.profit],
  ]
  let compared = 0
  for (const [name, value] of checks) {
    const entry = r.get(name)
    if (entry === undefined) {
      continue
    }
    compared += 1
    if (Math.abs(entry.value - value) > tolerance) {
      issues.warnings.push(
        `${label}: 書類の${entry.label}(${entry.value} 円)と、取り込んだ項目からの計算値(${value} 円)が合いません。`,
      )
    }
  }
  if (compared === 0) {
    issues.warnings.push(`${label}: 書類に売上総利益・当期利益の科目が見つからず、取り込んだ値を突き合わせできませんでした。`)
  }
}

export function readIfrsPeriod(entries: Entries, endDate: string, label: string): PeriodReading {
  const issues: Issues = { errors: [], warnings: [], notes: [] }
  const r = createReader(entries)
  const tolerance = TOLERANCE_UNITS * roundingUnit(entries)

  const bs = readIfrsBalanceSheet(r, tolerance, label, issues)
  const sales = r.first([...IFRS_SALES_NAMES])
  const salesValues = new Set(r.all([...IFRS_SALES_NAMES]).map((e) => e.value))
  if (sales !== null && salesValues.size > 1) {
    issues.warnings.push(`${label}: 売上収益の科目が複数あり、値が違います(先頭の「${sales.sources[0]}」を使っています)。`)
  }
  const preTax = r.get('ProfitLossBeforeTaxIFRS')
  if (sales === null) {
    issues.errors.push('売上収益(売上高)が見つかりません。金融業などの業種別の様式の書類は未対応です。')
  }
  if (preTax === undefined) {
    issues.errors.push('税引前利益が見つかりません。')
  }
  if (bs === null || sales === null || preTax === undefined) {
    return { period: null, ...issues }
  }

  const grossEntry = r.get('GrossProfitIFRS')
  const costOfSales =
    r.first(['CostOfSalesIFRS']) ??
    (grossEntry
      ? derived(sales.value - grossEntry.value, ['売上収益 − 売上総利益'], 'medium')
      : missing('売上原価が見つかりません。0 として仮置きしています。'))
  const gross = sales.value - costOfSales.value
  const sga = readSga(r, gross, label, issues)
  const operating = gross - sga.value

  const debtYen = bs.shortTermDebt.value + bs.longTermDebt.value
  const nonOperating = readNonOperating(r, { operating, preTax: preTax.value, debtYen, tolerance })
  if (debtYen > 0) {
    issues.notes.push(NOTE_DEBT)
  }
  if (debtYen === 0 && nonOperating.interest.status === 'found' && nonOperating.interest.value > 0) {
    // 利息を払っているのに借入金・社債が 0 なのは、科目名の取りこぼしの疑いがある
    issues.warnings.push(`${label}: 支払利息があるのに、有利子負債の科目が見つかりませんでした。0 として扱っています。`)
  }
  const profit = r.get('ProfitLossIFRS')
  const incomeTaxes =
    r.first(['IncomeTaxExpenseIFRS']) ??
    (profit
      ? derived(preTax.value - profit.value, ['税引前利益 − 当期利益'], 'medium')
      : missing('法人所得税費用が見つかりません。0 として仮置きしています。'))
  if (issues.errors.length > 0) {
    return { period: null, ...issues }
  }

  crossCheck(r, { gross, profit: preTax.value - incomeTaxes.value }, tolerance, label, issues)
  issues.notes.push(NOTE_NON_OPERATING)
  const nonControlling = r.all(['NonControllingInterestsIFRS', 'ProfitLossAttributableToNonControllingInterestsIFRS'])
  if (total(nonControlling) !== 0) {
    issues.notes.push('純資産・当期純利益には、非支配株主に帰属する分を含めています。')
  }

  return {
    period: {
      endDate,
      label,
      bs,
      pl: {
        sales,
        costOfSales,
        sga,
        nonOperatingIncome: nonOperating.income,
        interestExpense: nonOperating.interest,
        otherNonOperatingExpense: nonOperating.other,
        extraordinaryGain: NOT_APPLICABLE,
        extraordinaryLoss: NOT_APPLICABLE,
        incomeTaxes,
        depreciation:
          r.first(['DepreciationAndAmortizationOpeCFIFRS', 'DepreciationAndAmortizationOfIntangibleAssetsOpeCFIFRS']) ??
          missing('減価償却費(キャッシュ・フロー計算書)が見つかりません。0 として仮置きしています。'),
      },
      ...readCashFlows(r, {
        operating: ['NetCashProvidedByUsedInOperatingActivitiesIFRS'],
        investing: ['NetCashProvidedByUsedInInvestingActivitiesIFRS'],
        financing: ['NetCashProvidedByUsedInFinancingActivitiesIFRS'],
      }),
    },
    ...issues,
  }
}

import type { BsFieldKey, ExtractedPeriod, FieldExtraction, PlFieldKey } from './types'

/** 書類に載っていた 1 つの科目(接頭辞なしの要素名で引く) */
export interface Entry {
  readonly value: number
  readonly label: string
}
export type Entries = ReadonlyMap<string, Entry>

export interface PeriodReading {
  /** 読めなかったときは null(理由は errors) */
  readonly period: ExtractedPeriod | null
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly notes: readonly string[]
}

// --- 科目の対応表(金融庁の勘定科目: jppfs_cor の要素名) ---
const RECEIVABLES_COMBINED = [
  'NotesAndAccountsReceivableTrade',
  'NotesAndAccountsReceivableTradeAndContractAssets',
  'NotesReceivableAccountsReceivableFromCompletedConstructionContractsAndOtherCNS',
] as const
const ELECTRONIC_CLAIMS = 'ElectronicallyRecordedMonetaryClaimsOperatingCA'
const RECEIVABLES_PARTS = ['NotesReceivableTrade', 'AccountsReceivableTrade', ELECTRONIC_CLAIMS] as const
const SECURITIES = ['SecuritiesCA', 'ShortTermInvestmentSecurities'] as const
const INVENTORY_PARTS = [
  'MerchandiseAndFinishedGoods',
  'Merchandise',
  'FinishedGoods',
  'WorkInProcess',
  'RawMaterialsAndSupplies',
  'RawMaterials',
  'Supplies',
] as const
const PAYABLES_COMBINED = ['NotesAndAccountsPayableTrade'] as const
const PAYABLES_PARTS = [
  'NotesPayableTrade',
  'AccountsPayableTrade',
  'ElectronicallyRecordedObligationsOperatingCL',
] as const
const SHORT_TERM_DEBT = [
  'ShortTermLoansPayable',
  'CurrentPortionOfLongTermLoansPayable',
  'CommercialPapersLiabilities',
  'CurrentPortionOfBonds',
] as const
const LONG_TERM_DEBT = [
  'BondsPayable',
  'ConvertibleBondTypeBondsWithSubscriptionRightsToSharesNCL',
  'LongTermLoansPayable',
] as const

/**
 * 突き合わせで許す差(書類の丸め単位の何倍か)。百万円で丸められた書類では、
 * 数個の項目を足し引きするだけで、数単位ずれることがある。
 */
export const TOLERANCE_UNITS = 5

// --- 1 項目の作り方 ---
export const NOT_APPLICABLE: FieldExtraction = { value: 0, status: 'notApplicable', confidence: 'high', sources: [] }

export function total(entries: readonly Entry[]): number {
  return entries.reduce((sum, e) => sum + e.value, 0)
}

export function found(entries: readonly Entry[], confidence: 'high' | 'medium' = 'high'): FieldExtraction {
  return { value: total(entries), status: 'found', confidence, sources: entries.map((e) => e.label) }
}

export function derived(
  value: number,
  sources: readonly string[],
  confidence: 'high' | 'medium' = 'high',
): FieldExtraction {
  return { value, status: 'derived', confidence, sources }
}

export function missing(note: string): FieldExtraction {
  return { value: 0, status: 'missing', confidence: 'medium', sources: [], note }
}

/**
 * 書類の金額が丸められている単位(百万円・千円・円)。
 * 表示単位に丸められた金額は、足し引きで数単位ずれるので、突き合わせの許容幅に使う。
 */
export function roundingUnit(entries: Entries): number {
  for (const unit of [1_000_000, 1_000]) {
    if ([...entries.values()].every((e) => e.value % unit === 0)) {
      return unit
    }
  }
  return 1
}

/** 科目を引く道具 */
export interface Reader {
  readonly get: (name: string) => Entry | undefined
  /** 見つかったものを、候補の順に並べて返す */
  readonly all: (names: readonly string[]) => Entry[]
  /** 候補のうち最初に見つかった 1 つ */
  readonly first: (names: readonly string[]) => FieldExtraction | null
  /** 見つかったものをすべて足す。1 つだけのときは high、複数を足したときは confidence */
  readonly sumOf: (names: readonly string[], confidence?: 'high' | 'medium') => FieldExtraction | null
}

export function createReader(entries: Entries): Reader {
  const get = (name: string): Entry | undefined => entries.get(name)
  const all = (names: readonly string[]): Entry[] =>
    names.flatMap((n) => {
      const e = get(n)
      return e === undefined ? [] : [e]
    })
  return {
    get,
    all,
    first: (names) => {
      const e = all(names)[0]
      return e === undefined ? null : found([e])
    },
    sumOf: (names, confidence = 'high') => {
      const list = all(names)
      return list.length === 0 ? null : found(list, list.length > 1 ? confidence : 'high')
    },
  }
}

export interface Issues {
  readonly errors: string[]
  readonly warnings: string[]
  readonly notes: string[]
}

export type BalanceSheet = Record<BsFieldKey, FieldExtraction>
export type IncomeStatement = Record<PlFieldKey, FieldExtraction>

/** 合計から内訳を引いた差額。負なら内訳が合計を超えており、二重計上の疑い */
export function residual(totalEntry: Entry, partsYen: number, name: string, issues: Issues): FieldExtraction {
  const value = totalEntry.value - partsYen
  if (value < 0) {
    issues.errors.push(`${name}の内訳が合計(${totalEntry.label})を超えています。科目の二重計上の疑いがあります。`)
  }
  return derived(value, [totalEntry.label])
}

/** 受取債権: 合算科目があればそれを使い、電子記録債権が別行なら足す。合算科目が無ければ内訳を足す */
function readReceivables(r: Reader): FieldExtraction {
  const combined = r.all(RECEIVABLES_COMBINED)[0]
  if (combined !== undefined) {
    const electronic = r.get(ELECTRONIC_CLAIMS)
    return found(electronic === undefined ? [combined] : [combined, electronic])
  }
  return r.sumOf(RECEIVABLES_PARTS) ?? NOT_APPLICABLE
}

/** 貸借対照表の合計の科目(日本基準・IFRS 共通の形) */
export interface BsTotals {
  readonly assets: Entry
  readonly currentAssets: Entry
  readonly liabilities: Entry
  readonly currentLiabilities: Entry
  /** 純資産(IFRS では資本)。非支配株主持分を含む */
  readonly equity: Entry
}

/** 内訳として直接取る項目。残りは合計との差額で「その他」にする */
export interface BsParts {
  readonly cash: FieldExtraction
  readonly receivables: FieldExtraction
  readonly securities: FieldExtraction
  readonly inventory: FieldExtraction
  readonly payables: FieldExtraction
  readonly shortTermDebt: FieldExtraction
  readonly longTermDebt: FieldExtraction
}

/** 合計の科目を取り出す。1 つでも無ければ null(理由は errors) */
export function readBsTotals(
  r: Reader,
  names: {
    readonly assets: readonly string[]
    readonly currentAssets: readonly string[]
    readonly liabilities: readonly string[]
    readonly currentLiabilities: readonly string[]
    readonly equity: readonly string[]
  },
  issues: Issues,
): BsTotals | null {
  const assets = r.all(names.assets)[0]
  const currentAssets = r.all(names.currentAssets)[0]
  const liabilities = r.all(names.liabilities)[0]
  const currentLiabilities = r.all(names.currentLiabilities)[0]
  const equity = r.all(names.equity)[0]
  if (!assets || !currentAssets || !liabilities || !currentLiabilities || !equity) {
    issues.errors.push(
      '貸借対照表の合計(資産合計・流動資産合計・負債合計・流動負債合計・純資産合計)が見つかりません。',
    )
    return null
  }
  return { assets, currentAssets, liabilities, currentLiabilities, equity }
}

/** 貸借対照表。合計の科目を基準にし、「その他」は差額で出す(貸借が必ず一致する) */
function readBalanceSheet(r: Reader, tolerance: number, label: string, issues: Issues): BalanceSheet | null {
  const totals = readBsTotals(
    r,
    {
      assets: ['Assets'],
      currentAssets: ['CurrentAssets'],
      liabilities: ['Liabilities'],
      currentLiabilities: ['CurrentLiabilities'],
      equity: ['NetAssets'],
    },
    issues,
  )
  if (totals === null) {
    return null
  }
  const cash = r.first(['CashAndDeposits']) ?? missing('現金及び預金が見つかりません。0 として仮置きしています。')
  const receivables = readReceivables(r)
  const securities = r.sumOf(SECURITIES) ?? NOT_APPLICABLE
  const inventoryParts = r.all(INVENTORY_PARTS)
  const inventory =
    r.first(['Inventories']) ?? (inventoryParts.length > 0 ? found(inventoryParts, 'medium') : NOT_APPLICABLE)
  const payables = r.first(PAYABLES_COMBINED) ?? r.sumOf(PAYABLES_PARTS) ?? NOT_APPLICABLE
  const shortTermDebt = r.sumOf(SHORT_TERM_DEBT) ?? NOT_APPLICABLE
  const longTermDebt = r.sumOf(LONG_TERM_DEBT) ?? NOT_APPLICABLE
  return assembleBalanceSheet(
    totals,
    { cash, receivables, securities, inventory, payables, shortTermDebt, longTermDebt },
    tolerance,
    label,
    issues,
  )
}

/** 合計と内訳から 12 項目を組み立てる。貸借が合わなければ null(理由は errors) */
export function assembleBalanceSheet(
  totals: BsTotals,
  parts: BsParts,
  tolerance: number,
  label: string,
  issues: Issues,
): BalanceSheet | null {
  const { assets, currentAssets, liabilities, currentLiabilities, equity: netAssets } = totals
  const { cash, receivables, securities, inventory, payables, shortTermDebt, longTermDebt } = parts
  const gap = Math.abs(assets.value - (liabilities.value + netAssets.value))
  if (gap > tolerance) {
    issues.errors.push(
      `貸借が一致しません(資産合計 ${assets.value} 円 ≠ 負債合計 + 純資産合計 ${liabilities.value + netAssets.value} 円)。`,
    )
    return null
  }
  if (gap > 0) {
    // 表示単位の丸めによる差は、どの書類にも起こりうる。「その他」に含めて貸借を合わせ、確認は求めない
    issues.notes.push(`${label}: 貸借に丸めによる差(${gap} 円)があります。書類の合計をそのまま使っているので、取り込んだ項目の貸借は、この差だけずれます。`)
  }

  return {
    cash,
    receivables,
    securities,
    inventory,
    otherCurrentAssets: residual(
      currentAssets,
      cash.value + receivables.value + securities.value + inventory.value,
      '流動資産',
      issues,
    ),
    fixedAssets: residual(assets, currentAssets.value, '固定資産', issues),
    payables,
    shortTermDebt,
    otherCurrentLiabilities: residual(
      currentLiabilities,
      payables.value + shortTermDebt.value,
      '流動負債',
      issues,
    ),
    longTermDebt,
    otherFixedLiabilities: residual(
      liabilities,
      currentLiabilities.value + longTermDebt.value,
      '固定負債',
      issues,
    ),
    equity: found([netAssets]),
  }
}

/** キャッシュフロー計算書の 3 区分(営業・投資・財務)。書類に無ければ null */
export interface CashFlowReading {
  readonly operatingCashFlow: FieldExtraction | null
  readonly investingCashFlow: FieldExtraction | null
  readonly financingCashFlow: FieldExtraction | null
}

/**
 * キャッシュフロー 3 区分を読む。日本基準の投資活動は、標準の科目名が「Investment」(綴りが他と違う)。
 * 投資・財務はマイナス(資金が出た)が普通なので、符号は、書類のまま使う。
 */
export function readCashFlows(
  r: Reader,
  names: { readonly operating: readonly string[]; readonly investing: readonly string[]; readonly financing: readonly string[] },
): CashFlowReading {
  return {
    operatingCashFlow: r.first(names.operating),
    investingCashFlow: r.first(names.investing),
    financingCashFlow: r.first(names.financing),
  }
}

/** キャッシュフロー計算書の、現金残高まわりの 3 項目。書類に無ければ null */
export interface CashBalanceReading {
  readonly cashEnd: FieldExtraction | null
  readonly cashChange: FieldExtraction | null
  readonly fxEffect: FieldExtraction | null
}

/**
 * 現金及び現金同等物の期末残高・増減額・為替の影響を読む(現金の増減との突き合わせに使う)。
 * IFRS には、増減額を「為替の影響の前」で出す書類もある。その書類では、為替の影響を足して、他と同じ「為替込み」にそろえる。
 */
export function readCashBalances(
  r: Reader,
  names: {
    readonly end: readonly string[]
    readonly change: readonly string[]
    readonly changeBeforeFx?: readonly string[]
    readonly fx: readonly string[]
  },
): CashBalanceReading {
  const fxEffect = r.first(names.fx)
  let cashChange = r.first(names.change)
  const before = names.changeBeforeFx === undefined ? undefined : r.all(names.changeBeforeFx)[0]
  if (cashChange === null && before !== undefined) {
    const sources = fxEffect === null ? [before.label] : [before.label, ...fxEffect.sources]
    cashChange = derived(before.value + (fxEffect?.value ?? 0), sources)
  }
  return { cashEnd: r.first(names.end), cashChange, fxEffect }
}

interface IncomeReading extends CashFlowReading, CashBalanceReading {
  readonly pl: IncomeStatement
}

/** 損益計算書。売上高が無い書類(業種別の様式)は読めない */
function readIncomeStatement(r: Reader, interestBearingDebt: number, issues: Issues): IncomeReading | null {
  const sales = r.get('NetSales')
  if (!sales) {
    issues.errors.push('売上高(NetSales)が見つかりません。業種別の様式(銀行・保険など)の書類は未対応です。')
    return null
  }
  const grossProfit = r.get('GrossProfit')
  const operatingIncome = r.get('OperatingIncome')
  const ordinaryIncome = r.get('OrdinaryIncome')
  const preTax = r.get('IncomeBeforeIncomeTaxes')
  const profitLoss = r.get('ProfitLoss')

  const costOfSales =
    r.first(['CostOfSales']) ??
    (grossProfit
      ? derived(sales.value - grossProfit.value, [sales.label, grossProfit.label], 'medium')
      : missing('売上原価が見つかりません。0 として仮置きしています。'))
  const gross = sales.value - costOfSales.value
  const sga =
    r.first(['SellingGeneralAndAdministrativeExpenses']) ??
    (operatingIncome
      ? derived(gross - operatingIncome.value, ['売上総利益 − 営業利益'], 'medium')
      : missing('販売費及び一般管理費が見つかりません。0 として仮置きしています。'))
  const operating = gross - sga.value

  const nonOperatingIncome = r.first(['NonOperatingIncome']) ?? NOT_APPLICABLE
  // 有利子負債があるのに支払利息が無いのは不自然(利息が「その他」に混ざる)なので、取れなかったことを示す
  const interestExpense =
    r.first(['InterestExpensesNOE']) ??
    (interestBearingDebt > 0
      ? missing('有利子負債があるのに、支払利息が見つかりません。0 として仮置きしています。')
      : NOT_APPLICABLE)
  const otherNonOperatingExpense = readOtherNonOperatingExpense(
    r,
    { operating, nonOperatingIncome, interestExpense },
    ordinaryIncome,
    issues,
  )

  const incomeTaxes =
    r.first(['IncomeTaxes']) ??
    (preTax && profitLoss
      ? derived(preTax.value - profitLoss.value, ['税引前利益 − 当期純利益'], 'medium')
      : missing('法人税等が見つかりません。0 として仮置きしています。'))
  const depreciation =
    r.first(['DepreciationAndAmortizationOpeCF']) ??
    missing('減価償却費(キャッシュ・フロー計算書)が見つかりません。0 として仮置きしています。')

  return {
    pl: {
      sales: found([sales]),
      costOfSales,
      sga,
      nonOperatingIncome,
      interestExpense,
      otherNonOperatingExpense,
      extraordinaryGain: r.first(['ExtraordinaryIncome']) ?? NOT_APPLICABLE,
      extraordinaryLoss: r.first(['ExtraordinaryLoss']) ?? NOT_APPLICABLE,
      incomeTaxes,
      depreciation,
    },
    ...readCashFlows(r, {
      operating: ['NetCashProvidedByUsedInOperatingActivities'],
      investing: ['NetCashProvidedByUsedInInvestmentActivities', 'NetCashProvidedByUsedInInvestingActivities'],
      financing: ['NetCashProvidedByUsedInFinancingActivities'],
    }),
    ...readCashBalances(r, {
      end: ['CashAndCashEquivalents'],
      change: ['NetIncreaseDecreaseInCashAndCashEquivalents'],
      fx: ['EffectOfExchangeRateChangeOnCashAndCashEquivalents'],
    }),
  }
}

/** その他の営業外費用 = 営業外費用合計 − 支払利息。合計が無ければ、経常利益から逆算する */
function readOtherNonOperatingExpense(
  r: Reader,
  known: {
    readonly operating: number
    readonly nonOperatingIncome: FieldExtraction
    readonly interestExpense: FieldExtraction
  },
  ordinaryIncome: Entry | undefined,
  issues: Issues,
): FieldExtraction {
  const expenses = r.get('NonOperatingExpenses')
  let field: FieldExtraction = NOT_APPLICABLE
  if (expenses) {
    field = derived(expenses.value - known.interestExpense.value, [expenses.label])
  } else if (ordinaryIncome) {
    field = derived(
      known.operating + known.nonOperatingIncome.value - known.interestExpense.value - ordinaryIncome.value,
      ['営業利益 + 営業外収益 − 支払利息 − 経常利益'],
      'medium',
    )
  }
  if (field.value < 0) {
    issues.errors.push('営業外費用の内訳(支払利息)が合計を超えています。科目の取り違えの疑いがあります。')
  }
  return field
}

/** 突き合わせ: 書類の利益と、取り込んだ項目から計算した利益が合うか */
function crossCheck(r: Reader, pl: IncomeStatement, tolerance: number, label: string, issues: Issues): void {
  const gross = pl.sales.value - pl.costOfSales.value
  const operating = gross - pl.sga.value
  const ordinary =
    operating + pl.nonOperatingIncome.value - pl.interestExpense.value - pl.otherNonOperatingExpense.value
  const preTax = ordinary + pl.extraordinaryGain.value - pl.extraordinaryLoss.value
  const checks: readonly (readonly [string, number])[] = [
    ['GrossProfit', gross],
    ['OperatingIncome', operating],
    ['OrdinaryIncome', ordinary],
    ['IncomeBeforeIncomeTaxes', preTax],
    ['ProfitLoss', preTax - pl.incomeTaxes.value],
  ]
  let compared = 0
  for (const [name, calc] of checks) {
    const entry = r.get(name)
    if (entry === undefined) {
      continue
    }
    compared += 1
    if (Math.abs(entry.value - calc) > tolerance) {
      issues.warnings.push(
        `${label}: 書類の${entry.label}(${entry.value} 円)と、取り込んだ項目からの計算値(${calc} 円)が合いません。`,
      )
    }
  }
  if (compared === 0) {
    issues.warnings.push(`${label}: 書類に利益の科目が見つからず、取り込んだ値を突き合わせできませんでした。`)
  }
}

/** 知っておいてほしい扱い */
function collectNotes(r: Reader, issues: Issues): void {
  const leases = r.all(['LeaseObligationsCL', 'LeaseObligationsNCL'])
  if (leases.length > 0 && total(leases) !== 0) {
    issues.notes.push(
      `リース債務(${total(leases)} 円)は有利子負債に含めていません(借入金と社債だけを有利子負債としています)。`,
    )
  }
  const nonControlling = r.all(['NonControllingInterests', 'ProfitLossAttributableToNonControllingInterests'])
  if (nonControlling.some((e) => e.value !== 0)) {
    issues.notes.push('純資産・当期純利益には、非支配株主に帰属する分を含めています。')
  }
}

export function readPeriod(entries: Entries, endDate: string, label: string): PeriodReading {
  const issues: Issues = { errors: [], warnings: [], notes: [] }
  const reader = createReader(entries)
  const tolerance = TOLERANCE_UNITS * roundingUnit(entries)

  const bs = readBalanceSheet(reader, tolerance, label, issues)
  if (bs === null) {
    return { period: null, ...issues }
  }
  const income = readIncomeStatement(reader, bs.shortTermDebt.value + bs.longTermDebt.value, issues)
  if (income === null || issues.errors.length > 0) {
    return { period: null, ...issues }
  }
  crossCheck(reader, income.pl, tolerance, label, issues)
  collectNotes(reader, issues)

  return {
    period: {
      endDate,
      label,
      bs,
      pl: income.pl,
      operatingCashFlow: income.operatingCashFlow,
      investingCashFlow: income.investingCashFlow,
      financingCashFlow: income.financingCashFlow,
      cashEnd: income.cashEnd,
      cashChange: income.cashChange,
      fxEffect: income.fxEffect,
    },
    ...issues,
  }
}

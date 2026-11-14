/**
 * テスト用の合成データ。実在しない会社の数字で、EDINET の CSV(XBRL → CSV 変換)の
 * 列構成と要素IDをまねている。実際の提出書類は含まない。
 * 金額は百万円の整数 × 100 万 = 円。恒等式(売上 − 原価 = 総利益 など)がすべて成り立つ。
 */

export interface FixtureRow {
  readonly elementId: string
  readonly label: string
  readonly contextId: string
  readonly consolidation: string
  readonly unit: string
  readonly value: string
}

export interface Line {
  readonly element: string
  readonly label: string
  readonly kind: 'instant' | 'duration'
  /** 当期・前期の値(百万円) */
  readonly current: number
  readonly prior: number
}

export const M = 1_000_000

/** 前期は当期の 0.9 倍(恒等式は線形なので、そのまま成り立つ) */
export function line(element: string, label: string, kind: 'instant' | 'duration', current: number): Line {
  return { element, label, kind, current, prior: Math.round(current * 0.9) }
}

export const BASE_LINES: readonly Line[] = [
  // BS
  line('CashAndDeposits', '現金及び預金', 'instant', 10_000),
  line('NotesAndAccountsReceivableTrade', '受取手形及び売掛金', 'instant', 15_000),
  line('ShortTermInvestmentSecurities', '有価証券', 'instant', 1_000),
  line('Inventories', '棚卸資産', 'instant', 12_000),
  line('CurrentAssets', '流動資産合計', 'instant', 40_000),
  line('NoncurrentAssets', '固定資産合計', 'instant', 60_000),
  line('Assets', '資産合計', 'instant', 100_000),
  line('NotesAndAccountsPayableTrade', '支払手形及び買掛金', 'instant', 9_000),
  line('ShortTermLoansPayable', '短期借入金', 'instant', 5_000),
  line('CurrentPortionOfLongTermLoansPayable', '1年内返済予定の長期借入金', 'instant', 3_000),
  line('CurrentLiabilities', '流動負債合計', 'instant', 25_000),
  line('BondsPayable', '社債', 'instant', 5_000),
  line('LongTermLoansPayable', '長期借入金', 'instant', 15_000),
  line('NoncurrentLiabilities', '固定負債合計', 'instant', 30_000),
  line('Liabilities', '負債合計', 'instant', 55_000),
  line('NetAssets', '純資産合計', 'instant', 45_000),
  line('LiabilitiesAndNetAssets', '負債純資産合計', 'instant', 100_000),
  // PL
  line('NetSales', '売上高', 'duration', 120_000),
  line('CostOfSales', '売上原価', 'duration', 84_000),
  line('GrossProfit', '売上総利益', 'duration', 36_000),
  line('SellingGeneralAndAdministrativeExpenses', '販売費及び一般管理費', 'duration', 27_000),
  line('OperatingIncome', '営業利益', 'duration', 9_000),
  line('NonOperatingIncome', '営業外収益合計', 'duration', 1_000),
  line('InterestExpensesNOE', '支払利息', 'duration', 800),
  line('NonOperatingExpenses', '営業外費用合計', 'duration', 1_500),
  line('OrdinaryIncome', '経常利益', 'duration', 8_500),
  line('ExtraordinaryIncome', '特別利益合計', 'duration', 200),
  line('ExtraordinaryLoss', '特別損失合計', 'duration', 700),
  line('IncomeBeforeIncomeTaxes', '税金等調整前当期純利益', 'duration', 8_000),
  line('IncomeTaxes', '法人税等合計', 'duration', 2_400),
  line('ProfitLoss', '当期純利益', 'duration', 5_600),
  line('DepreciationAndAmortizationOpeCF', '減価償却費', 'duration', 4_000),
  line('NetCashProvidedByUsedInOperatingActivities', '営業活動によるキャッシュ・フロー', 'duration', 7_000),
]

export interface FixtureOptions {
  /** 取り除く要素(接頭辞なしの名前) */
  readonly omit?: readonly string[]
  /** 値を差し替える要素 → [当期, 前期](百万円) */
  readonly override?: Readonly<Record<string, readonly [number, number]>>
  /** true なら、連結ではなく個別(NonConsolidatedMember)の事実として出す */
  readonly individualOnly?: boolean
  /** 前期のデータを出さない */
  readonly noPrior?: boolean
  readonly standard?: string
  readonly periodType?: string
  readonly currentEnd?: string
  readonly companyName?: string
  readonly edinetCode?: string
  /** 末尾にそのまま足す行 */
  readonly extraRows?: readonly FixtureRow[]
}

export function contextId(year: 'current' | 'prior', kind: 'instant' | 'duration', individual: boolean): string {
  const y = year === 'current' ? 'CurrentYear' : 'Prior1Year'
  const k = kind === 'instant' ? 'Instant' : 'Duration'
  return `${y}${k}${individual ? '_NonConsolidatedMember' : ''}`
}

function factRow(
  element: string,
  label: string,
  context: string,
  consolidation: string,
  amountYen: number,
): FixtureRow {
  return {
    elementId: `jppfs_cor:${element}`,
    label,
    contextId: context,
    consolidation,
    unit: '円', // 実際の CSV の「単位」列の値(ユニット ID は JPY)
    value: String(amountYen),
  }
}

/** 表紙情報(DEI)の行 */
export function deiRows(options: FixtureOptions): FixtureRow[] {
  const dei = (element: string, value: string): FixtureRow => ({
    elementId: element,
    label: element,
    contextId: 'FilingDateInstant',
    consolidation: '提出会社',
    unit: '',
    value,
  })
  return [
    {
      elementId: 'jpcrp_cor:CompanyNameCoverPage',
      label: '提出会社名',
      contextId: 'FilingDateInstant',
      consolidation: '提出会社',
      unit: '',
      value: options.companyName ?? 'サンプル製作所(架空)',
    },
    dei('jpdei_cor:EDINETCodeDEI', options.edinetCode ?? 'E99999'),
    dei('jpdei_cor:AccountingStandardsDEI', options.standard ?? 'Japan GAAP'),
    dei('jpdei_cor:TypeOfCurrentPeriodDEI', options.periodType ?? 'FY'),
    dei('jpdei_cor:CurrentFiscalYearEndDateDEI', options.currentEnd ?? '2025-03-31'),
  ]
}

export function fixtureRows(options: FixtureOptions = {}): FixtureRow[] {
  const omit = new Set(options.omit ?? [])
  const individual = options.individualOnly === true
  const consolidation = individual ? '個別' : '連結'
  const rows: FixtureRow[] = [...deiRows(options)]
  const years: readonly ('current' | 'prior')[] = options.noPrior ? ['current'] : ['current', 'prior']

  for (const l of BASE_LINES) {
    if (omit.has(l.element)) {
      continue
    }
    const over = options.override?.[l.element]
    for (const year of years) {
      const millions = over ? over[year === 'current' ? 0 : 1] : year === 'current' ? l.current : l.prior
      rows.push(factRow(l.element, l.label, contextId(year, l.kind, individual), consolidation, millions * M))
    }
  }
  return [...rows, ...(options.extraRows ?? [])]
}

const HEADER = ['要素ID', '項目名', 'コンテキストID', '相対年度', '連結・個別', '期間・時点', 'ユニットID', '単位', '値']

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** EDINET の CSV と同じ並び(見出し + 各行、タブ区切り、各欄を引用符で囲む)の文字列 */
export function buildCsvText(rows: readonly FixtureRow[]): string {
  const lines = [HEADER.map(quote).join('\t')]
  for (const r of rows) {
    const relative = r.contextId.startsWith('Prior') ? '前期' : '当期'
    const period = r.contextId.includes('Duration') ? '期間' : '時点'
    lines.push(
      [r.elementId, r.label, r.contextId, relative, r.consolidation, period, '', r.unit, r.value]
        .map(quote)
        .join('\t'),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}

/** 文字列を BOM 付きの UTF-16LE にする(EDINET の CSV の文字コード) */
export function encodeUtf16le(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = 0xff
  bytes[1] = 0xfe
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    bytes[2 + i * 2] = code & 0xff
    bytes[3 + i * 2] = code >> 8
  }
  return bytes
}

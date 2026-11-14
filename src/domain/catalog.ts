import type { MetricKey, UnavailableReason } from './metrics'

export type { MetricKey }
export type MetricGroup = 'profitability' | 'stability'
export type MetricUnit = '%' | '倍' | '年' | '回'
export type EvaluationLevel = 'good' | 'caution' | 'danger' | 'unknown'

/** 目安値。direction が higher なら大きいほど良い、lower なら小さいほど良い */
interface Guideline {
  readonly direction: 'higher' | 'lower'
  /** この値より良ければ good */
  readonly good: number
  /** この値より悪ければ danger。無ければ good でなければ caution */
  readonly danger?: number
}

export interface MetricDefinition {
  readonly key: MetricKey
  readonly group: MetricGroup
  readonly label: string
  readonly unit: MetricUnit
  readonly formula: string
  readonly meaning: string
  readonly guideline?: Guideline
}

/**
 * 指標の定義と目安値。
 * 目安値は一般的な財務分析の解説(中小企業向けの経営分析記事・銀行格付けの見方)の
 * 共通部分を採用している。出典ごとに数値が異なる指標は、より慎重な側に寄せた。
 * 業種によって適正値は大きく変わるため、あくまで出発点の目安として扱う。
 */
export const METRIC_CATALOG: readonly MetricDefinition[] = [
  {
    key: 'grossMargin',
    group: 'profitability',
    label: '売上高総利益率',
    unit: '%',
    formula: '売上総利益 ÷ 売上高',
    meaning: '商品・サービス自体の稼ぐ力。業種差が大きいので、自社の推移や同業との比較で見る。',
  },
  {
    key: 'operatingMargin',
    group: 'profitability',
    label: '売上高営業利益率',
    unit: '%',
    formula: '営業利益 ÷ 売上高',
    meaning: '本業の儲けやすさ。マイナスは本業が赤字。',
    guideline: { direction: 'higher', good: 5, danger: 0 },
  },
  {
    key: 'ordinaryMargin',
    group: 'profitability',
    label: '売上高経常利益率',
    unit: '%',
    formula: '経常利益 ÷ 売上高',
    meaning: '財務活動も含めた、通常の事業活動での儲けやすさ。',
    guideline: { direction: 'higher', good: 4, danger: 0 },
  },
  {
    key: 'ordinaryReturnOnAssets',
    group: 'profitability',
    label: '総資本経常利益率',
    unit: '%',
    formula: '経常利益 ÷ 総資本(総資産)',
    meaning: '持っている資産でどれだけ効率よく経常利益を稼いでいるか。',
  },
  {
    key: 'roa',
    group: 'profitability',
    label: 'ROA(総資産利益率)',
    unit: '%',
    formula: '当期純利益 ÷ 総資産',
    meaning: '資産全体をどれだけ効率よく使って最終利益を出したか。',
    guideline: { direction: 'higher', good: 5, danger: 1 },
  },
  {
    key: 'roe',
    group: 'profitability',
    label: 'ROE(自己資本利益率)',
    unit: '%',
    formula: '当期純利益 ÷ 自己資本',
    meaning: '株主のお金でどれだけ稼いだか。借入を増やすと上がりやすいので ROA とセットで見る。',
    guideline: { direction: 'higher', good: 8, danger: 0 },
  },
  {
    key: 'totalAssetTurnover',
    group: 'profitability',
    label: '総資本回転率',
    unit: '回',
    formula: '売上高 ÷ 総資産',
    meaning: '資産を何回転させて売上を作ったか。ROA = 売上高純利益率 × 総資本回転率。',
    guideline: { direction: 'higher', good: 1 },
  },
  {
    key: 'currentRatio',
    group: 'stability',
    label: '流動比率',
    unit: '%',
    formula: '流動資産 ÷ 流動負債',
    meaning: '1年以内に返す負債を、1年以内に現金化できる資産でどれだけ賄えるか。短期の支払い能力。',
    guideline: { direction: 'higher', good: 150, danger: 100 },
  },
  {
    key: 'quickRatio',
    group: 'stability',
    label: '当座比率',
    unit: '%',
    formula: '当座資産(現預金・売上債権・有価証券) ÷ 流動負債',
    meaning: '在庫を除いた、より厳しい短期の支払い能力。',
    guideline: { direction: 'higher', good: 100 },
  },
  {
    key: 'equityRatio',
    group: 'stability',
    label: '自己資本比率',
    unit: '%',
    formula: '自己資本(純資産) ÷ 総資産',
    meaning: '返さなくてよいお金で資産をどれだけ賄っているか。会社の体力。',
    guideline: { direction: 'higher', good: 30, danger: 10 },
  },
  {
    key: 'fixedRatio',
    group: 'stability',
    label: '固定比率',
    unit: '%',
    formula: '固定資産 ÷ 自己資本',
    meaning: '回収に時間のかかる固定資産を、返済不要の自己資本で賄えているか。',
    guideline: { direction: 'lower', good: 100 },
  },
  {
    key: 'fixedLongTermRatio',
    group: 'stability',
    label: '固定長期適合率',
    unit: '%',
    formula: '固定資産 ÷ (自己資本 + 固定負債)',
    meaning: '固定資産を、自己資本と長期の負債で賄えているか。100% 超は短期の借入に頼っている状態。',
    guideline: { direction: 'lower', good: 100, danger: 100 },
  },
  {
    key: 'debtToEquity',
    group: 'stability',
    label: '負債比率',
    unit: '%',
    formula: '負債 ÷ 自己資本',
    meaning: '自己資本に対する負債の大きさ。',
    guideline: { direction: 'lower', good: 100, danger: 200 },
  },
  {
    key: 'interestBearingDebtMultiple',
    group: 'stability',
    label: '有利子負債倍率',
    unit: '倍',
    formula: '有利子負債 ÷ 自己資本',
    meaning: '利息を払う借入が、自己資本の何倍あるか。',
    guideline: { direction: 'lower', good: 1 },
  },
  {
    key: 'debtRepaymentYears',
    group: 'stability',
    label: '債務償還年数',
    unit: '年',
    formula: '有利子負債 ÷ 営業キャッシュフロー',
    meaning: '今のペースで稼いだお金で、借入を何年で返せるか。',
    guideline: { direction: 'lower', good: 10, danger: 15 },
  },
  {
    key: 'interestCoverage',
    group: 'stability',
    label: 'インタレスト・カバレッジ・レシオ',
    unit: '倍',
    formula: '(営業利益 + 営業外収益) ÷ 支払利息',
    meaning:
      '本業の儲けで支払利息を何回分まかなえるか。教科書では分子を「営業利益 + 受取利息・配当金」としますが、このアプリは営業外収益の全体を使う概算です(為替差益なども含むため、やや高めに出ます)。',
    guideline: { direction: 'higher', good: 3, danger: 1 },
  },
]

const CATALOG_BY_KEY: ReadonlyMap<MetricKey, MetricDefinition> = new Map(
  METRIC_CATALOG.map((d) => [d.key, d]),
)

export function getMetricDefinition(key: MetricKey): MetricDefinition {
  const def = CATALOG_BY_KEY.get(key)
  if (!def) {
    throw new Error(`未定義の指標です: ${key}`)
  }
  return def
}

/** 画面に表示する小数の桁数。判定も同じ桁で行い、表示と評価が食い違わないようにする */
export function displayDigits(unit: MetricUnit): number {
  return unit === '倍' || unit === '回' ? 2 : 1
}

export function roundForDisplay(value: number, unit: MetricUnit): number {
  const factor = 10 ** displayDigits(unit)
  return Math.round(value * factor) / factor
}

/** 算出できない理由の説明(画面に出す) */
export function unavailableText(reason: UnavailableReason): string {
  switch (reason) {
    case 'insolvent':
      return '自己資本がマイナスか 0 のため算出できません(債務超過)'
    case 'cashFlowShortfall':
      return 'キャッシュフローが赤字のため、借入を返済できません'
    case 'noInterest':
      return '支払利息がありません(借入の利息負担なし)'
    case 'noDenominator':
      return '売上高や総資産などが 0 のため算出できません'
  }
}

/** 算出できなかった理由から、評価を決める。債務超過・返済不能は危険、利息なしは良好 */
function evaluateUnavailable(reason: UnavailableReason | undefined): EvaluationLevel {
  switch (reason) {
    case 'insolvent':
    case 'cashFlowShortfall':
      return 'danger'
    case 'noInterest':
      return 'good'
    case 'noDenominator':
    case undefined:
      return 'unknown'
  }
}

/**
 * 値を目安に照らして 3 段階(+ 判定不能)で評価する。
 * 値が算出できなかった場合は、その理由(reason)から評価する。
 */
export function evaluateMetric(
  key: MetricKey,
  value: number | null,
  reason?: UnavailableReason,
): EvaluationLevel {
  const def = getMetricDefinition(key)
  const g = def.guideline
  if (value === null) {
    return evaluateUnavailable(reason)
  }
  if (g === undefined) {
    return 'unknown'
  }
  const v = roundForDisplay(value, def.unit)
  if (g.direction === 'higher') {
    if (v >= g.good) return 'good'
    return g.danger !== undefined && v < g.danger ? 'danger' : 'caution'
  }
  if (v <= g.good) return 'good'
  return g.danger !== undefined && v > g.danger ? 'danger' : 'caution'
}

/** 画面に出す目安の説明文。目安が無い指標は null */
export function guidelineText(key: MetricKey): string | null {
  const def = getMetricDefinition(key)
  const g = def.guideline
  if (g === undefined) {
    return null
  }
  const u = def.unit
  if (g.direction === 'higher') {
    const danger = g.danger !== undefined ? `、${g.danger}${u}未満は要注意` : ''
    return `目安: ${g.good}${u}以上${danger}`
  }
  const danger = g.danger !== undefined ? `、${g.danger}${u}超は要注意` : ''
  return `目安: ${g.good}${u}以下${danger}`
}

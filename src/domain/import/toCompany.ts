import { UNIT_DIVISOR } from '../units'
import { parseCompany } from '../validate'
import type { AmountUnit, Company, IncomeStatementInput, PeriodData } from '../types'
import type { ExtractedPeriod, ExtractionResult } from './types'

/** 総資産(円)の大きさに合わせて、画面で扱いやすい金額の単位を選ぶ */
export function chooseUnit(totalAssetsYen: number): AmountUnit {
  if (totalAssetsYen >= 1_000_000_000) return '百万円'
  if (totalAssetsYen >= 1_000_000) return '千円'
  return '円'
}

/** 円の金額を、指定した単位に直した数にする(画面に出す用) */
export function amountInUnit(yen: number, unit: AmountUnit): number {
  return yen / UNIT_DIVISOR[unit]
}

function values<K extends string>(
  fields: Readonly<Record<K, { readonly value: number }>>,
  divisor: number,
): Record<K, number> {
  const out = {} as Record<K, number>
  for (const key of Object.keys(fields) as K[]) {
    out[key] = fields[key].value / divisor
  }
  return out
}

function toPeriod(extracted: ExtractedPeriod, divisor: number): PeriodData {
  const pl: IncomeStatementInput = {
    ...values(extracted.pl, divisor),
    ...(extracted.operatingCashFlow === null
      ? {}
      : { operatingCashFlow: extracted.operatingCashFlow.value / divisor }),
  }
  return { label: extracted.label, bs: values(extracted.bs, divisor), pl }
}

/** 資産合計(円)。単位の選択に使う(BS の資産側の項目の合計) */
function assetsYen(period: ExtractedPeriod): number {
  const { cash, receivables, securities, inventory, otherCurrentAssets, fixedAssets } = period.bs
  return (
    cash.value +
    receivables.value +
    securities.value +
    inventory.value +
    otherCurrentAssets.value +
    fixedAssets.value
  )
}

/**
 * 抽出結果から Company を作る。金額は円から、最新期の総資産に合う単位へ直す。
 * 反映できない結果(errors あり・期なし)や、保存データの検証に通らない値が含まれるときは null。
 */
export function toCompany(result: ExtractionResult, id: string): Company | null {
  if (result.errors.length > 0 || result.periods.length === 0) {
    return null
  }
  const latest = result.periods[result.periods.length - 1]
  const unit = chooseUnit(assetsYen(latest))
  const divisor = UNIT_DIVISOR[unit]
  const company: Company = {
    id,
    name: result.companyName,
    unit,
    ...(result.edinetCode === null ? {} : { edinetCode: result.edinetCode }),
    periods: result.periods.map((p) => toPeriod(p, divisor)),
  }
  // 外から来た値なので、手入力や保存データと同じ検証を最後に必ず通す
  return parseCompany(company)
}

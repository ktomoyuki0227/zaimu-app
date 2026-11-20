import { BS_FIELDS, PL_FIELDS } from '../fields'
import { CASH_FLOW_KEYS, type CashFlowKey } from '../types'
import type { FieldExtraction, FieldStatus, ExtractionResult } from './types'

/** 確認画面に出す、「自動で決めきれなかった項目」 */
export interface AttentionItem {
  readonly periodLabel: string
  readonly fieldLabel: string
  /** 円 */
  readonly valueYen: number
  readonly status: FieldStatus
  /** 値の根拠になった書類上の項目名 */
  readonly sources: readonly string[]
  readonly note: string | undefined
}

function isCashFlowKey(key: string): key is CashFlowKey {
  return (CASH_FLOW_KEYS as readonly string[]).includes(key)
}

/** 取れなかった(0 の仮置き)か、差額・近似で求めた(取り違えの余地がある)項目か */
export function isUnsureField(field: FieldExtraction): boolean {
  return field.status === 'missing' || (field.status !== 'notApplicable' && field.confidence === 'medium')
}

/**
 * 取れなかった項目(0 の仮置き)と、差額・近似で求めた項目(取り違えの余地がある)を、
 * 期の順・項目の順に並べて返す。確実に取れた項目と「該当なし」は含めない。
 */
export function attentionItems(result: ExtractionResult): readonly AttentionItem[] {
  const items: AttentionItem[] = []
  const push = (periodLabel: string, fieldLabel: string, field: FieldExtraction | null | undefined): void => {
    if (field && isUnsureField(field)) {
      items.push({
        periodLabel,
        fieldLabel,
        valueYen: field.value,
        status: field.status,
        sources: field.sources,
        note: field.note,
      })
    }
  }
  for (const period of result.periods) {
    for (const def of BS_FIELDS) {
      push(period.label, def.label, period.bs[def.key])
    }
    for (const def of PL_FIELDS) {
      if (isCashFlowKey(def.key)) {
        push(period.label, def.label, period[def.key])
      } else {
        push(period.label, def.label, period.pl[def.key])
      }
    }
  }
  return items
}

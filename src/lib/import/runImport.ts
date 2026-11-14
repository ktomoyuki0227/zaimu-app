import { UNNAMED_COMPANY_NAME } from '../../domain/import/extract'
import { toCompany } from '../../domain/import/toCompany'
import type { ExtractionResult } from '../../domain/import/types'
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from '../../domain/limits'
import { companyIdFor } from '../../domain/portfolio'
import type { Company } from '../../domain/types'
import { importFromBytes } from './importFile'

export type RunOutcome =
  | {
      readonly kind: 'ready'
      readonly result: ExtractionResult
      /** 反映できるときだけ入る(errors があれば null) */
      readonly company: Company | null
    }
  | { readonly kind: 'error'; readonly message: string }

/**
 * 企業の識別。EDINET コードも会社名も読めなかった書類は、見つからなかったときの仮の名前が同じになるので、
 * 無関係な書類どうしが 1 つの企業に混ざらないよう、そのつど別の識別にする。
 */
function identityOf(edinetCode: string | null, name: string): string {
  if (edinetCode === null && name === UNNAMED_COMPANY_NAME) {
    return `unnamed-${globalThis.crypto.randomUUID()}`
  }
  return companyIdFor(edinetCode, name)
}

/**
 * ファイルの中身(バイト列)から、抽出結果と(反映できるなら)Company を返す。
 * EDINET から取得した書類も、手元から選んだファイルも、同じ処理を通す。
 */
export function runImportBytes(bytes: Uint8Array, limits: ImportLimits = DEFAULT_IMPORT_LIMITS): RunOutcome {
  const outcome = importFromBytes(bytes, limits)
  if (outcome.kind === 'error') {
    return outcome
  }
  if (outcome.result.errors.length > 0) {
    return { kind: 'ready', result: outcome.result, company: null }
  }
  const company = toCompany(outcome.result, identityOf(outcome.result.edinetCode, outcome.result.companyName))
  if (company === null) {
    return {
      kind: 'error',
      message: '取り込んだデータを、このアプリで扱える形に変換できませんでした(金額が大きすぎる可能性があります)。',
    }
  }
  return { kind: 'ready', result: outcome.result, company }
}

/**
 * 選ばれたファイルを読み、抽出結果と(反映できるなら)Company を返す。
 * この関数とその先のコード(zip 展開など)は、ファイルを選ぶまで読み込まれない(遅延読み込み)。
 */
export async function runImport(file: File, limits: ImportLimits = DEFAULT_IMPORT_LIMITS): Promise<RunOutcome> {
  if (file.size > limits.maxFileBytes) {
    return {
      kind: 'error',
      message: `ファイルが大きすぎます(上限 ${Math.floor(limits.maxFileBytes / (1024 * 1024))}MB)。`,
    }
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return { kind: 'error', message: 'ファイルを読み込めませんでした。' }
  }
  return runImportBytes(bytes, limits)
}

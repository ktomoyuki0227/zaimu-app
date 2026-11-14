import { decodeText } from '../../domain/import/decodeText'
import { parseEdinetCsv } from '../../domain/import/edinetCsv'
import { extractFromFacts } from '../../domain/import/extract'
import type { ExtractionResult } from '../../domain/import/types'
import type { ImportLimits } from '../../domain/limits'
import { extractCsvFromZip } from './unzip'

export type ImportOutcome =
  | { readonly kind: 'result'; readonly result: ExtractionResult }
  | { readonly kind: 'error'; readonly message: string }

function startsWith(bytes: Uint8Array, text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[i] !== text.charCodeAt(i)) {
      return false
    }
  }
  return true
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

const UNSUPPORTED_NOTE = '今のところ、EDINET の CSV(zip)に対応しています。'

function fail(message: string): ImportOutcome {
  return { kind: 'error', message }
}

/** 先頭が < なら XML・HTML(XBRL・iXBRL)。BOM と空白は読み飛ばして見る */
function looksLikeMarkup(bytes: Uint8Array): boolean {
  let i = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3
  }
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) {
    i += 1
  }
  return bytes[i] === 0x3c
}

/**
 * ファイルのバイト列から、抽出結果を作る(ブラウザ内で完結し、外部には何も送らない)。
 * 形式は拡張子ではなく中身で判定する。
 */
export function importFromBytes(bytes: Uint8Array, limits: ImportLimits): ImportOutcome {
  if (bytes.length === 0) {
    return fail('ファイルが空です。')
  }
  if (bytes.length > limits.maxFileBytes) {
    return fail(
      `ファイルが大きすぎます(上限 ${Math.floor(limits.maxFileBytes / (1024 * 1024))}MB)。`,
    )
  }
  if (startsWith(bytes, '%PDF')) {
    return fail(`PDF はまだ対応していません。${UNSUPPORTED_NOTE}`)
  }

  let csvBytes: Uint8Array
  if (isZip(bytes)) {
    const unzipped = extractCsvFromZip(bytes, limits)
    if (!unzipped.ok) {
      return fail(unzipped.reason)
    }
    csvBytes = unzipped.csv
  } else if (looksLikeMarkup(bytes)) {
    return fail(`XML・HTML(XBRL)はまだ対応していません。${UNSUPPORTED_NOTE}`)
  } else {
    csvBytes = bytes
  }

  const text = decodeText(csvBytes)
  if (text === null) {
    return fail('文字コードを判定できませんでした。EDINET の CSV(UTF-16)か UTF-8 のファイルを使ってください。')
  }
  const parsed = parseEdinetCsv(text, limits.maxCsvRows)
  if (!parsed.ok) {
    return fail(parsed.reason)
  }
  return { kind: 'result', result: extractFromFacts(parsed.facts, parsed.info) }
}

/** 読み取りの上限。細工されたファイルでメモリや時間を使い切られないようにする */
export interface TsvLimits {
  /** 1 つの欄の文字数 */
  readonly maxFieldChars: number
  /** 1 行の欄の数 */
  readonly maxFieldsPerRow: number
  /** 全体の欄の数 */
  readonly maxFields: number
}

export const DEFAULT_TSV_LIMITS: TsvLimits = {
  maxFieldChars: 1_000_000,
  maxFieldsPerRow: 1_000,
  maxFields: 4_000_000,
}

const TAB = 9
const LF = 10
const CR = 13
const QUOTE = 34

/** 区切り(タブ・改行)か */
function isDelimiter(code: number): boolean {
  return code === TAB || code === LF || code === CR
}

/**
 * タブ区切り(欄を二重引用符で囲める形式)を行・列に分ける。EDINET の CSV は
 * 欄を "..." で囲み、中に改行やタブを含む長い文章も入るので、引用符を正しく読む。
 * 次のときは null を返す(読み取りを諦める): 行数が maxRows を超えた、欄が大きすぎる・多すぎる、
 * 引用符が閉じていない。
 */
export function parseTsv(
  text: string,
  maxRows: number,
  limits: TsvLimits = DEFAULT_TSV_LIMITS,
): string[][] | null {
  const rows: string[][] = []
  const length = text.length
  let totalFields = 0
  let i = 0

  while (i < length) {
    // 空行は飛ばす
    if (text.charCodeAt(i) === LF || text.charCodeAt(i) === CR) {
      i += 1
      continue
    }
    if (rows.length >= maxRows) {
      return null
    }
    const row: string[] = []
    // 1 行ぶんの欄を読む
    for (;;) {
      const parsed = readField(text, i, limits.maxFieldChars)
      if (parsed === null) {
        return null
      }
      row.push(parsed.value)
      i = parsed.next
      totalFields += 1
      if (row.length > limits.maxFieldsPerRow || totalFields > limits.maxFields) {
        return null
      }
      if (i < length && text.charCodeAt(i) === TAB) {
        i += 1
        continue
      }
      break
    }
    rows.push(row)
  }
  return rows
}

interface Field {
  readonly value: string
  /** この欄の直後(区切りの位置、または末尾) */
  readonly next: number
}

/** 位置 start から 1 つの欄を読む。引用符が閉じていない・大きすぎるときは null */
function readField(text: string, start: number, maxChars: number): Field | null {
  const length = text.length
  const pieces: string[] = []
  let size = 0
  let i = start

  if (text.charCodeAt(i) === QUOTE) {
    // 引用符で囲まれた欄。"" は引用符 1 文字を表す
    i += 1
    for (;;) {
      const close = text.indexOf('"', i)
      if (close < 0) {
        return null
      }
      pieces.push(text.slice(i, close))
      size += close - i
      if (size > maxChars) {
        return null
      }
      if (text.charCodeAt(close + 1) === QUOTE) {
        pieces.push('"')
        size += 1
        i = close + 2
        continue
      }
      i = close + 1
      break
    }
  }

  // 引用符のあとに文字が続く場合や、引用符なしの欄は、区切りまでをそのまま読む
  const from = i
  while (i < length && !isDelimiter(text.charCodeAt(i))) {
    i += 1
  }
  pieces.push(text.slice(from, i))
  size += i - from
  if (size > maxChars) {
    return null
  }
  return { value: pieces.length === 1 ? pieces[0] : pieces.join(''), next: i }
}

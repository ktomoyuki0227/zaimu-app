/** EDINET に関する書式の判定(サーバー側の複数のファイルで共通) */

/** 書類管理番号(例: S100ABCD) */
export const DOC_ID = /^S[0-9A-Z]{7}$/
/** EDINET コード(例: E01234) */
export const EDINET_CODE = /^E\d{5}$/
/** 日付(YYYY-MM-DD) */
export const DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** 1 日のミリ秒 */
export const DAY_MS = 86_400_000

/** 実在する日付(YYYY-MM-DD)か。13 月や 2 月 30 日は false */
export function isRealDate(date: string): boolean {
  const m = DATE.exec(date)
  if (m === null) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

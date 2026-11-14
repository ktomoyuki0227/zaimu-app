/** 入力・保存データの上限。画面が重くなる・計算が桁あふれするのを防ぐ */
export const MAX_ABS_AMOUNT = 1e15
export const MAX_TEXT_LENGTH = 100
export const MAX_PERIODS = 20

/**
 * ファイル取り込みの上限。ファイルは信頼できない入力なので、メモリを食い尽くされないよう
 * 読み込む前・展開しながら数えて制限する。テストでは小さい値に差し替えて試す。
 */
export interface ImportLimits {
  /** 受け付けるファイル 1 つの大きさ(バイト) */
  readonly maxFileBytes: number
  /** zip の展開後の合計(バイト) */
  readonly maxUnzippedBytes: number
  /** zip の中の 1 ファイルの展開後の大きさ(バイト) */
  readonly maxEntryBytes: number
  /** zip の中のファイル数 */
  readonly maxZipEntries: number
  /** CSV の行数 */
  readonly maxCsvRows: number
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxFileBytes: 20 * 1024 * 1024,
  maxUnzippedBytes: 100 * 1024 * 1024,
  maxEntryBytes: 30 * 1024 * 1024,
  maxZipEntries: 2000,
  maxCsvRows: 300_000,
}

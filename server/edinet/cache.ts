import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isListedDocument, type ListedDocument } from './documents.ts'
import { DATE, DOC_ID } from './patterns.ts'

/**
 * 取得結果の、ディスク上のキャッシュ。
 * - 日付ごとの書類一覧(有価証券報告書とその訂正だけ)。過去の日の一覧は変わらないので、二度調べない
 * - 書類(CSV の zip)
 * ファイル名は、書式を確かめた日付・書類管理番号だけから作る(パスをたどる文字を通さない)。
 * ディスクから読んだ値は、サイズと形を確かめてから使う(ほかのプロセスが置いたファイルを信用しない)。
 */
export interface EdinetCache {
  readonly getDay: (date: string) => Promise<ListedDocument[] | null>
  readonly putDay: (date: string, documents: readonly ListedDocument[]) => Promise<void>
  readonly getZip: (docID: string) => Promise<Uint8Array | null>
  readonly putZip: (docID: string, bytes: Uint8Array) => Promise<void>
}

const FORMAT_VERSION = 1
/** 日別の一覧(JSON)の、読み込む大きさの上限 */
const MAX_DAY_BYTES = 20 * 1024 * 1024
/** 書類(zip)の、読み込む大きさの上限(取得時の上限と同じ) */
const MAX_ZIP_BYTES = 30 * 1024 * 1024

/** 保存しておく書類(zip)の合計の大きさの上限。超えたら、古いものから消す(取り直せばよいだけ) */
const DEFAULT_MAX_TOTAL_ZIP_BYTES = 300 * 1024 * 1024
/** 書き込み途中で途切れた一時ファイルを、消してよいとみなすまでの時間 */
const STALE_TEMP_MS = 60 * 60_000

const RENAME_RETRIES = 5
const RENAME_RETRY_DELAY_MS = 20

/** 同じ名前への置き換えが重なったとき(Windows では EPERM・EBUSY になる)は、少し待って、やり直す */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (!retryable || attempt >= RENAME_RETRIES) throw error
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS * (attempt + 1)))
    }
  }
}

/** 書き込み途中のファイルを見せないよう、別名で書いてから置き換える。同時に書いても、名前が重ならない */
async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, data)
    await renameWithRetry(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

/** 上限以内の大きさのファイルだけ読む。無い・大きすぎるときは null */
async function readSmallFile(path: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > maxBytes) return null
    return await readFile(path)
  } catch {
    return null
  }
}

/** 途中で途切れた一時ファイル(.tmp)のうち、古いものを消す。失敗しても無視する */
async function removeStaleTemps(directory: string, now: number): Promise<void> {
  const names = await readdir(directory).catch(() => [] as string[])
  await Promise.all(
    names
      .filter((name) => name.endsWith('.tmp'))
      .map(async (name) => {
        const path = join(directory, name)
        const info = await stat(path).catch(() => null)
        if (info !== null && now - info.mtimeMs > STALE_TEMP_MS) await unlink(path).catch(() => undefined)
      }),
  )
}

/** zip の合計が上限を超えていたら、古いもの(書き込みが古い順)から消す。いま書いた zip は残す */
async function evictOldZips(directory: string, keep: string, maxTotalBytes: number): Promise<void> {
  const names = (await readdir(directory).catch(() => [] as string[])).filter((n) => n.endsWith('.zip'))
  const files = (
    await Promise.all(
      names.map(async (name) => {
        const info = await stat(join(directory, name)).catch(() => null)
        return info === null || !info.isFile() ? [] : [{ name, size: info.size, mtime: info.mtimeMs }]
      }),
    )
  ).flat()
  let total = files.reduce((sum, f) => sum + f.size, 0)
  for (const file of files.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= maxTotalBytes) break
    if (file.name === keep) continue
    await unlink(join(directory, file.name)).catch(() => undefined)
    total -= file.size
  }
}

export interface FileCacheOptions {
  /** 保存しておく書類(zip)の合計の大きさの上限(バイト) */
  readonly maxTotalZipBytes?: number
  readonly now?: () => number
}

export function createFileCache(dir: string, options: FileCacheOptions = {}): EdinetCache {
  const { maxTotalZipBytes = DEFAULT_MAX_TOTAL_ZIP_BYTES, now = Date.now } = options
  const daysDir = join(dir, 'days')
  const zipsDir = join(dir, 'zips')
  let tempsCleaned = false

  return {
    async getDay(date) {
      if (!DATE.test(date)) return null
      const raw = await readSmallFile(join(daysDir, `${date}.json`), MAX_DAY_BYTES)
      if (raw === null) return null
      try {
        const parsed: unknown = JSON.parse(raw.toString('utf-8'))
        const record = parsed as { version?: unknown; documents?: unknown }
        if (record.version !== FORMAT_VERSION || !Array.isArray(record.documents)) return null
        return record.documents.every(isListedDocument) ? (record.documents as ListedDocument[]) : null
      } catch {
        // 壊れたキャッシュは無かったことにして、取り直す
        return null
      }
    },

    async putDay(date, documents) {
      if (!DATE.test(date)) throw new Error('日付の形式が正しくありません。')
      await mkdir(daysDir, { recursive: true })
      await atomicWrite(join(daysDir, `${date}.json`), JSON.stringify({ version: FORMAT_VERSION, documents }))
    },

    async getZip(docID) {
      if (!DOC_ID.test(docID)) return null
      const raw = await readSmallFile(join(zipsDir, `${docID}.zip`), MAX_ZIP_BYTES)
      // zip の先頭は "PK"。そうでないものは、壊れているとみなして取り直す
      if (raw === null || raw.length < 4 || raw[0] !== 0x50 || raw[1] !== 0x4b) return null
      return new Uint8Array(raw)
    },

    async putZip(docID, bytes) {
      if (!DOC_ID.test(docID)) throw new Error('書類管理番号の形式が正しくありません。')
      await mkdir(zipsDir, { recursive: true })
      await atomicWrite(join(zipsDir, `${docID}.zip`), bytes)
      // 掃除の失敗で、取得そのものは失敗させない
      if (!tempsCleaned) {
        tempsCleaned = true
        await removeStaleTemps(zipsDir, now())
        await removeStaleTemps(daysDir, now())
      }
      await evictOldZips(zipsDir, `${docID}.zip`, maxTotalZipBytes)
    },
  }
}

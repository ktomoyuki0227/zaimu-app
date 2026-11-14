import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { parseCodeListBytes, type CompanyEntry } from './codeList.ts'

/** 金融庁が公開している EDINET コードリスト(API キーは不要)。接続先はここだけ */
export const CODE_LIST_URL = 'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip'

const CSV_NAME = 'EdinetcodeDlInfo.csv'
const MAX_ZIP_BYTES = 10 * 1024 * 1024
const MAX_CSV_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_AGE_MS = 7 * 86_400_000
const TIMEOUT_MS = 60_000

export interface CodeListStore {
  /** コードリストを読む。キャッシュが新しければそれを使い、古ければ取り直す(取れなければ古いものを使う) */
  readonly load: () => Promise<readonly CompanyEntry[]>
}

export interface CodeListStoreOptions {
  readonly dir: string
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
  readonly maxAgeMs?: number
  /** CSV のバイト列を読む関数(テストで差し替える)。既定は Shift_JIS の読み取り */
  readonly parse?: (bytes: Uint8Array) => CompanyEntry[]
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function extractCsv(zip: Uint8Array): Uint8Array {
  const files = unzipSync(zip, { filter: (f) => f.name === CSV_NAME && f.originalSize <= MAX_CSV_BYTES })
  const csv = files[CSV_NAME]
  if (csv === undefined || csv.length > MAX_CSV_BYTES) {
    throw new Error('EDINET コードリストの zip に、想定したファイルが入っていません。')
  }
  return csv
}

export function createCodeListStore(options: CodeListStoreOptions): CodeListStore {
  const { dir, fetchImpl = fetch, now = Date.now, maxAgeMs = DEFAULT_MAX_AGE_MS, parse = parseCodeListBytes } = options
  const zipPath = join(dir, 'Edinetcode.zip')
  let memo: Promise<readonly CompanyEntry[]> | null = null
  let memoAt = 0

  const download = async (): Promise<Uint8Array> => {
    const response = await fetchImpl(CODE_LIST_URL, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`EDINET コードリストを取得できませんでした(HTTP ${response.status})。`)
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > MAX_ZIP_BYTES) throw new Error('EDINET コードリストが大きすぎます。')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > MAX_ZIP_BYTES || !isZip(bytes)) {
      throw new Error('EDINET コードリストの形式が想定と違います。')
    }
    await mkdir(dir, { recursive: true })
    const temp = `${zipPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, bytes)
      await rename(temp, zipPath)
    } catch (error) {
      await unlink(temp).catch(() => undefined)
      throw error
    }
    return bytes
  }

  const loadOnce = async (): Promise<readonly CompanyEntry[]> => {
    let cached: Uint8Array | null = null
    let fresh = false
    try {
      const info = await stat(zipPath)
      cached = new Uint8Array(await readFile(zipPath))
      fresh = now() - info.mtimeMs < maxAgeMs
    } catch {
      cached = null
    }
    /** キャッシュを読む。壊れていれば null(使わずに、取り直す) */
    const fromCache = (zip: Uint8Array): readonly CompanyEntry[] | null => {
      try {
        return parse(extractCsv(zip))
      } catch {
        return null
      }
    }
    if (cached !== null && fresh) {
      const list = fromCache(cached)
      if (list !== null) return list
    }
    try {
      return parse(extractCsv(await download()))
    } catch (error) {
      // 取り直せなくても、読める古いキャッシュがあれば使う(企業名と決算日の一覧は、頻繁には変わらない)
      const list = cached === null ? null : fromCache(cached)
      if (list !== null) return list
      throw error
    }
  }

  return {
    load: () => {
      // サーバーを起動したままでも、一定時間がたったら読み直す(新規上場・社名変更・決算日の変更に追随する)
      if (memo !== null && now() - memoAt >= maxAgeMs) memo = null
      if (memo === null) {
        memoAt = now()
        memo = loadOnce().catch((error: unknown) => {
          memo = null
          throw error
        })
      }
      return memo
    },
  }
}

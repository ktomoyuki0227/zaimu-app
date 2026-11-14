import { mkdir, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { createFileCache, type EdinetCache } from './cache.ts'
import type { ListedDocument } from './documents.ts'

const DOC: ListedDocument = {
  docID: 'S100AAAA',
  edinetCode: 'E90001',
  secCode: '12340',
  filerName: 'サンプル製作所株式会社',
  docTypeCode: '120',
  periodEnd: '2025-03-31',
  submitDateTime: '2025-06-27 15:00',
  csvFlag: '1',
  withdrawalStatus: '0',
}

let dir: string
let cache: EdinetCache

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edinet-cache-test-'))
  cache = createFileCache(dir)
})

describe('createFileCache: 日付ごとの書類一覧', () => {
  test('保存した一覧を、同じ内容で読み戻せる', async () => {
    await cache.putDay('2025-06-27', [DOC])
    expect(await cache.getDay('2025-06-27')).toEqual([DOC])
  })

  test('0 件の日も「調べ済み」として残せる(空の配列と、未調査の null を区別する)', async () => {
    expect(await cache.getDay('2025-06-28')).toBeNull()
    await cache.putDay('2025-06-28', [])
    expect(await cache.getDay('2025-06-28')).toEqual([])
  })

  test('壊れたキャッシュ・形の違うキャッシュは、無かったものとして扱う', async () => {
    await mkdir(join(dir, 'days'), { recursive: true })
    await writeFile(join(dir, 'days', '2025-06-27.json'), '{broken')
    await writeFile(join(dir, 'days', '2025-06-26.json'), JSON.stringify({ version: 1, documents: [{ docID: 'x' }] }))
    await writeFile(join(dir, 'days', '2025-06-25.json'), JSON.stringify({ version: 99, documents: [] }))
    expect(await cache.getDay('2025-06-27')).toBeNull()
    expect(await cache.getDay('2025-06-26')).toBeNull()
    expect(await cache.getDay('2025-06-25')).toBeNull()
  })

  test('日付の書式でない値は、ファイルを作らず・読まない(パスをたどらせない)', async () => {
    expect(await cache.getDay('../../secret')).toBeNull()
    await expect(cache.putDay('../x', [])).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })
})

describe('createFileCache: 書類', () => {
  test('保存した zip を、同じバイト列で読み戻せる', async () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 3, 4, 9, 8, 7])
    await cache.putZip('S100AAAA', bytes)
    expect(Array.from((await cache.getZip('S100AAAA')) ?? [])).toEqual(Array.from(bytes))
  })

  test('未保存なら null', async () => {
    expect(await cache.getZip('S100AAAA')).toBeNull()
  })

  test('書類管理番号の書式でない値は、読まない・書かない', async () => {
    expect(await cache.getZip('../x')).toBeNull()
    await expect(cache.putZip('../x', Uint8Array.from([1]))).rejects.toThrow()
  })
})

describe('createFileCache: 読み込むファイルの検査', () => {
  test('zip の先頭が PK でないファイルは、壊れているとみなして null', async () => {
    await mkdir(join(dir, 'zips'), { recursive: true })
    await writeFile(join(dir, 'zips', 'S100AAAA.zip'), 'not a zip')
    expect(await cache.getZip('S100AAAA')).toBeNull()
  })

  test('大きすぎるファイルは、読まずに null(巨大なファイルを置かれても、メモリを使わない)', async () => {
    await mkdir(join(dir, 'zips'), { recursive: true })
    await mkdir(join(dir, 'days'), { recursive: true })
    const big = Buffer.alloc(31 * 1024 * 1024, 0)
    big[0] = 0x50
    big[1] = 0x4b
    await writeFile(join(dir, 'zips', 'S100BBBB.zip'), big)
    expect(await cache.getZip('S100BBBB')).toBeNull()
    await writeFile(join(dir, 'days', '2025-06-27.json'), Buffer.alloc(21 * 1024 * 1024, 0x20))
    expect(await cache.getDay('2025-06-27')).toBeNull()
  })

  test('同じものを同時に保存しても、失敗しない(一時ファイルの名前が重ならない)', async () => {
    const bytes = Uint8Array.from([0x50, 0x4b, 3, 4, 1])
    await Promise.all(Array.from({ length: 8 }, () => cache.putZip('S100AAAA', bytes)))
    await Promise.all(Array.from({ length: 8 }, () => cache.putDay('2025-06-27', [DOC])))
    expect(await cache.getDay('2025-06-27')).toEqual([DOC])
    expect(Array.from((await cache.getZip('S100AAAA')) ?? [])).toEqual(Array.from(bytes))
  })

  test('保存に失敗したときは、一時ファイルを残さない', async () => {
    // days をファイルにして、フォルダを作れない状態にする
    await writeFile(join(dir, 'days'), 'file, not a directory')
    await expect(cache.putDay('2025-06-27', [DOC])).rejects.toThrow()
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})

describe('createFileCache: 書類(zip)の保存量の上限と掃除', () => {
  const zip = (n: number): Uint8Array => {
    const bytes = new Uint8Array(n)
    bytes[0] = 0x50
    bytes[1] = 0x4b
    return bytes
  }

  test('合計が上限を超えたら、古いもの(書き込みが古い順)から消す。いま保存したものは残る', async () => {
    const small = createFileCache(dir, { maxTotalZipBytes: 250 })
    const zipsDir = join(dir, 'zips')
    await small.putZip('S100AAAA', zip(100))
    await small.putZip('S100BBBB', zip(100))
    // 書き込みの古さは、ファイルの時刻で、はっきり決める(時計の細かさに頼らない)
    await utimes(join(zipsDir, 'S100AAAA.zip'), new Date('2020-01-01'), new Date('2020-01-01'))
    await utimes(join(zipsDir, 'S100BBBB.zip'), new Date('2021-01-01'), new Date('2021-01-01'))
    await small.putZip('S100CCCC', zip(100))
    expect(await small.getZip('S100AAAA')).toBeNull()
    expect(await small.getZip('S100BBBB')).not.toBeNull()
    expect(await small.getZip('S100CCCC')).not.toBeNull()
  })

  test('1 つが上限より大きくても、いま保存したものは消さない(取得を無駄にしない)', async () => {
    const tiny = createFileCache(dir, { maxTotalZipBytes: 10 })
    await tiny.putZip('S100AAAA', zip(100))
    expect(await tiny.getZip('S100AAAA')).not.toBeNull()
  })

  test('途中で途切れた古い一時ファイル(.tmp)は、保存のついでに消す。新しいものは消さない', async () => {
    const zipsDir = join(dir, 'zips')
    await mkdir(zipsDir, { recursive: true })
    const oldTemp = join(zipsDir, 'S100OLD0.zip.aaaa.tmp')
    const newTemp = join(zipsDir, 'S100NEW0.zip.bbbb.tmp')
    await writeFile(oldTemp, 'x')
    await writeFile(newTemp, 'x')
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000)
    await utimes(oldTemp, twoHoursAgo, twoHoursAgo)
    await createFileCache(dir).putZip('S100AAAA', zip(10))
    const names = await readdir(zipsDir)
    expect(names).not.toContain('S100OLD0.zip.aaaa.tmp')
    expect(names).toContain('S100NEW0.zip.bbbb.tmp')
  })
})

import { mkdtemp, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { beforeEach, describe, expect, test } from 'vitest'
import { parseCodeListText } from './codeList.ts'
import { CODE_LIST_URL, createCodeListStore } from './codeListStore.ts'

const CSV = [
  'ダウンロード実行日,2026年11月13日現在,件数,1件',
  'ＥＤＩＮＥＴコード,提出者種別,上場区分,連結の有無,資本金,決算日,提出者名,提出者名（英字）,提出者名（ヨミ）,所在地,提出者業種,証券コード,提出者法人番号',
  'E90001,内国法人・組合,上場,有,100000,3月31日,サンプル製作所株式会社,SAMPLE,サンプル,東京都,機械,12340,1',
].join('\n')

/** テストでは UTF-8 の CSV を使う(Shift_JIS のバイト列は、この環境では作れない) */
const parseUtf8 = (bytes: Uint8Array) => parseCodeListText(new TextDecoder('utf-8').decode(bytes))

function codeListZip(): Uint8Array {
  return zipSync({ 'EdinetcodeDlInfo.csv': strToU8(CSV) })
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'edinet-codelist-test-'))
})

function countingFetch(respond: () => Response) {
  const urls: string[] = []
  const inits: (RequestInit | undefined)[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input))
    inits.push(init)
    return respond()
  }) as typeof fetch
  return { fetchImpl, urls, inits }
}

describe('createCodeListStore', () => {
  test('初回は公式の URL から取得して保存し、提出者の一覧を返す', async () => {
    const { fetchImpl, urls, inits } = countingFetch(() => new Response(codeListZip()))
    const store = createCodeListStore({ dir, fetchImpl, parse: parseUtf8 })
    const list = await store.load()
    expect(list.map((c) => c.edinetCode)).toEqual(['E90001'])
    expect(urls).toEqual([CODE_LIST_URL])
    expect(inits[0]?.redirect).toBe('error')
  })

  test('同じ store で何度読んでも、取得は 1 回', async () => {
    const { fetchImpl, urls } = countingFetch(() => new Response(codeListZip()))
    const store = createCodeListStore({ dir, fetchImpl, parse: parseUtf8 })
    await Promise.all([store.load(), store.load()])
    await store.load()
    expect(urls).toHaveLength(1)
  })

  test('保存したキャッシュが新しければ、取得しない', async () => {
    const first = countingFetch(() => new Response(codeListZip()))
    await createCodeListStore({ dir, fetchImpl: first.fetchImpl, parse: parseUtf8 }).load()
    const second = countingFetch(() => new Response('x', { status: 500 }))
    const list = await createCodeListStore({ dir, fetchImpl: second.fetchImpl, parse: parseUtf8 }).load()
    expect(list).toHaveLength(1)
    expect(second.urls).toEqual([])
  })

  test('キャッシュが古ければ取り直し、取り直せなければ古いものを使う', async () => {
    const first = countingFetch(() => new Response(codeListZip()))
    await createCodeListStore({ dir, fetchImpl: first.fetchImpl, parse: parseUtf8 }).load()
    const old = new Date(Date.now() - 30 * 86_400_000)
    await utimes(join(dir, 'Edinetcode.zip'), old, old)

    const failing = countingFetch(() => new Response('x', { status: 503 }))
    const list = await createCodeListStore({ dir, fetchImpl: failing.fetchImpl, parse: parseUtf8 }).load()
    expect(list).toHaveLength(1)
    expect(failing.urls).toHaveLength(1) // 取り直しは試みた
  })

  test('キャッシュが無く、取得にも失敗したら、例外(次の呼び出しでは取り直せる)', async () => {
    let ok = false
    const { fetchImpl } = countingFetch(() => (ok ? new Response(codeListZip()) : new Response('x', { status: 503 })))
    const store = createCodeListStore({ dir, fetchImpl, parse: parseUtf8 })
    await expect(store.load()).rejects.toThrow()
    ok = true
    expect(await store.load()).toHaveLength(1)
  })

  test('zip でない応答・想定したファイルが入っていない zip は、受け付けない', async () => {
    const html = countingFetch(() => new Response('<html></html>'))
    await expect(createCodeListStore({ dir, fetchImpl: html.fetchImpl, parse: parseUtf8 }).load()).rejects.toThrow()
    const other = countingFetch(() => new Response(zipSync({ 'other.csv': strToU8('a') })))
    const dir2 = await mkdtemp(join(tmpdir(), 'edinet-codelist-test-'))
    await expect(createCodeListStore({ dir: dir2, fetchImpl: other.fetchImpl, parse: parseUtf8 }).load()).rejects.toThrow()
  })

  test('壊れたキャッシュ(zip でない)は、取り直す', async () => {
    await writeFile(join(dir, 'Edinetcode.zip'), 'broken')
    const { fetchImpl, urls } = countingFetch(() => new Response(codeListZip()))
    const list = await createCodeListStore({ dir, fetchImpl, parse: parseUtf8 }).load()
    expect(list).toHaveLength(1)
    expect(urls).toHaveLength(1)
  })

  test('サーバーを起動したままでも、期限(7 日)を過ぎたら読み直す', async () => {
    let clock = 1_000_000
    const { fetchImpl, urls } = countingFetch(() => new Response(codeListZip()))
    // ファイルの更新日時は実際の時計で付くので、模擬した時計(now)も実際の時刻に合わせる
    const base = Date.now()
    clock = base
    const store = createCodeListStore({ dir, fetchImpl, parse: parseUtf8, now: () => clock })
    await store.load()
    clock = base + 6 * 86_400_000
    await store.load()
    expect(urls).toHaveLength(1) // 6 日後は、まだメモ(7 日以内)を使う
    clock = base + 8 * 86_400_000
    await store.load()
    expect(urls).toHaveLength(2) // 8 日後は、メモもファイルも古いので、取り直す
  })
})

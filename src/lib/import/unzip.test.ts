import { strToU8, zipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import { DEFAULT_IMPORT_LIMITS } from '../../domain/limits'
import { extractCsvFromZip } from './unzip'

const LIMITS = DEFAULT_IMPORT_LIMITS

function zip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files)
}

describe('extractCsvFromZip', () => {
  test('zip の中の CSV を取り出す', () => {
    const result = extractCsvFromZip(zip({ 'XBRL_TO_CSV/jpcrp030000-asr-001.csv': strToU8('hello') }), LIMITS)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new TextDecoder().decode(result.csv)).toBe('hello')
    expect(result.name).toBe('XBRL_TO_CSV/jpcrp030000-asr-001.csv')
  })

  test('CSV が複数あれば、有価証券報告書(jpcrp…asr)のものを選ぶ', () => {
    const result = extractCsvFromZip(
      zip({
        'a/other.csv': strToU8('other'),
        'b/jpcrp030000-asr-001.csv': strToU8('main'),
        'c/jpcrp040300-q1r.csv': strToU8('quarter'),
      }),
      LIMITS,
    )
    if (!result.ok) throw new Error(result.reason)
    expect(new TextDecoder().decode(result.csv)).toBe('main')
  })

  test('CSV 以外のファイルは展開しない(中身を読まない)', () => {
    const result = extractCsvFromZip(
      zip({ 'readme.txt': strToU8('x'.repeat(10_000)), 'data.csv': strToU8('ok') }),
      { ...LIMITS, maxEntryBytes: 100 },
    )
    expect(result.ok).toBe(true)
  })

  test('CSV が無ければ、XBRL・Excel は未対応と知らせる', () => {
    const result = extractCsvFromZip(zip({ 'PublicDoc/a.xbrl': strToU8('<xbrl/>') }), LIMITS)
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) expect(result.reason).toContain('CSV')
  })

  test('zip でないデータ・壊れた zip は、例外にせず読めないと知らせる', () => {
    expect(extractCsvFromZip(strToU8('not a zip at all'), LIMITS)).toMatchObject({ ok: false })
    const broken = zip({ 'a.csv': strToU8('hello world') }).slice(0, 25)
    expect(extractCsvFromZip(broken, LIMITS)).toMatchObject({ ok: false })
  })

  test('展開後の 1 ファイルが上限を超えたら中断する(zip 爆弾)', () => {
    const bomb = zip({ 'bomb.csv': new Uint8Array(5 * 1024 * 1024) })
    expect(bomb.length).toBeLessThan(50_000) // よく縮む
    const result = extractCsvFromZip(bomb, { ...LIMITS, maxEntryBytes: 1024 * 1024 })
    expect(result).toMatchObject({ ok: false })
  })

  test('圧縮率が極端に高い zip(約 1000 倍)でも、上限で止まる', () => {
    // 64MB に展開される zip。zip 全体を一度に展開すると、上限(1MB)を確認する前に 64MB が確保される
    const bomb = zip({ 'bomb.csv': new Uint8Array(64 * 1024 * 1024) })
    expect(bomb.length).toBeLessThan(200_000)
    const started = Date.now()
    const result = extractCsvFromZip(bomb, { ...LIMITS, maxEntryBytes: 1024 * 1024 })
    expect(result).toMatchObject({ ok: false })
    expect(Date.now() - started).toBeLessThan(3_000)
    // zip の作成(圧縮)に時間がかかる環境(カバレッジ計測つきなど)でも時間切れにならないよう、余裕を持たせる
  }, 60_000)

  test('優先度の高い CSV があれば、ほかの大きな CSV は展開しない', () => {
    const result = extractCsvFromZip(
      zip({
        'a/jpcrp030000-asr-001.csv': strToU8('main'),
        'b/other.csv': new Uint8Array(2 * 1024 * 1024),
      }),
      { ...LIMITS, maxEntryBytes: 1024 },
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(new TextDecoder().decode(result.csv)).toBe('main')
  })

  test('展開後の合計が上限を超えたら中断する', () => {
    const result = extractCsvFromZip(
      zip({ 'a.csv': new Uint8Array(600_000), 'b.csv': new Uint8Array(600_000) }),
      { ...LIMITS, maxUnzippedBytes: 1_000_000 },
    )
    expect(result).toMatchObject({ ok: false })
  })

  test('ファイル数が上限を超えたら読まない', () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 6; i += 1) files[`f${i}.csv`] = strToU8('x')
    expect(extractCsvFromZip(zip(files), { ...LIMITS, maxZipEntries: 5 })).toMatchObject({ ok: false })
  })
})

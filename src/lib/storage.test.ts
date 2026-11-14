import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { basePeriod } from '../domain/fixtures'
import type { Company } from '../domain/types'
import { loadCompanies, saveCompanies } from './storage'

/** ブラウザの localStorage の代わり(テストは Node で動かすため) */
class FakeStorage {
  readonly data = new Map<string, string>()
  throwOnRead = false
  throwOnWrite = false
  getItem(key: string): string | null {
    if (this.throwOnRead) throw new Error('blocked')
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.throwOnWrite) throw new Error('quota')
    this.data.set(key, value)
  }
}

const company: Company = { id: 'edinet-E12345', name: 'テスト社', unit: '百万円', periods: [basePeriod] }
const PORTFOLIO_KEY = 'zaimu-view:portfolio:v2'
const LEGACY_KEY = 'zaimu-view:company:v1'
const BACKUP_KEY = 'zaimu-view:portfolio:backup'
const PREVIOUS_BACKUP_KEY = 'zaimu-view:portfolio:backup:previous'

let storage: FakeStorage

beforeEach(() => {
  storage = new FakeStorage()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadCompanies / saveCompanies', () => {
  test('保存が無ければ none(初回)', () => {
    expect(loadCompanies()).toEqual({ status: 'none' })
  })

  test('保存したものを、そのまま読み戻せる(往復)', () => {
    expect(saveCompanies([company])).toBe(true)
    const loaded = loadCompanies()
    expect(loaded.status).toBe('ok')
    if (loaded.status === 'ok') expect(loaded.companies).toEqual([company])
  })

  test('壊れた保存データは corrupted にして、元の文字列を退避する(次の保存で消えないように)', () => {
    storage.data.set(PORTFOLIO_KEY, '{"version":2,"companies":[{"id":"x"}]}')
    expect(loadCompanies()).toEqual({ status: 'corrupted' })
    expect(storage.data.get(BACKUP_KEY)).toBe('{"version":2,"companies":[{"id":"x"}]}')
  })

  test('壊れた状態が続けて起きても、最初の退避は残る(退避は 2 つまで)', () => {
    storage.data.set(PORTFOLIO_KEY, '{first')
    loadCompanies()
    storage.data.set(PORTFOLIO_KEY, '{second')
    loadCompanies()
    expect(storage.data.get(BACKUP_KEY)).toBe('{second')
    expect(storage.data.get(PREVIOUS_BACKUP_KEY)).toBe('{first')
  })

  test('同じ内容の退避を、繰り返しても、1 つ前の退避を消さない', () => {
    storage.data.set(PORTFOLIO_KEY, '{same')
    loadCompanies()
    loadCompanies()
    expect(storage.data.get(BACKUP_KEY)).toBe('{same')
    expect(storage.data.has(PREVIOUS_BACKUP_KEY)).toBe(false)
  })

  test('JSON として読めない保存データも corrupted(例外にしない)', () => {
    storage.data.set(PORTFOLIO_KEY, '{not json')
    expect(loadCompanies()).toEqual({ status: 'corrupted' })
  })

  test('旧い形式(1 社分)は、企業の一覧に引き継ぐ', () => {
    storage.data.set(LEGACY_KEY, JSON.stringify(company))
    const loaded = loadCompanies()
    expect(loaded.status).toBe('ok')
    if (loaded.status === 'ok') expect(loaded.companies.map((c) => c.id)).toEqual(['edinet-E12345'])
  })

  test('旧い形式の練習用データ(id が sample)は引き継がない', () => {
    storage.data.set(LEGACY_KEY, JSON.stringify({ ...company, id: 'sample' }))
    expect(loadCompanies()).toEqual({ status: 'none' })
  })

  test('旧い形式が壊れていれば corrupted にして退避する', () => {
    storage.data.set(LEGACY_KEY, '{"id":1}')
    expect(loadCompanies()).toEqual({ status: 'corrupted' })
    expect(storage.data.get(BACKUP_KEY)).toBe('{"id":1}')
  })

  test('新しい形式があれば、旧い形式は読まない', () => {
    saveCompanies([company])
    storage.data.set(LEGACY_KEY, JSON.stringify({ ...company, id: 'edinet-E99999' }))
    const loaded = loadCompanies()
    if (loaded.status !== 'ok') throw new Error('読めませんでした')
    expect(loaded.companies.map((c) => c.id)).toEqual(['edinet-E12345'])
  })

  test('保存領域を使えないブラウザ(読み取りで例外)は unavailable', () => {
    storage.throwOnRead = true
    expect(loadCompanies()).toEqual({ status: 'unavailable' })
  })

  test('書き込めない(容量超過・使用禁止)ときは、例外にせず false を返す', () => {
    storage.throwOnWrite = true
    expect(saveCompanies([company])).toBe(false)
  })

  test('壊れたデータの退避に失敗しても、corrupted を返す(画面を止めない)', () => {
    storage.data.set(PORTFOLIO_KEY, '{not json')
    storage.throwOnWrite = true
    expect(loadCompanies()).toEqual({ status: 'corrupted' })
  })
})

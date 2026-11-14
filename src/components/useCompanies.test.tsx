// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SAMPLE_COMPANY } from '../data/sample'
import { PORTFOLIO_VERSION } from '../domain/validate'
import { useCompanies } from './useCompanies'

const KEY = 'zaimu-view:portfolio:v2'
const other = { ...SAMPLE_COMPANY, id: 'edinet-E00002', name: '別の会社' }

const write = (companies: readonly unknown[]): void =>
  window.localStorage.setItem(KEY, JSON.stringify({ version: PORTFOLIO_VERSION, companies }))

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useCompanies', () => {
  test('保存が無ければ空で始まり、知らせも出さない', () => {
    const { result } = renderHook(() => useCompanies())
    expect(result.current.companies).toEqual([])
    expect(result.current.saveFailed).toBe(false)
    expect(result.current.showCorruptedNotice).toBe(false)
  })

  test('保存してある企業を、起動時に読む', () => {
    write([SAMPLE_COMPANY])
    const { result } = renderHook(() => useCompanies())
    expect(result.current.companies.map((c) => c.id)).toEqual([SAMPLE_COMPANY.id])
  })

  test('update は、一覧を置き換えて保存する', () => {
    const { result } = renderHook(() => useCompanies())
    act(() => result.current.update([SAMPLE_COMPANY]))
    expect(result.current.companies).toHaveLength(1)
    expect(window.localStorage.getItem(KEY)).toContain(SAMPLE_COMPANY.id)
    expect(result.current.saveFailed).toBe(false)
  })

  test('保存に失敗したら saveFailed を立てる(一覧は、画面の上では更新される)。成功したら戻る', () => {
    const { result } = renderHook(() => useCompanies())
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    act(() => result.current.update([SAMPLE_COMPANY]))
    expect(result.current.saveFailed).toBe(true)
    expect(result.current.companies).toHaveLength(1)
    spy.mockRestore()
    act(() => result.current.update([SAMPLE_COMPANY, other]))
    expect(result.current.saveFailed).toBe(false)
  })

  test('壊れた保存データなら、空で始めて知らせ、閉じられる', () => {
    window.localStorage.setItem(KEY, '{broken')
    const { result } = renderHook(() => useCompanies())
    expect(result.current.companies).toEqual([])
    expect(result.current.showCorruptedNotice).toBe(true)
    act(() => result.current.dismissCorruptedNotice())
    expect(result.current.showCorruptedNotice).toBe(false)
  })

  test('別のタブが書き換えたら追随し、保存領域が消されたら空になる', () => {
    const { result } = renderHook(() => useCompanies())
    write([SAMPLE_COMPANY, other])
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    })
    expect(result.current.companies.map((c) => c.id)).toEqual([SAMPLE_COMPANY.id, other.id])
    window.localStorage.clear()
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(result.current.companies).toEqual([])
  })

  test('別のタブの内容が壊れていたら、いま見えている内容を変えない', () => {
    write([SAMPLE_COMPANY])
    const { result } = renderHook(() => useCompanies())
    window.localStorage.setItem(KEY, '{broken')
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    })
    expect(result.current.companies).toHaveLength(1)
  })

  test('画面を離れたら、イベントの購読を外す(外さないと、離れた画面の状態を更新し続ける)', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useCompanies())
    unmount()
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function))
  })
})

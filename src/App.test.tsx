// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import App from './App'
import { SAMPLE_COMPANY } from './data/sample'
import { buildCsvText, encodeUtf16le, fixtureRows } from './domain/import/testing/edinetFixture'
import { MAX_COMPANIES } from './domain/portfolio'
import type { Company } from './domain/types'
import { PORTFOLIO_VERSION } from './domain/validate'

const PORTFOLIO_KEY = 'zaimu-view:portfolio:v2'

function store(companies: readonly Company[]): void {
  window.localStorage.setItem(PORTFOLIO_KEY, JSON.stringify({ version: PORTFOLIO_VERSION, companies }))
}

beforeEach(() => {
  window.localStorage.clear()
  window.scrollTo = vi.fn() as typeof window.scrollTo
  // EDINET の中継は無い(公開用の配信と同じ)状態にする
  vi.stubGlobal('fetch', () => Promise.reject(new Error('no relay')))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** CSV(UTF-16)のファイルを、ファイル選択の欄に渡す */
async function pickFile(file: File): Promise<void> {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => {
    fireEvent.change(input)
  })
}

function csvFile(name: string, options = {}): File {
  return new File([encodeUtf16le(buildCsvText(fixtureRows(options)))], name, { type: 'text/csv' })
}

describe('App: 練習用データと一覧', () => {
  test('最初は企業が無く、練習用データを開くと、その企業の分析ページ(概要)に移る', async () => {
    render(<App />)
    expect(screen.getByText('まだありません', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByText('練習用データで試す'))
    expect(await screen.findByRole('heading', { level: 1, name: SAMPLE_COMPANY.name })).toBeTruthy()
    // 取り込みは保存される
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).toContain(SAMPLE_COMPANY.id)
  })

  test('「企業の一覧へ」で一覧に戻り、企業のカードが並ぶ', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('練習用データで試す'))
    fireEvent.click(await screen.findByText('← 企業の一覧へ'))
    const list = await screen.findByRole('heading', { level: 2, name: /取り込んだ企業/ })
    expect(list).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: SAMPLE_COMPANY.name })).toBeTruthy()
  })

  test('タブを切り替えられる(概要 → 成長性 → 収益性 → 安定性)', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('練習用データで試す'))
    const nav = await screen.findByRole('navigation', { name: '表示する内容' })
    for (const name of ['成長性', '収益性', '安定性', '概要']) {
      fireEvent.click(within(nav).getByRole('button', { name: new RegExp(name) }))
      expect(within(nav).getByRole('button', { name: new RegExp(name) }).getAttribute('aria-current')).toBe('page')
    }
  })

  test('削除は、確認で「はい」のときだけ消す', async () => {
    store([SAMPLE_COMPANY])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /を一覧から削除/ }))
    expect(screen.queryByRole('heading', { level: 3, name: SAMPLE_COMPANY.name })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /を一覧から削除/ }))
    await waitFor(() => expect(screen.queryByRole('heading', { level: 3, name: SAMPLE_COMPANY.name })).toBeNull())
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).not.toContain(SAMPLE_COMPANY.id)
  })

  test('企業の数が上限のとき、新しい企業(練習用データ)は足さず、理由を知らせる', async () => {
    store(Array.from({ length: MAX_COMPANIES }, (_, i) => ({ ...SAMPLE_COMPANY, id: `c${i}`, name: `社${i}` })))
    render(<App />)
    fireEvent.click(screen.getByText('練習用データで試す'))
    expect(await screen.findByText(/最大 30 社まで/)).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: SAMPLE_COMPANY.name })).toBeNull()
  })
})

describe('App: ファイルの取り込みと取り消し', () => {
  test('確認の要らないファイルは、そのまま反映して分析ページに移り、「元に戻す」で取り消せる', async () => {
    render(<App />)
    await pickFile(csvFile('決算.csv'))
    expect(await screen.findByRole('heading', { level: 1, name: 'サンプル製作所(架空)' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /元に戻す/ }))
    expect(await screen.findByText('読み込みを取り消し、元の状態に戻しました。', { exact: false })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 3, name: 'サンプル製作所(架空)' })).toBeNull()
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).not.toContain('サンプル製作所')
  })

  test('取り込んだあとに、別のタブが一覧を書き換えたら、「元に戻す」は出さない(古い状態で、他のタブの内容を消さない)', async () => {
    render(<App />)
    await pickFile(csvFile('決算.csv'))
    expect(await screen.findByRole('button', { name: /元に戻す/ })).toBeTruthy()
    // 別のタブが、企業を足した
    const current = JSON.parse(window.localStorage.getItem(PORTFOLIO_KEY) ?? '{}') as { companies: Company[] }
    store([...current.companies, { ...SAMPLE_COMPANY, id: 'edinet-E00009', name: '別のタブの会社' }])
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: PORTFOLIO_KEY }))
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: /元に戻す/ })).toBeNull())
    // 別のタブの会社は、このタブにも残っている
    fireEvent.click(screen.getByText('← 企業の一覧へ'))
    expect(await screen.findByRole('heading', { level: 3, name: '別のタブの会社' })).toBeTruthy()
  })

  test('同じ企業(EDINET コード)の別の年度を取り込むと、期が増える(企業は 1 社のまま)', async () => {
    render(<App />)
    await pickFile(csvFile('2025.csv'))
    await screen.findByRole('heading', { level: 1, name: 'サンプル製作所(架空)' })
    fireEvent.click(screen.getByText('← 企業の一覧へ'))
    await pickFile(csvFile('2026.csv', { currentEnd: '2026-03-31' }))
    await screen.findByRole('heading', { level: 1, name: 'サンプル製作所(架空)' })
    expect(screen.getByText(/3 期分/)).toBeTruthy()
    fireEvent.click(screen.getByText('← 企業の一覧へ'))
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
  })

  test('単体の期のあとに連結の書類を取り込むと、範囲の切り替わりを知らせ、切り替わりの前後の増減は出さない', async () => {
    render(<App />)
    // 2025 年 3 月期の単体(2024・2025 年 3 月期)のあと、2026 年 3 月期の連結(2025・2026 年 3 月期)
    await pickFile(csvFile('単体.csv', { individualOnly: true }))
    await screen.findByRole('heading', { level: 1, name: 'サンプル製作所(架空)' })
    fireEvent.click(screen.getByText('← 企業の一覧へ'))
    await pickFile(csvFile('連結.csv', { currentEnd: '2026-03-31' }))
    await screen.findByRole('heading', { level: 1, name: 'サンプル製作所(架空)' })
    // 2024 年は単体、2025 年・2026 年は連結(2025 年は、あとから読んだ連結に置き換わる)
    expect(screen.getByText(/数字の範囲: 2024年3月期は単体、2025年3月期〜2026年3月期は連結/)).toBeTruthy()
    expect(screen.getByRole('note').textContent).toContain('2025年3月期')
    // 概要の主要な数字は、最新の期(2026 年)と前期(2025 年)がどちらも連結なので、前期との差が出る
    expect(screen.queryAllByText('前期との比較はできません')).toHaveLength(0)
    // 保存した内容にも、範囲が入っている
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).toContain('"basis":"consolidated"')
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).toContain('"basis":"individual"')
  })

  test('読めないファイルは、エラーを知らせ、一覧は変えない', async () => {
    render(<App />)
    await pickFile(new File(['hello'], 'bad.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(window.localStorage.getItem(PORTFOLIO_KEY)).toBeNull()
  })
})

describe('App: 保存データの扱い', () => {
  test('壊れた保存データは、空で始めて知らせる(元のデータは退避される)', () => {
    window.localStorage.setItem(PORTFOLIO_KEY, '{broken')
    render(<App />)
    expect(screen.getByText(/読み込めなかったため、空の状態で始めます/)).toBeTruthy()
    expect(window.localStorage.getItem('zaimu-view:portfolio:backup')).toBe('{broken')
    fireEvent.click(screen.getByText('このお知らせを閉じる'))
    expect(screen.queryByText(/空の状態で始めます/)).toBeNull()
  })

  test('保存できないとき(容量超過など)は、ページを閉じると消えることを知らせる', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    render(<App />)
    fireEvent.click(screen.getByText('練習用データで試す'))
    expect(await screen.findByText(/保存できません/)).toBeTruthy()
  })

  test('別のタブで一覧が書き換えられたら、このタブの表示も追随する(古い内容で上書きしない)', async () => {
    render(<App />)
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    store([SAMPLE_COMPANY])
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: PORTFOLIO_KEY }))
    })
    expect(await screen.findByRole('heading', { level: 3, name: SAMPLE_COMPANY.name })).toBeTruthy()
  })

  test('関係のない保存項目の変更には、反応しない', async () => {
    render(<App />)
    store([SAMPLE_COMPANY])
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other-app:key' }))
    })
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
  })
})

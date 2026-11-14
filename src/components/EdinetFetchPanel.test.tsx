// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CompanyHit, LocalApiStatus, ReportEvent } from '../lib/edinet/localApi'
import { EdinetFetchPanel } from './EdinetFetchPanel'

const api = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  searchCompanies: vi.fn(),
  streamReports: vi.fn(),
  fetchDocument: vi.fn(),
}))
vi.mock('../lib/edinet/localApi', () => api)

const COMPANY: CompanyHit = {
  edinetCode: 'E90001',
  name: 'サンプル製作所',
  secCode: '12340',
  fiscalYearEnd: { month: 3, day: 'end' },
  listed: true,
}

const REPORT_2025 = { docID: 'S100AAAA', periodEnd: '2025-03-31', submitDateTime: '2025-06-27 15:00', docTypeCode: '120' }
const REPORT_2024 = { docID: 'S100BBBB', periodEnd: '2024-03-31', submitDateTime: '2024-06-27 15:00', docTypeCode: '120' }

/** streamReports の代わり。渡したイベントを、順に流す */
function streaming(events: readonly ReportEvent[]) {
  api.streamReports.mockImplementation(async (_code: string, _years: number, onEvent: (e: ReportEvent) => void) => {
    for (const event of events) onEvent(event)
  })
}

function ready(status: LocalApiStatus['kind'] = 'ready'): void {
  api.fetchStatus.mockResolvedValue({ kind: status })
}

async function searchFor(text: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText('企業名・証券コード・EDINET コード'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: '企業を探す' }))
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  ready()
  api.searchCompanies.mockResolvedValue([COMPANY])
  api.fetchDocument.mockImplementation(async (docID: string) => Uint8Array.of(0x50, 0x4b, docID.charCodeAt(5)))
})

afterEach(cleanup)

describe('EdinetFetchPanel: 表示の条件', () => {
  test('中継が無い環境(unavailable)では、何も出さない', async () => {
    ready('unavailable')
    const onStatusKnown = vi.fn()
    const { container } = render(<EdinetFetchPanel onDocuments={vi.fn()} onStatusKnown={onStatusKnown} />)
    await waitFor(() => expect(onStatusKnown).toHaveBeenCalledWith('unavailable'))
    expect(container.textContent).toBe('')
  })

  test('API キー未設定(needsKey)では、設定の案内を出し、企業は探せるが取得はできない', async () => {
    ready('needsKey')
    render(<EdinetFetchPanel onDocuments={vi.fn()} />)
    expect(await screen.findByText(/API キーの設定が必要です/)).toBeTruthy()
    await searchFor('サンプル')
    const fetchButton = await screen.findByRole('button', { name: '有価証券報告書を取得する' })
    expect((fetchButton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('API キーが未設定のため、取得できません。')).toBeTruthy()
  })

  test('決算日が不明な提出者は、探せない理由を出して、取得を押せなくする', async () => {
    api.searchCompanies.mockResolvedValue([{ ...COMPANY, fiscalYearEnd: null }])
    render(<EdinetFetchPanel onDocuments={vi.fn()} />)
    await searchFor('x')
    expect(await screen.findByText(/決算日が不明なため/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '有価証券報告書を取得する' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('検索結果が 0 件なら、そう知らせる', async () => {
    api.searchCompanies.mockResolvedValue([])
    render(<EdinetFetchPanel onDocuments={vi.fn()} />)
    await searchFor('存在しない')
    expect(await screen.findByText('該当する企業が見つかりませんでした。')).toBeTruthy()
  })

  test('検索に失敗したら、中継の文章をエラーとして出す', async () => {
    api.searchCompanies.mockRejectedValue(new Error('コードリストを取得できませんでした'))
    render(<EdinetFetchPanel onDocuments={vi.fn()} />)
    await searchFor('x')
    expect((await screen.findByRole('alert')).textContent).toContain('コードリストを取得できませんでした')
  })
})

describe('EdinetFetchPanel: 取得', () => {
  test('探した書類を、古い事業年度から順にダウンロードして、取り込みに渡す', async () => {
    streaming([{ type: 'done', reports: [REPORT_2025, REPORT_2024], notFound: [], pending: [] }])
    const onDocuments = vi.fn()
    render(<EdinetFetchPanel onDocuments={onDocuments} />)
    await searchFor('サンプル')
    fireEvent.click(await screen.findByRole('button', { name: '有価証券報告書を取得する' }))
    await waitFor(() => expect(onDocuments).toHaveBeenCalledTimes(1))
    const documents = onDocuments.mock.calls[0][0] as { fileName: string }[]
    expect(documents.map((d) => d.fileName)).toEqual(['サンプル製作所 2024年3月期', 'サンプル製作所 2025年3月期'])
    expect(api.fetchDocument.mock.calls.map((c) => c[0])).toEqual(['S100BBBB', 'S100AAAA'])
    expect(await screen.findByText(/2 件の書類を取得しました/)).toBeTruthy()
  })

  test('選んだ年数を、探索に渡す', async () => {
    streaming([{ type: 'done', reports: [], notFound: [], pending: [] }])
    render(<EdinetFetchPanel onDocuments={vi.fn()} />)
    await searchFor('サンプル')
    fireEvent.change(await screen.findByLabelText('取得する期間'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '有価証券報告書を取得する' }))
    await waitFor(() => expect(api.streamReports).toHaveBeenCalled())
    expect(api.streamReports.mock.calls[0][0]).toBe('E90001')
    expect(api.streamReports.mock.calls[0][1]).toBe(5)
  })

  test('見つからなかった事業年度と、未提出の可能性のある事業年度を、結果に書く(取り込みには何も渡さない)', async () => {
    streaming([{ type: 'done', reports: [], notFound: ['2023-03-31'], pending: ['2026-03-31'] }])
    const onDocuments = vi.fn()
    render(<EdinetFetchPanel onDocuments={onDocuments} />)
    await searchFor('サンプル')
    fireEvent.click(await screen.findByRole('button', { name: '有価証券報告書を取得する' }))
    const result = await screen.findByText(/見つかりませんでした/)
    expect(result.textContent).toContain('2023年3月期')
    expect(result.textContent).toContain('2026年3月期')
    expect(onDocuments).not.toHaveBeenCalled()
  })

  test('中継がエラーを返したら、その文章を出し、何も取り込まない', async () => {
    streaming([{ type: 'error', message: 'EDINET が API キーを受け付けませんでした。' }])
    const onDocuments = vi.fn()
    render(<EdinetFetchPanel onDocuments={onDocuments} />)
    await searchFor('サンプル')
    fireEvent.click(await screen.findByRole('button', { name: '有価証券報告書を取得する' }))
    expect((await screen.findByRole('alert')).textContent).toContain('API キーを受け付けませんでした')
    expect(onDocuments).not.toHaveBeenCalled()
  })

  test('ダウンロードに失敗したら、エラーを出し、取り込みは呼ばない(途中までの書類を取り込まない)', async () => {
    streaming([{ type: 'done', reports: [REPORT_2025, REPORT_2024], notFound: [], pending: [] }])
    api.fetchDocument.mockRejectedValueOnce(new Error('書類を取得できませんでした。'))
    const onDocuments = vi.fn()
    render(<EdinetFetchPanel onDocuments={onDocuments} />)
    await searchFor('サンプル')
    fireEvent.click(await screen.findByRole('button', { name: '有価証券報告書を取得する' }))
    expect((await screen.findByRole('alert')).textContent).toContain('書類を取得できませんでした')
    expect(onDocuments).not.toHaveBeenCalled()
  })

  test('探索中は進み具合と「中止する」を出し、中止すると、エラーにならずに元の状態に戻る', async () => {
    let abortSignal: AbortSignal | undefined
    api.streamReports.mockImplementation(
      (_code: string, _years: number, onEvent: (e: ReportEvent) => void, signal: AbortSignal) => {
        abortSignal = signal
        onEvent({ type: 'progress', fiscalYearEnd: '2025-03-31', date: '2025-06-27', checked: 3, planned: 64, cached: true })
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      },
    )
    render(<EdinetFetchPanel onDocuments={vi.fn()} />)
    await searchFor('サンプル')
    fireEvent.click(await screen.findByRole('button', { name: '有価証券報告書を取得する' }))
    expect(await screen.findByText('2025年3月期の書類を探しています…')).toBeTruthy()
    expect(screen.getByText(/3 \/ 最大 64 日/)).toBeTruthy()
    // 探している間は、ほかの取得を始められない
    expect((screen.getByRole('button', { name: '企業を探す' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '中止する' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '中止する' })).toBeNull())
    expect(abortSignal?.aborted).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('画面を離れたら、実行中の通信を止める', async () => {
    let abortSignal: AbortSignal | undefined
    api.streamReports.mockImplementation((_c: string, _y: number, _e: unknown, signal: AbortSignal) => {
      abortSignal = signal
      return new Promise<void>(() => undefined)
    })
    const { unmount } = render(<EdinetFetchPanel onDocuments={vi.fn()} />)
    await searchFor('サンプル')
    fireEvent.click(await screen.findByRole('button', { name: '有価証券報告書を取得する' }))
    await waitFor(() => expect(abortSignal).toBeDefined())
    unmount()
    expect(abortSignal?.aborted).toBe(true)
  })
})

import { describe, expect, test, vi } from 'vitest'
import type { CompanyHit, ReportEvent } from '../lib/edinet/localApi'
import { disabledReason, fiscalYearEndText, periodLabel, scanReports, scanTask, summaryText } from './edinetFetchModel'

const api = vi.hoisted(() => ({ streamReports: vi.fn() }))
vi.mock('../lib/edinet/localApi', () => api)

const COMPANY: CompanyHit = {
  edinetCode: 'E90001',
  name: 'サンプル製作所',
  secCode: '12340',
  fiscalYearEnd: { month: 3, day: 'end' },
  listed: true,
}

describe('表示用の文章', () => {
  test('決算日: 月末日と、特定の日と、不明', () => {
    expect(fiscalYearEndText({ month: 3, day: 'end' })).toBe('3月末日決算')
    expect(fiscalYearEndText({ month: 9, day: 20 })).toBe('9月20日決算')
    expect(fiscalYearEndText(null)).toBe('決算日不明')
  })

  test('事業年度の名前: 「2025-03-31」→「2025年3月期」(先頭の 0 を取る)', () => {
    expect(periodLabel('2025-03-31')).toBe('2025年3月期')
    expect(periodLabel('2024-12-31')).toBe('2024年12月期')
  })

  test('探索の進み具合: 見出し(読み上げ用)と、1 日ごとの細かい文を分ける', () => {
    const task = scanTask(COMPANY, { type: 'progress', fiscalYearEnd: '2025-03-31', date: '2025-06-27', checked: 14, planned: 64, cached: true })
    expect(task).toMatchObject({ kind: 'scanning', headline: '2025年3月期の書類を探しています…' })
    if (task.kind !== 'scanning') throw new Error('scanning ではありません')
    expect(task.detail).toBe('2025-06-27 の提出分を確認中(保存済みの一覧)(14 / 最大 64 日)')
  })

  test('取得の結果: 件数・見つからなかった年度・未提出の可能性のある年度', () => {
    expect(summaryText(2, [], [])).toBe('2 件の書類を取得しました。')
    expect(summaryText(0, [], [])).toBe('有価証券報告書が見つかりませんでした。')
    expect(summaryText(1, ['2023-03-31', '2022-03-31'], ['2026-03-31'])).toBe(
      '1 件の書類を取得しました。見つからなかった事業年度: 2023年3月期、2022年3月期。まだ提出期限が来ていない事業年度(未提出の可能性): 2026年3月期。',
    )
  })

  test('取得を押せない理由: キー未設定 → 決算日不明 → 実行中の順。押せるなら null', () => {
    const ready = { kind: 'ready' } as const
    expect(disabledReason(COMPANY, { kind: 'needsKey' }, false)).toContain('API キー')
    expect(disabledReason({ ...COMPANY, fiscalYearEnd: null }, ready, false)).toContain('決算日が不明')
    expect(disabledReason(COMPANY, ready, true)).toContain('実行中')
    expect(disabledReason(COMPANY, ready, false)).toBeNull()
  })
})

describe('scanReports', () => {
  const signal = new AbortController().signal

  test('進み具合を渡し、最後の結果(見つかった書類・見つからなかった年度)を返す', async () => {
    const progress: ReportEvent = { type: 'progress', fiscalYearEnd: '2025-03-31', date: '2025-06-27', checked: 1, planned: 5, cached: false }
    api.streamReports.mockImplementation(async (_c: string, _y: number, onEvent: (e: ReportEvent) => void) => {
      onEvent(progress)
      onEvent({ type: 'done', reports: [], notFound: ['2023-03-31'], pending: ['2026-03-31'] })
    })
    const seen: unknown[] = []
    const result = await scanReports('E90001', 3, (e) => seen.push(e), signal)
    expect(seen).toEqual([progress])
    expect(result).toEqual({ reports: [], notFound: ['2023-03-31'], pending: ['2026-03-31'] })
  })

  test('中継のエラーのイベントは、その文章の例外にする', async () => {
    api.streamReports.mockImplementation(async (_c: string, _y: number, onEvent: (e: ReportEvent) => void) => {
      onEvent({ type: 'error', message: '制限されました。' })
    })
    await expect(scanReports('E90001', 3, () => undefined, signal)).rejects.toThrow('制限されました。')
  })
})

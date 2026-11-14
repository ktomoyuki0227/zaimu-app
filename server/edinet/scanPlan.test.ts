import { describe, expect, test } from 'vitest'
import { daysBefore, filingDeadline, filingScanDates, fiscalYearEndDates } from './scanPlan.ts'

describe('fiscalYearEndDates', () => {
  test('今日より前の、直近の決算日を新しい順に返す(3 月 31 日決算)', () => {
    expect(fiscalYearEndDates({ month: 3, day: 31 }, '2026-11-13', 3)).toEqual([
      '2026-03-31',
      '2025-03-31',
      '2024-03-31',
    ])
  })

  test('決算日が今日ならまだ含めず、前の年から数える', () => {
    expect(fiscalYearEndDates({ month: 3, day: 31 }, '2026-03-31', 2)).toEqual(['2025-03-31', '2024-03-31'])
  })

  test('決算日が今年まだ来ていなければ、去年から数える(12 月決算)', () => {
    expect(fiscalYearEndDates({ month: 12, day: 31 }, '2026-11-13', 2)).toEqual(['2025-12-31', '2024-12-31'])
  })

  test('「月末日」は、うるう年かどうかで 2 月 28 日・29 日になる', () => {
    expect(fiscalYearEndDates({ month: 2, day: 'end' }, '2026-11-13', 3)).toEqual([
      '2026-02-28',
      '2025-02-28',
      '2024-02-29',
    ])
  })

  test('存在しない日(2 月 30 日)は、その月の末日に寄せる', () => {
    expect(fiscalYearEndDates({ month: 2, day: 30 }, '2025-11-13', 1)).toEqual(['2025-02-28'])
  })
})

describe('filingScanDates', () => {
  const dates = filingScanDates('2025-03-31', '2026-11-13')

  test('最初は提出期限(決算日の 3 か月後 = 6/30)から', () => {
    expect(dates[0]).toBe('2025-06-30')
  })

  test('期限の直前の期間を、遡る順に先に調べる', () => {
    expect(dates.slice(0, 4)).toEqual(['2025-06-30', '2025-06-27', '2025-06-26', '2025-06-25'])
  })

  test('期限のあと(延長・遅れ)は、期限の前の期間のあとに調べる', () => {
    expect(dates.indexOf('2025-07-01')).toBeGreaterThan(dates.indexOf('2025-06-06'))
  })

  test('土日は含まない', () => {
    expect(dates.every((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))).toBe(true)
  })

  test('決算日の 14 日後から、期限の 10 日後までに収まる。同じ日は 2 度出ない', () => {
    expect(dates.every((d) => d >= '2025-04-14' && d <= '2025-07-10')).toBe(true)
    expect(new Set(dates).size).toBe(dates.length)
    expect(dates[dates.length - 1]).toBe('2025-04-14')
  })

  test('今日より後の日は含まない(まだ提出されていない)', () => {
    const early = filingScanDates('2026-03-31', '2026-05-01')
    expect(early.every((d) => d <= '2026-05-01')).toBe(true)
    expect(early[0]).toBe('2026-05-01')
  })

  test('決算日の直後(提出が考えられる日がまだ無い)は、空', () => {
    expect(filingScanDates('2026-03-31', '2026-04-05')).toEqual([])
  })

  test('12 月決算は、期限が翌年 3 月 31 日', () => {
    expect(filingScanDates('2025-12-31', '2026-11-13')[0]).toBe('2026-03-31')
  })

  test('11 月 30 日決算の期限は、翌年 2 月末(2 月 28 日)', () => {
    expect(filingScanDates('2025-11-30', '2026-11-13')[0]).toBe('2026-02-27') // 2/28 は土曜
  })
})

describe('filingDeadline', () => {
  test('決算日が月末なら、3 か月後も月末(9 月末 → 12/31、2 月末 → 5/31)', () => {
    expect(filingDeadline('2025-03-31')).toBe('2025-06-30')
    expect(filingDeadline('2025-09-30')).toBe('2025-12-31')
    expect(filingDeadline('2026-02-28')).toBe('2026-05-31')
    expect(filingDeadline('2024-02-29')).toBe('2024-05-31')
    expect(filingDeadline('2025-12-31')).toBe('2026-03-31')
    expect(filingDeadline('2025-11-30')).toBe('2026-02-28')
  })

  test('月末でない決算日は、同じ日付の 3 か月後(収まらなければ月末)', () => {
    expect(filingDeadline('2025-02-15')).toBe('2025-05-15')
    expect(filingDeadline('2025-11-29')).toBe('2026-02-28')
  })
})

describe('daysBefore', () => {
  test('n 日前の日付', () => {
    expect(daysBefore('2025-03-01', 1)).toBe('2025-02-28')
    expect(daysBefore('2025-11-13', 7)).toBe('2025-11-06')
  })
})

import { describe, expect, test } from 'vitest'
import { todayInJapan } from './vitePlugin.ts'

describe('todayInJapan', () => {
  test('日本時間の日付を返す(UTC の 15:00 以降は、日本では翌日)', () => {
    expect(todayInJapan(Date.UTC(2025, 5, 27, 14, 59))).toBe('2025-06-27')
    expect(todayInJapan(Date.UTC(2025, 5, 27, 15, 0))).toBe('2025-06-28')
  })

  test('年またぎ', () => {
    expect(todayInJapan(Date.UTC(2025, 11, 31, 16, 0))).toBe('2026-01-01')
  })
})

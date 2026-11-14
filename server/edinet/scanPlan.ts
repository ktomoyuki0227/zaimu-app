import type { FiscalYearEnd } from './codeList.ts'
import { DAY_MS } from './patterns.ts'

/**
 * 有価証券報告書は、決算日から 3 か月以内に提出される。書類一覧 API は日付でしか絞り込めないので、
 * 提出が集中する期限の前後から順に日付を調べ、見つかったらそこで止める。
 * ここは日付だけを扱う純粋な関数(日付は YYYY-MM-DD の文字列、時刻は UTC の 0 時として扱う)。
 */

/** 提出が集中する、期限の何日前から先に調べるか */
const RUSH_DAYS = 25
/** 決算日から何日後より前には、提出されないとみなすか */
const EARLIEST_AFTER_FYE_DAYS = 14
/** 提出期限のあと、何日まで調べるか(期限の延長・遅れの余裕) */
const LATE_BUFFER_DAYS = 10

function toMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  return fromMs(toMs(date) + days * DAY_MS)
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isWeekend(date: string): boolean {
  const day = new Date(toMs(date)).getUTCDay()
  return day === 0 || day === 6
}

/**
 * 決算日の 3 か月後。有価証券報告書の提出期限。
 * 決算日が月末なら、3 か月後も月末(9 月 30 日 → 12 月 31 日)。月末に収まらない日は、月末に寄せる。
 */
export function filingDeadline(fyeDate: string): string {
  const [y, m, d] = fyeDate.split('-').map(Number)
  const total = y * 12 + (m - 1) + 3
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const last = lastDayOfMonth(year, month)
  const isMonthEnd = d === lastDayOfMonth(y, m)
  return fromMs(Date.UTC(year, month - 1, isMonthEnd ? last : Math.min(d, last)))
}

/** date の n 日前(YYYY-MM-DD) */
export function daysBefore(date: string, n: number): string {
  return addDays(date, -n)
}

/**
 * 決算日(月日)から、直近の決算日を count 年分、新しい順に返す。today より前のものだけ。
 * 「2 月 29 日」などの存在しない日は、その月の末日に寄せる。
 */
export function fiscalYearEndDates(fye: FiscalYearEnd, today: string, count: number): string[] {
  const todayYear = Number(today.slice(0, 4))
  const dates: string[] = []
  for (let year = todayYear; year > todayYear - count - 2 && dates.length < count; year -= 1) {
    const last = lastDayOfMonth(year, fye.month)
    const day = fye.day === 'end' ? last : Math.min(fye.day, last)
    const date = fromMs(Date.UTC(year, fye.month - 1, day))
    if (date < today) {
      dates.push(date)
    }
  }
  return dates
}

/**
 * ある決算日の有価証券報告書を探すために、書類一覧を調べる日付を、調べる順に返す。
 * 1. 提出期限の直前(提出が最も集中する期間)を、期限から遡って
 * 2. 期限のあと(延長・遅れ)を、期限から進めて
 * 3. それより前を、遡って
 * 土日と、today より後の日は除く(提出は営業日にだけ行われ、未来の一覧は無い)。
 */
export function filingScanDates(fyeDate: string, today: string): string[] {
  const deadline = filingDeadline(fyeDate)
  const start = addDays(fyeDate, EARLIEST_AFTER_FYE_DAYS)
  const end = addDays(deadline, LATE_BUFFER_DAYS)
  const rushStart = addDays(deadline, -(RUSH_DAYS - 1))

  const range = (from: string, to: string, step: 1 | -1): string[] => {
    const out: string[] = []
    for (let d = step === 1 ? from : to; step === 1 ? d <= to : d >= from; d = addDays(d, step)) {
      out.push(d)
    }
    return out
  }
  const ordered = [
    ...range(rushStart, deadline, -1),
    ...range(addDays(deadline, 1), end, 1),
    ...range(start, addDays(rushStart, -1), -1),
  ]
  return ordered.filter((d) => d >= start && d <= today && !isWeekend(d))
}

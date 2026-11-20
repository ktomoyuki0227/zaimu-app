import { describe, expect, test } from 'vitest'
import { calcMetrics } from '../metrics'
import { deriveStatements } from '../statements'
import { parseEdinetCsv } from './edinetCsv'
import { extractFromFacts } from './extract'
import { buildCsvText, fixtureRows, type FixtureOptions } from './testing/edinetFixture'
import { chooseUnit, toCompany } from './toCompany'

function extract(options: FixtureOptions = {}) {
  const parsed = parseEdinetCsv(buildCsvText(fixtureRows(options)), 100_000)
  if (!parsed.ok) throw new Error(parsed.reason)
  return extractFromFacts(parsed.facts, parsed.info)
}

describe('chooseUnit', () => {
  test('総資産の大きさに合わせて、百万円・千円・円を選ぶ', () => {
    expect(chooseUnit(100_000 * 1_000_000)).toBe('百万円')
    expect(chooseUnit(1_000_000_000)).toBe('百万円')
    expect(chooseUnit(999_999_999)).toBe('千円')
    expect(chooseUnit(1_000_000)).toBe('千円')
    expect(chooseUnit(999_999)).toBe('円')
  })
})

describe('toCompany', () => {
  test('円を百万円に直し、会社名・単位・期の並びを持つ Company にする', () => {
    const company = toCompany(extract(), 'imp-1')
    expect(company).not.toBeNull()
    if (company === null) return
    expect(company.id).toBe('imp-1')
    expect(company.name).toBe('サンプル製作所(架空)')
    expect(company.unit).toBe('百万円')
    expect(company.edinetCode).toBe('E99999')
    expect(company.periods.map((p) => p.label)).toEqual(['2024年3月期', '2025年3月期'])
    const latest = company.periods[1]
    expect(latest.pl.sales).toBe(120_000)
    expect(latest.bs.cash).toBe(10_000)
    expect(latest.bs.shortTermDebt).toBe(8_000)
    expect(latest.pl.operatingCashFlow).toBe(7_000)
  })

  test('全期で貸借が一致する(そのまま分析画面に出せる)', () => {
    const company = toCompany(extract(), 'imp-1')
    for (const p of company?.periods ?? []) {
      expect(Math.abs(deriveStatements(p).balanceGap)).toBeLessThan(0.0001)
    }
  })

  test('取り込んだ数字から、書類どおりの利益と指標が計算される', () => {
    const company = toCompany(extract(), 'imp-1')
    const latest = company!.periods[1]
    const d = deriveStatements(latest)
    expect(d.operatingProfit).toBe(9_000)
    expect(d.ordinaryProfit).toBe(8_500)
    expect(d.netIncome).toBe(5_600)
    expect(calcMetrics(latest).equityRatio).toBeCloseTo(45)
  })

  test('営業キャッシュフローが書類に無ければ、項目ごと付けない', () => {
    const company = toCompany(extract({ omit: ['NetCashProvidedByUsedInOperatingActivities'] }), 'x')
    expect('operatingCashFlow' in company!.periods[1].pl).toBe(false)
  })

  test('反映できない結果(errors あり)は null', () => {
    expect(toCompany(extract({ standard: 'US GAAP' }), 'x')).toBeNull()
  })

  test('金額が上限(1e15)を超える場合は null(parseCompany の検証を通らない)', () => {
    const base = extract()
    const latest = base.periods[1]
    const huge = {
      ...base,
      // 2e21 円 = 百万円に直すと 2e15 で、上限 1e15 を超える
      periods: [
        base.periods[0],
        { ...latest, pl: { ...latest.pl, sales: { ...latest.pl.sales, value: 2e21 } } },
      ],
    }
    expect(toCompany(huge, 'x')).toBeNull()
    expect(toCompany(base, 'x')).not.toBeNull()
  })

  test('指数表記の巨大な数値は、CSV の段階で取り込まれない', () => {
    const result = extract({ override: { NetSales: [2e15, 2e15] } })
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('toCompany: 期の範囲(連結・単体)', () => {
  test('抽出結果の範囲(連結)を、すべての期に付ける', () => {
    const company = toCompany(extract(), 'x')
    expect(company?.periods.map((p) => p.basis)).toEqual(['consolidated', 'consolidated'])
  })

  test('個別(単体)の書類なら、単体を付ける', () => {
    const company = toCompany(extract({ individualOnly: true }), 'x')
    expect(company?.periods.every((p) => p.basis === 'individual')).toBe(true)
  })
})

describe('toCompany: キャッシュフローの 3 区分', () => {
  test('3 区分を、会社の単位(百万円)に直して持つ。符号は変えない', () => {
    const p = toCompany(extract(), 'x')?.periods[1]
    expect(p?.pl.operatingCashFlow).toBe(7_000)
    expect(p?.pl.investingCashFlow).toBe(-5_000)
    expect(p?.pl.financingCashFlow).toBe(-1_500)
  })

  test('書類に無い区分は、項目ごと持たない(古いデータと同じ形)', () => {
    const p = toCompany(extract({ omit: ['NetCashProvidedByUsedInInvestmentActivities'] }), 'x')?.periods[1]
    expect(p?.pl).not.toHaveProperty('investingCashFlow')
    expect(p?.pl.operatingCashFlow).toBe(7_000)
  })
})

describe('toCompany: 現金残高の突き合わせ用の項目', () => {
  test('期末残高・増減額・為替の影響を、会社の単位(百万円)に直して持つ', () => {
    const p = toCompany(extract(), 'x')?.periods[1]
    expect(p?.pl.cashEnd).toBe(10_500)
    expect(p?.pl.cashChange).toBe(600)
    expect(p?.pl.fxEffect).toBe(100)
  })

  test('書類に無い項目は、項目ごと持たない(0 にしない)', () => {
    const p = toCompany(extract({ omit: ['EffectOfExchangeRateChangeOnCashAndCashEquivalents'] }), 'x')?.periods[1]
    expect(p?.pl).not.toHaveProperty('fxEffect')
    expect(p?.pl.cashEnd).toBe(10_500)
  })
})

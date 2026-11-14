import { describe, expect, test } from 'vitest'
import { basePeriod } from './fixtures'
import { MAX_COMPANIES } from './portfolio'
import { parseCompany, parsePortfolio } from './validate'

const valid = { id: 'c1', name: 'テスト社', periods: [basePeriod] }

describe('parseCompany', () => {
  test('正しい形のデータはそのまま Company として返す', () => {
    const parsed = parseCompany(valid)
    expect(parsed?.name).toBe('テスト社')
    expect(parsed?.periods).toHaveLength(1)
    expect(parsed?.periods[0].pl.sales).toBe(1000)
  })

  test('JSON を経由しても同じ結果になる(保存と復元の往復)', () => {
    const roundTripped = parseCompany(JSON.parse(JSON.stringify(valid)))
    expect(roundTripped).toEqual(valid)
  })

  test('金額の単位(任意)は、決まった値だけを受け付ける', () => {
    expect(parseCompany({ ...valid, unit: '百万円' })?.unit).toBe('百万円')
    expect(parseCompany({ ...valid, unit: '千円' })?.unit).toBe('千円')
    expect(parseCompany({ ...valid, unit: '円' })?.unit).toBe('円')
  })

  test('単位が無い古い保存データも読める(unit は付かない)', () => {
    const parsed = parseCompany(valid)
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty('unit')
  })

  test('知らない単位や文字列でない単位は null', () => {
    expect(parseCompany({ ...valid, unit: '億円' })).toBeNull()
    expect(parseCompany({ ...valid, unit: 1000 })).toBeNull()
    expect(parseCompany({ ...valid, unit: null })).toBeNull()
  })

  test('EDINET コード(任意)は、E + 数字 5 桁だけを受け付ける', () => {
    expect(parseCompany({ ...valid, edinetCode: 'E01234' })?.edinetCode).toBe('E01234')
    expect(parseCompany({ ...valid, edinetCode: 'E0123' })).toBeNull()
    expect(parseCompany({ ...valid, edinetCode: 1234 })).toBeNull()
    expect(parseCompany(valid)).not.toHaveProperty('edinetCode')
  })

  test('文字数は、コードポイントで数える(𠮷 のような文字を含む名前が、保存後に読めなくならない)', () => {
    expect(parseCompany({ ...valid, name: '𠮷'.repeat(100) })?.name).toBe('𠮷'.repeat(100))
    expect(parseCompany({ ...valid, name: '𠮷'.repeat(101) })).toBeNull()
  })

  test('オブジェクト以外は null', () => {
    expect(parseCompany(null)).toBeNull()
    expect(parseCompany('abc')).toBeNull()
    expect(parseCompany(42)).toBeNull()
  })

  test('名前や id が文字列でなければ null', () => {
    expect(parseCompany({ ...valid, name: 1 })).toBeNull()
    expect(parseCompany({ ...valid, id: undefined })).toBeNull()
  })

  test('periods が配列でない、または空なら null', () => {
    expect(parseCompany({ ...valid, periods: 'x' })).toBeNull()
    expect(parseCompany({ ...valid, periods: [] })).toBeNull()
  })

  test('金額が数値でない期があれば null', () => {
    const broken = {
      ...valid,
      periods: [{ ...basePeriod, pl: { ...basePeriod.pl, sales: '1000' } }],
    }
    expect(parseCompany(broken)).toBeNull()
  })

  test('金額が有限の数でない(NaN・Infinity)場合も null', () => {
    const broken = {
      ...valid,
      periods: [{ ...basePeriod, bs: { ...basePeriod.bs, cash: Number.NaN } }],
    }
    expect(parseCompany(broken)).toBeNull()
  })

  test('BS の必須項目が欠けていれば null', () => {
    const { cash: _cash, ...rest } = basePeriod.bs
    expect(parseCompany({ ...valid, periods: [{ ...basePeriod, bs: rest }] })).toBeNull()
  })

  test('営業キャッシュフローは任意。あれば数値、無くても可', () => {
    const withCf = {
      ...valid,
      periods: [{ ...basePeriod, pl: { ...basePeriod.pl, operatingCashFlow: 120 } }],
    }
    expect(parseCompany(withCf)?.periods[0].pl.operatingCashFlow).toBe(120)
    expect(parseCompany(valid)?.periods[0].pl.operatingCashFlow).toBeUndefined()

    const badCf = {
      ...valid,
      periods: [{ ...basePeriod, pl: { ...basePeriod.pl, operatingCashFlow: 'x' } }],
    }
    expect(parseCompany(badCf)).toBeNull()
  })

  test('名前・ラベルが長すぎる、期が多すぎる、id が空の場合は null', () => {
    expect(parseCompany({ ...valid, name: 'あ'.repeat(101) })).toBeNull()
    expect(parseCompany({ ...valid, name: 'あ'.repeat(100) })).not.toBeNull()
    expect(parseCompany({ ...valid, id: '' })).toBeNull()
    expect(parseCompany({ ...valid, periods: [{ ...basePeriod, label: 'x'.repeat(101) }] })).toBeNull()
    expect(parseCompany({ ...valid, periods: Array(21).fill(basePeriod) })).toBeNull()
    expect(parseCompany({ ...valid, periods: Array(20).fill(basePeriod) })).not.toBeNull()
  })

  test('金額の絶対値が上限(1e15)を超える場合は null', () => {
    const huge = {
      ...valid,
      periods: [{ ...basePeriod, pl: { ...basePeriod.pl, sales: 1e16 } }],
    }
    expect(parseCompany(huge)).toBeNull()
    const limit = {
      ...valid,
      periods: [{ ...basePeriod, pl: { ...basePeriod.pl, sales: 1e15 } }],
    }
    expect(parseCompany(limit)).not.toBeNull()
  })

  test('__proto__ などの余計なキーが混ざっていても、結果に持ち込まない', () => {
    const polluted = JSON.parse(
      '{"id":"c1","name":"x","__proto__":{"admin":true},"periods":[' +
        JSON.stringify(basePeriod) +
        ']}',
    )
    const parsed = parseCompany(polluted)
    expect(parsed).not.toBeNull()
    expect(Object.keys(parsed ?? {}).sort()).toEqual(['id', 'name', 'periods'])
    expect(({} as Record<string, unknown>).admin).toBeUndefined()
  })

  test('期のラベルが文字列でなければ null', () => {
    expect(parseCompany({ ...valid, periods: [{ ...basePeriod, label: 3 }] })).toBeNull()
  })
})

describe('parsePortfolio', () => {
  const company = (id: string) => ({ id, name: `社${id}`, periods: [basePeriod] })

  test('版 2 の形式の企業の一覧を読める(往復しても同じ)', () => {
    const raw = { version: 2, companies: [company('a'), company('b')] }
    const parsed = parsePortfolio(JSON.parse(JSON.stringify(raw)))
    expect(parsed?.map((c) => c.id)).toEqual(['a', 'b'])
  })

  test('空の一覧も正しい形式', () => {
    expect(parsePortfolio({ version: 2, companies: [] })).toEqual([])
  })

  test('版が違う・配列でない・オブジェクトでないものは null', () => {
    expect(parsePortfolio({ version: 1, companies: [] })).toBeNull()
    expect(parsePortfolio({ version: 2, companies: 'x' })).toBeNull()
    expect(parsePortfolio(null)).toBeNull()
    expect(parsePortfolio([])).toBeNull()
  })

  test('1 社でも読めない企業があれば、全体を null にする(一部だけ読むと、気づかないまま欠ける)', () => {
    expect(parsePortfolio({ version: 2, companies: [company('a'), { id: 'b' }] })).toBeNull()
  })

  test('id が重なっていれば null', () => {
    expect(parsePortfolio({ version: 2, companies: [company('a'), company('a')] })).toBeNull()
  })

  test('企業の数が上限を超えていれば null', () => {
    const many = Array.from({ length: MAX_COMPANIES + 1 }, (_, i) => company(`c${i}`))
    expect(parsePortfolio({ version: 2, companies: many })).toBeNull()
  })
})

import { describe, expect, test } from 'vitest'
import { parseEdinetCsv } from './edinetCsv'
import { buildCsvText, fixtureRows } from './testing/edinetFixture'

function parse(rows = fixtureRows(), maxRows = 10_000) {
  return parseEdinetCsv(buildCsvText(rows), maxRows)
}

describe('parseEdinetCsv', () => {
  test('連結の事実を、当期・前期、時点・期間に分けて読み取る', () => {
    const result = parse()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const assets = result.facts.filter((f) => f.elementId === 'jppfs_cor:Assets')
    expect(assets).toHaveLength(2)
    expect(assets.find((f) => f.year === 'current')).toMatchObject({
      kind: 'instant',
      scope: 'primary',
      value: 100_000_000_000,
      label: '資産合計',
    })
    expect(assets.find((f) => f.year === 'prior')?.value).toBe(90_000_000_000)
    const sales = result.facts.find((f) => f.elementId === 'jppfs_cor:NetSales' && f.year === 'current')
    expect(sales?.kind).toBe('duration')
  })

  test('表紙情報(会社名・会計基準・期間の種類・決算日)を読み取る', () => {
    const result = parse()
    if (!result.ok) throw new Error(result.reason)
    expect(result.info).toEqual({
      companyName: 'サンプル製作所(架空)',
      edinetCode: 'E99999',
      accountingStandard: 'Japan GAAP',
      periodType: 'FY',
      currentEndDate: '2025-03-31',
      priorEndDate: '2024-03-31',
    })
  })

  test('EDINET コードの書式(E + 数字 5 桁)でない値は読まない', () => {
    for (const bad of ['E1234', 'X12345', 'E123456', '']) {
      const result = parse(fixtureRows({ edinetCode: bad }))
      if (!result.ok) throw new Error(result.reason)
      expect(result.info.edinetCode).toBeNull()
    }
  })

  test('前期の決算日が無いときは、当期の 1 年前にする', () => {
    const result = parse(fixtureRows({ currentEnd: '2024-02-29' }))
    if (!result.ok) throw new Error(result.reason)
    expect(result.info.priorEndDate).toBe('2023-02-28')
  })

  test('個別(NonConsolidatedMember)の事実は scope=individual', () => {
    const result = parse(fixtureRows({ individualOnly: true }))
    if (!result.ok) throw new Error(result.reason)
    expect(result.facts.every((f) => f.scope === 'individual')).toBe(true)
  })

  test('セグメントなど、次元が付いた事実は取り込まない', () => {
    const rows = [
      ...fixtureRows(),
      {
        elementId: 'jppfs_cor:NetSales',
        label: '売上高',
        contextId: 'CurrentYearDuration_ReportableSegmentsMember',
        consolidation: '連結',
        unit: 'JPY',
        value: '999000000',
      },
    ]
    const result = parse(rows)
    if (!result.ok) throw new Error(result.reason)
    const sales = result.facts.filter((f) => f.elementId === 'jppfs_cor:NetSales' && f.year === 'current')
    expect(sales).toHaveLength(1)
    expect(sales[0].value).toBe(120_000_000_000)
  })

  test('金額でない値(「－」・文章・指数表記・16進)は事実にしない', () => {
    const bad = ['－', '', 'abc', '1e9', '0x10', '1,000'].map((value, i) => ({
      elementId: `jppfs_cor:Bad${i}`,
      label: 'x',
      contextId: 'CurrentYearInstant',
      consolidation: '連結',
      unit: 'JPY',
      value,
    }))
    const result = parse([...fixtureRows(), ...bad])
    if (!result.ok) throw new Error(result.reason)
    expect(result.facts.some((f) => f.elementId.startsWith('jppfs_cor:Bad'))).toBe(false)
  })

  test('円以外の単位の事実は取り込まない', () => {
    const rows = ['shares', '株', 'pure', '－'].map((unit, i) => ({
      elementId: `jppfs_cor:Odd${i}`,
      label: '株数',
      contextId: 'CurrentYearInstant',
      consolidation: '連結',
      unit,
      value: '100',
    }))
    const result = parse([...fixtureRows(), ...rows])
    if (!result.ok) throw new Error(result.reason)
    expect(result.facts.some((f) => f.elementId.startsWith('jppfs_cor:Odd'))).toBe(false)
  })

  test('実際の CSV の単位「円」と、JPY・空欄は、金額として読む', () => {
    const rows = ['円', 'JPY', ''].map((unit, i) => ({
      elementId: `jppfs_cor:Yen${i}`,
      label: '金額',
      contextId: 'CurrentYearInstant',
      consolidation: '連結',
      unit,
      value: '1000',
    }))
    const result = parse([...fixtureRows(), ...rows])
    if (!result.ok) throw new Error(result.reason)
    expect(result.facts.filter((f) => f.elementId.startsWith('jppfs_cor:Yen'))).toHaveLength(3)
  })

  test('負の金額を読める。-0 は 0 にそろえる', () => {
    const rows = ['-1234', '-0'].map((value, i) => ({
      elementId: `jppfs_cor:Neg${i}`,
      label: '損失',
      contextId: 'CurrentYearDuration',
      consolidation: '連結',
      unit: 'JPY',
      value,
    }))
    const result = parse([...fixtureRows(), ...rows])
    if (!result.ok) throw new Error(result.reason)
    expect(result.facts.find((f) => f.elementId === 'jppfs_cor:Neg0')?.value).toBe(-1234)
    const zero = result.facts.find((f) => f.elementId === 'jppfs_cor:Neg1')
    expect(Object.is(zero?.value, 0)).toBe(true)
  })

  test('小数と、17 桁以上の金額(円の足し引きが不正確になる)は取り込まない', () => {
    const rows = ['1234.5', '12345678901234567', '1234567890123456'].map((value, i) => ({
      elementId: `jppfs_cor:Big${i}`,
      label: 'x',
      contextId: 'CurrentYearDuration',
      consolidation: '連結',
      unit: 'JPY',
      value,
    }))
    const result = parse([...fixtureRows(), ...rows])
    if (!result.ok) throw new Error(result.reason)
    const names = result.facts.map((f) => f.elementId)
    expect(names).not.toContain('jppfs_cor:Big0')
    expect(names).not.toContain('jppfs_cor:Big1')
    expect(names).toContain('jppfs_cor:Big2') // 16 桁は安全な整数
  })

  test('会社名の制御文字・書式文字は取り除く', () => {
    const result = parse(fixtureRows({ companyName: 'サンプル‮製作所​' }))
    if (!result.ok) throw new Error(result.reason)
    expect(result.info.companyName).toBe('サンプル製作所')
  })

  test('実在しない日付(13 月など)は決算日として読まない', () => {
    const result = parse(fixtureRows({ currentEnd: '2025-13-45' }))
    if (!result.ok) throw new Error(result.reason)
    expect(result.info.currentEndDate).toBeNull()
    expect(result.info.priorEndDate).toBeNull()
  })

  test('__proto__ などの危険な要素名でも壊れない', () => {
    const rows = [
      ...fixtureRows(),
      {
        elementId: '__proto__',
        label: 'x',
        contextId: 'CurrentYearInstant',
        consolidation: '連結',
        unit: 'JPY',
        value: '1',
      },
    ]
    expect(parse(rows).ok).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test('見出しが想定と違う、または空のファイルは読めない', () => {
    expect(parseEdinetCsv('a\tb\n1\t2', 100)).toMatchObject({ ok: false })
    expect(parseEdinetCsv('', 100)).toMatchObject({ ok: false })
  })

  test('引用符が閉じていない CSV は、理由つきで読まない', () => {
    const text = `${buildCsvText(fixtureRows())}"閉じていない	欄`
    const result = parseEdinetCsv(text, 10_000)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('引用符')
  })

  test('行数が上限を超えたら読まない', () => {
    expect(parse(fixtureRows(), 5)).toMatchObject({ ok: false })
  })
})

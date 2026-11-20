import { describe, expect, test } from 'vitest'
import { basePeriod } from './fixtures'
import { MAX_PERIODS } from './limits'
import { MAX_COMPANIES, companyIdFor, mergeCompany, removeCompany, upsertCompany } from './portfolio'
import type { Company, PeriodData } from './types'

function period(label: string, sales: number): PeriodData {
  return { ...basePeriod, label, pl: { ...basePeriod.pl, sales } }
}

function company(id: string, name: string, periods: readonly PeriodData[], unit: Company['unit'] = '百万円'): Company {
  return { id, name, unit, periods }
}

describe('companyIdFor', () => {
  test('EDINET コードがあれば、それを企業の識別に使う', () => {
    expect(companyIdFor('E01234', '株式会社テスト')).toBe('edinet-E01234')
  })

  test('コードが無ければ、会社名を使う(長い名前は切り詰める)', () => {
    expect(companyIdFor(null, '株式会社テスト')).toBe('name-株式会社テスト')
    expect(companyIdFor(null, 'あ'.repeat(200)).length).toBeLessThanOrEqual(100)
  })
})

describe('mergeCompany', () => {
  test('別の期を足すと、古い期から新しい期の順に並ぶ', () => {
    const existing = company('c', '甲', [period('2024年3月期', 100), period('2025年3月期', 110)])
    const incoming = company('c', '甲', [period('2022年3月期', 80), period('2023年3月期', 90)])
    const merged = mergeCompany(existing, incoming)
    expect(merged.periods.map((p) => p.label)).toEqual([
      '2022年3月期',
      '2023年3月期',
      '2024年3月期',
      '2025年3月期',
    ])
  })

  test('同じ期は、新しく読み込んだほうの値(遡及修正後)で置き換える', () => {
    const existing = company('c', '甲', [period('2024年3月期', 100), period('2025年3月期', 110)])
    const incoming = company('c', '甲', [period('2025年3月期', 115), period('2026年3月期', 130)])
    const merged = mergeCompany(existing, incoming)
    expect(merged.periods.map((p) => p.pl.sales)).toEqual([100, 115, 130])
  })

  test('会社名は新しく読み込んだほうにする(社名変更に追随)', () => {
    const merged = mergeCompany(
      company('c', '旧社名', [period('2024年3月期', 100)]),
      company('c', '新社名', [period('2025年3月期', 110)]),
    )
    expect(merged.name).toBe('新社名')
  })

  test('金額の単位が違うときは、新しい側の単位にそろえる(千円 → 百万円)', () => {
    const existing = company('c', '甲', [period('2024年3月期', 5_000_000)], '千円')
    const incoming = company('c', '甲', [period('2025年3月期', 6_000)], '百万円')
    const merged = mergeCompany(existing, incoming)
    expect(merged.unit).toBe('百万円')
    expect(merged.periods[0].pl.sales).toBe(5_000)
    expect(merged.periods[0].bs.cash).toBeCloseTo(basePeriod.bs.cash / 1000)
    expect(merged.periods[1].pl.sales).toBe(6_000)
  })

  test('単位が不明な古いデータは混ぜず、新しく読み込んだものだけにする', () => {
    const existing = { id: 'c', name: '甲', periods: [period('2024年3月期', 100)] }
    const incoming = company('c', '甲', [period('2025年3月期', 110)])
    expect(mergeCompany(existing, incoming).periods.map((p) => p.label)).toEqual(['2025年3月期'])
  })

  test('単位をそろえると金額が上限(1e15)を超えるときは、混ぜずに、あとから読み込んだものだけにする', () => {
    // 百万円の 9e9(= 9e15 円)を、円の単位にそろえると 9e15。保存できる上限を超える
    const huge = { ...period('2024年3月期', 9e9), bs: { ...basePeriod.bs } }
    const existing = company('c', '甲', [huge], '百万円')
    const incoming = company('c', '甲', [period('2025年3月期', 500)], '円')
    const merged = mergeCompany(existing, incoming)
    expect(merged.periods.map((p) => p.label)).toEqual(['2025年3月期'])
    expect(merged.unit).toBe('円')
  })

  test('期の範囲(連結・単体)は、統合しても、単位をそろえても残る', () => {
    const existing = company('c', '甲', [{ ...period('2024年12月期', 5_000_000), basis: 'individual' }], '千円')
    const incoming = company('c', '甲', [{ ...period('2025年12月期', 8_000), basis: 'consolidated' }], '百万円')
    const merged = mergeCompany(existing, incoming)
    expect(merged.periods.map((p) => [p.label, p.basis])).toEqual([
      ['2024年12月期', 'individual'],
      ['2025年12月期', 'consolidated'],
    ])
  })

  test('同じ期を、あとから違う範囲で読み込んだら、あとの範囲で置き換わる', () => {
    const existing = company('c', '甲', [{ ...period('2025年12月期', 100), basis: 'individual' }])
    const incoming = company('c', '甲', [{ ...period('2025年12月期', 130), basis: 'consolidated' }])
    const merged = mergeCompany(existing, incoming)
    expect(merged.periods).toHaveLength(1)
    expect(merged.periods[0].basis).toBe('consolidated')
  })

  test('期の数が上限を超えたら、古い期から落とす', () => {
    const many = Array.from({ length: MAX_PERIODS }, (_, i) => period(`${2000 + i}年3月期`, 100 + i))
    const merged = mergeCompany(company('c', '甲', many), company('c', '甲', [period('2030年3月期', 999)]))
    expect(merged.periods).toHaveLength(MAX_PERIODS)
    expect(merged.periods[0].label).toBe('2001年3月期')
    expect(merged.periods[merged.periods.length - 1].label).toBe('2030年3月期')
  })

  test('年月で読めない期の名前は、年月の読める期のあとに、もとの順で並ぶ', () => {
    const merged = mergeCompany(
      company('c', '甲', [period('前期', 1), period('今期', 2)]),
      company('c', '甲', [period('2025年3月期', 3)]),
    )
    expect(merged.periods.map((p) => p.label)).toEqual(['2025年3月期', '前期', '今期'])
  })

  test('元のデータを書き換えない(イミュータブル)', () => {
    const existing = company('c', '甲', [period('2024年3月期', 100)])
    mergeCompany(existing, company('c', '甲', [period('2025年3月期', 110)]))
    expect(existing.periods).toHaveLength(1)
  })
})

describe('upsertCompany: 複数の書類を古い期から順に積む', () => {
  test('5 件の書類を順に足すと、期が古い順にそろい、同じ期は新しい書類の値になる', () => {
    let list: readonly Company[] = []
    const years = [2021, 2022, 2023, 2024, 2025]
    for (const y of years) {
      // 1 書類に 2 期分(前期と当期)が入る
      const doc = company('c', '甲', [period(`${y - 1}年3月期`, y * 10 - 5), period(`${y}年3月期`, y * 10)])
      list = upsertCompany(list, doc) ?? list
    }
    const merged = list[0]
    expect(merged.periods.map((p) => p.label)).toEqual([
      '2020年3月期',
      '2021年3月期',
      '2022年3月期',
      '2023年3月期',
      '2024年3月期',
      '2025年3月期',
    ])
    // 2021 年 3 月期は、2021 年の書類(当期 = 20210)と 2022 年の書類(前期 = 20215)に入る。あとの書類の値になる
    expect(merged.periods.find((p) => p.label === '2021年3月期')?.pl.sales).toBe(20215)
  })

  test('途中で単位が変わっても(千円 → 百万円)、すべて新しい側の単位にそろう', () => {
    let list: readonly Company[] = []
    list = upsertCompany(list, company('c', '甲', [period('2024年3月期', 5_000_000)], '千円')) ?? list
    list = upsertCompany(list, company('c', '甲', [period('2025年3月期', 6_000)], '百万円')) ?? list
    const merged = list[0]
    expect(merged.unit).toBe('百万円')
    expect(merged.periods.map((p) => p.pl.sales)).toEqual([5_000, 6_000])
  })
})

describe('upsertCompany', () => {
  test('新しい企業は、末尾に足す', () => {
    const result = upsertCompany([company('a', '甲', [period('2025年3月期', 1)])], company('b', '乙', [period('2025年3月期', 2)]))
    expect(result?.map((c) => c.id)).toEqual(['a', 'b'])
  })

  test('同じ企業(同じ id)は、期をまとめて、元の位置のまま更新する', () => {
    const list = [
      company('a', '甲', [period('2024年3月期', 1)]),
      company('b', '乙', [period('2024年3月期', 2)]),
    ]
    const result = upsertCompany(list, company('a', '甲', [period('2025年3月期', 3)]))
    expect(result?.map((c) => c.id)).toEqual(['a', 'b'])
    expect(result?.[0].periods.map((p) => p.label)).toEqual(['2024年3月期', '2025年3月期'])
  })

  test('企業の数が上限なら、新しい企業は足せない(null)が、既存の企業の更新はできる', () => {
    const list = Array.from({ length: MAX_COMPANIES }, (_, i) => company(`c${i}`, `社${i}`, [period('2025年3月期', i)]))
    expect(upsertCompany(list, company('new', '新', [period('2025年3月期', 1)]))).toBeNull()
    expect(upsertCompany(list, company('c0', '社0', [period('2026年3月期', 1)]))).not.toBeNull()
  })

  test('元の一覧を書き換えない', () => {
    const list = [company('a', '甲', [period('2025年3月期', 1)])]
    upsertCompany(list, company('b', '乙', [period('2025年3月期', 2)]))
    expect(list).toHaveLength(1)
  })
})

describe('removeCompany', () => {
  test('指定した企業だけを取り除く', () => {
    const list = [company('a', '甲', [period('x', 1)]), company('b', '乙', [period('x', 2)])]
    expect(removeCompany(list, 'a').map((c) => c.id)).toEqual(['b'])
    expect(removeCompany(list, 'zzz')).toHaveLength(2)
  })
})

describe('mergeCompany: キャッシュフロー', () => {
  test('単位をそろえるとき、3 区分も、ほかの金額と同じ割合で直す(符号は変えない)', () => {
    const cf = { operatingCashFlow: 2_000_000, investingCashFlow: -1_000_000, financingCashFlow: -500_000 }
    const existing = company('c', '甲', [{ ...period('2024年3月期', 5_000_000), pl: { ...period('x', 1).pl, ...cf } }], '千円')
    const incoming = company('c', '甲', [period('2025年3月期', 6_000)], '百万円')
    const merged = mergeCompany(existing, incoming)
    expect(merged.periods[0].pl).toMatchObject({ operatingCashFlow: 2_000, investingCashFlow: -1_000, financingCashFlow: -500 })
  })
})

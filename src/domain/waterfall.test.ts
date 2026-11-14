import { describe, expect, test } from 'vitest'
import { buildWaterfall, plStaircase } from './waterfall'
import { basePeriod } from './fixtures'

describe('buildWaterfall', () => {
  test('合計は 0 から立ち上がり、増減は直前の累計から浮いて描かれる', () => {
    const rows = buildWaterfall([
      { label: '期首', value: 100, kind: 'total' },
      { label: '増加', value: 30, kind: 'delta' },
      { label: '減少', value: -50, kind: 'delta' },
      { label: '期末', value: 80, kind: 'total' },
    ])
    expect(rows.map((r) => r.range)).toEqual([
      [0, 100],
      [100, 130],
      [80, 130],
      [0, 80],
    ])
    expect(rows[2].value).toBe(-50)
  })

  test('累計が 0 をまたいでも、範囲が正しく計算される', () => {
    const rows = buildWaterfall([
      { label: '期首', value: 20, kind: 'total' },
      { label: '大きな減少', value: -50, kind: 'delta' },
    ])
    expect(rows[1].range).toEqual([-30, 20])
  })

  test('マイナスの合計は 0 から下に伸びる', () => {
    const rows = buildWaterfall([{ label: '赤字', value: -40, kind: 'total' }])
    expect(rows[0].range).toEqual([-40, 0])
  })

  test('空配列は空配列', () => {
    expect(buildWaterfall([])).toEqual([])
  })
})

describe('plStaircase', () => {
  const rows = plStaircase(basePeriod)

  test('売上高から当期純利益まで 10 段階で並ぶ', () => {
    expect(rows.map((r) => r.label)).toEqual([
      '売上高',
      '売上原価',
      '売上総利益',
      '販管費',
      '営業利益',
      '営業外損益',
      '経常利益',
      '特別損益',
      '法人税等',
      '当期純利益',
    ])
  })

  test('小計・最終利益は導出した段階利益と一致する', () => {
    const byLabel = (label: string) => rows.find((r) => r.label === label)
    expect(byLabel('売上総利益')?.range).toEqual([0, 400])
    expect(byLabel('営業利益')?.range).toEqual([0, 100])
    expect(byLabel('経常利益')?.range).toEqual([0, 100])
    expect(byLabel('当期純利益')?.range).toEqual([0, 50])
  })

  test('費用は直前の累計から差し引く向きに描かれる', () => {
    const cost = rows.find((r) => r.label === '売上原価')
    expect(cost?.value).toBe(-600)
    expect(cost?.range).toEqual([400, 1000])
  })
})

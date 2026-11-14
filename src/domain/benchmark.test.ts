import { describe, expect, it } from 'vitest'
import { bulletScale, gapToGuideline } from './benchmark'

describe('gapToGuideline', () => {
  it('大きいほど良い指標は、目安を上回った分がプラスになる', () => {
    // 営業利益率の目安は 5% 以上
    expect(gapToGuideline('operatingMargin', 7.5)).toBeCloseTo(2.5)
    expect(gapToGuideline('operatingMargin', 3)).toBeCloseTo(-2)
  })

  it('小さいほど良い指標は、目安を下回った分がプラスになる', () => {
    // 固定比率の目安は 100% 以下
    expect(gapToGuideline('fixedRatio', 80)).toBeCloseTo(20)
    expect(gapToGuideline('fixedRatio', 130)).toBeCloseTo(-30)
  })

  it('表示の桁に丸めた値で差を出す(表示と食い違わない)', () => {
    // 149.96% は「150.0%」と表示されるので、目安 150% との差は 0
    expect(gapToGuideline('currentRatio', 149.96)).toBeCloseTo(0)
  })

  it('目安が無い指標は null', () => {
    expect(gapToGuideline('grossMargin', 30)).toBeNull()
  })

  it('値が算出できないときは null', () => {
    expect(gapToGuideline('operatingMargin', null)).toBeNull()
  })
})

describe('bulletScale', () => {
  it('大きいほど良い指標: 左から 要注意 → 注意 → クリア の順に並ぶ', () => {
    // 自己資本比率: 良好 30% 以上、10% 未満は要注意
    const s = bulletScale('equityRatio', 20)
    expect(s).not.toBeNull()
    if (s === null) return
    expect(s.zones.map((z) => z.level)).toEqual(['danger', 'caution', 'good'])
    expect(s.zones[0].from).toBeCloseTo(0)
    expect(s.zones[2].to).toBeCloseTo(1)
    // 帯は切れ目なくつながる
    expect(s.zones[0].to).toBeCloseTo(s.zones[1].from)
    expect(s.zones[1].to).toBeCloseTo(s.zones[2].from)
  })

  it('小さいほど良い指標: 左から クリア → 注意 → 要注意 の順に並ぶ', () => {
    // 負債比率: 良好 100% 以下、200% 超は要注意
    const s = bulletScale('debtToEquity', 150)
    expect(s?.zones.map((z) => z.level)).toEqual(['good', 'caution', 'danger'])
  })

  it('危険ラインが無い指標は 注意 と クリア の 2 帯', () => {
    // 当座比率: 良好 100% 以上のみ
    expect(bulletScale('quickRatio', 80)?.zones.map((z) => z.level)).toEqual(['caution', 'good'])
    // 固定比率: 良好 100% 以下のみ
    expect(bulletScale('fixedRatio', 80)?.zones.map((z) => z.level)).toEqual(['good', 'caution'])
  })

  it('値の位置は 0 以上 1 以下に収まる(範囲外の値でも帯の端まで)', () => {
    for (const value of [-500, -1, 0, 20, 30, 1000, 1e9]) {
      const s = bulletScale('equityRatio', value)
      expect(s).not.toBeNull()
      expect(s?.marker).toBeGreaterThanOrEqual(0)
      expect(s?.marker).toBeLessThanOrEqual(1)
    }
  })

  it('値が良いほど、大きいほど良い指標のマーカーは右に寄る', () => {
    const low = bulletScale('equityRatio', 5)
    const high = bulletScale('equityRatio', 60)
    expect(high!.marker).toBeGreaterThan(low!.marker)
  })

  it('目安線の位置が値の変化に合わせて動かない帯の境界として返る', () => {
    const s = bulletScale('equityRatio', 20)
    expect(s?.goodAt).toBeGreaterThan(0)
    expect(s?.goodAt).toBeLessThan(1)
  })

  it('目安が無い指標や算出できない値は null', () => {
    expect(bulletScale('grossMargin', 30)).toBeNull()
    expect(bulletScale('equityRatio', null)).toBeNull()
  })

  it('値が目安ちょうどでも、範囲が 0 幅にならない', () => {
    // 総資本回転率: 良好 1 回以上(危険ラインなし)
    const s = bulletScale('totalAssetTurnover', 1)
    expect(s).not.toBeNull()
    expect(s!.zones[0].to).toBeGreaterThan(0)
    expect(s!.zones[0].to).toBeLessThan(1)
  })
})

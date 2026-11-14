import { getMetricDefinition, roundForDisplay, type MetricKey } from './catalog'

/** 目安との差。プラスなら目安より良く、マイナスなら目安より悪い(指標の単位のまま) */
export function gapToGuideline(key: MetricKey, value: number | null): number | null {
  const def = getMetricDefinition(key)
  const g = def.guideline
  if (g === undefined || value === null) {
    return null
  }
  // 画面に出す桁で比べる(「150.0%」と出ているのに「目安に届かない」とならないように)
  const v = roundForDisplay(value, def.unit)
  return g.direction === 'higher' ? v - g.good : g.good - v
}

export type ZoneLevel = 'good' | 'caution' | 'danger'

/** 帯グラフの 1 区間。from / to は 0(左端)〜 1(右端)の位置 */
export interface Zone {
  readonly level: ZoneLevel
  readonly from: number
  readonly to: number
}

export interface BulletScale {
  /** 左から右へ並んだ評価の帯 */
  readonly zones: readonly Zone[]
  /** 現在値の位置(範囲外は端に寄せる) */
  readonly marker: number
  /** 「クリア」の境目の位置 */
  readonly goodAt: number
}

/** これより狭い帯は描かない(目安と要注意ラインが同じ値の指標など) */
const MIN_ZONE_WIDTH = 1e-9

/** 目安の線から、帯の外側にどれだけ余白を取るか(帯の幅の何倍まで広げるか) */
const MARGIN = 1
const MAX_EXPAND = 3

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/**
 * 目安に照らした帯グラフ(バレットチャート)の位置を計算する。
 * 目安が無い指標や、値が算出できないときは null。
 * 範囲は目安の線を基準に決め、極端な値で帯が潰れないよう、広げる幅には上限を設ける。
 */
export function bulletScale(key: MetricKey, value: number | null): BulletScale | null {
  const def = getMetricDefinition(key)
  const g = def.guideline
  if (g === undefined || value === null) {
    return null
  }
  const v = roundForDisplay(value, def.unit)
  const danger = g.danger
  const lines = danger === undefined ? [g.good] : [g.good, danger]
  const innerMin = Math.min(...lines)
  const innerMax = Math.max(...lines)
  const width = Math.max(innerMax - innerMin, Math.abs(g.good) * 0.5, 1)

  const lo = Math.max(innerMin - MAX_EXPAND * width, Math.min(innerMin - MARGIN * width, v))
  const hi = Math.min(innerMax + MAX_EXPAND * width, Math.max(innerMax + MARGIN * width, v))
  const at = (x: number): number => (x - lo) / (hi - lo)

  // 左から右へ、境目を並べて帯を作る
  const raw: readonly { level: ZoneLevel; from: number; to: number }[] =
    g.direction === 'higher'
      ? danger === undefined
        ? [
            { level: 'caution', from: 0, to: at(g.good) },
            { level: 'good', from: at(g.good), to: 1 },
          ]
        : [
            { level: 'danger', from: 0, to: at(danger) },
            { level: 'caution', from: at(danger), to: at(g.good) },
            { level: 'good', from: at(g.good), to: 1 },
          ]
      : danger === undefined
        ? [
            { level: 'good', from: 0, to: at(g.good) },
            { level: 'caution', from: at(g.good), to: 1 },
          ]
        : [
            { level: 'good', from: 0, to: at(g.good) },
            { level: 'caution', from: at(g.good), to: at(danger) },
            { level: 'danger', from: at(danger), to: 1 },
          ]

  return {
    zones: raw.filter((z) => z.to - z.from > MIN_ZONE_WIDTH),
    marker: clamp01(at(v)),
    goodAt: at(g.good),
  }
}

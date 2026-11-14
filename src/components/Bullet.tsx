import { bulletScale, type ZoneLevel } from '../domain/benchmark'
import type { MetricDefinition } from '../domain/catalog'

const ZONE_CLASS: Record<ZoneLevel, string> = {
  good: 'bg-green-200',
  caution: 'bg-yellow-200',
  danger: 'bg-red-200',
}

/**
 * 目安に照らした帯グラフ。マーカーが現在値、帯の色が評価の区間(緑 = クリア、黄 = 注意、赤 = 要注意)。
 * 色だけに頼らないよう、評価は隣のバッジと文章でも示す(この図は読み上げの対象外)。
 */
export function Bullet({ def, value }: { readonly def: MetricDefinition; readonly value: number | null }) {
  const scale = bulletScale(def.key, value)
  if (scale === null) {
    return null
  }
  return (
    <div aria-hidden="true" className="relative mt-2 h-4 overflow-hidden rounded-6 border border-solid-gray-420">
      {scale.zones.map((z) => (
        <div
          key={z.level}
          className={`absolute inset-y-0 ${ZONE_CLASS[z.level]}`}
          style={{ left: `${z.from * 100}%`, width: `${(z.to - z.from) * 100}%` }}
        />
      ))}
      <div
        className="absolute inset-y-0 w-1 -translate-x-1/2 bg-solid-gray-900"
        // 端の値でもマーカーが欠けないよう、左右 2px の余白を除いた幅で位置を決める
        style={{ left: `calc(2px + (100% - 4px) * ${scale.marker})` }}
      />
    </div>
  )
}

import type { EvaluationLevel } from '../domain/catalog'

export interface LevelStyle {
  readonly label: string
  readonly mark: string
  readonly className: string
}

/** 評価の段階ごとの表示。色だけに頼らず、記号と文字でも伝える */
export const LEVEL_STYLE: Record<EvaluationLevel, LevelStyle> = {
  good: {
    label: '目安をクリア',
    mark: '◎',
    className: 'border-green-800 bg-green-50 text-green-1000',
  },
  caution: {
    label: '注意',
    mark: '△',
    className: 'border-yellow-900 bg-yellow-50 text-yellow-1100',
  },
  danger: {
    label: '要注意',
    mark: '▲',
    className: 'border-red-900 bg-red-50 text-red-1100',
  },
  unknown: {
    label: '目安なし',
    mark: '−',
    className: 'border-solid-gray-420 bg-solid-gray-50 text-solid-gray-800',
  },
}

/** 軸(成長性・収益性・安定性)ぜんたいの判定の言い方 */
export const AXIS_VERDICT_LABEL: Record<EvaluationLevel, string> = {
  good: '良好',
  caution: '注意',
  danger: '要注意',
  unknown: '判定できません',
}

export function levelMark(level: EvaluationLevel): string {
  return LEVEL_STYLE[level].mark
}

export function levelLabel(level: EvaluationLevel): string {
  return LEVEL_STYLE[level].label
}

import type { ReactNode } from 'react'
import type { EvaluationLevel } from '../domain/catalog'
import { LEVEL_STYLE } from './levelStyle'

interface SectionProps {
  readonly title: string
  readonly lead?: string
  readonly children: ReactNode
}

/** 見出し + 説明 + 本文のまとまり */
export function Section({ title, lead, children }: SectionProps) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="text-[1.375rem] font-bold leading-snug text-solid-gray-900">{title}</h2>
      {lead ? <p className="mt-2 max-w-[44rem] text-solid-gray-800">{lead}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  )
}

interface PanelProps {
  readonly title?: string
  readonly note?: string
  readonly children: ReactNode
}

/** グラフや表を載せる枠 */
export function Panel({ title, note, children }: PanelProps) {
  return (
    <div className="rounded-8 border border-solid-gray-420 bg-white p-4 sm:p-6">
      {title ? <h3 className="text-lg font-bold text-solid-gray-900">{title}</h3> : null}
      {note ? <p className="mt-1 text-solid-gray-700">{note}</p> : null}
      <div className={title || note ? 'mt-4' : ''}>{children}</div>
    </div>
  )
}

/** 評価の段階。色だけに頼らず、記号と文字でも伝える */
export function LevelBadge({ level }: { readonly level: EvaluationLevel }) {
  const s = LEVEL_STYLE[level]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-6 border px-2.5 py-0.5 text-base font-bold ${s.className}`}
    >
      <span aria-hidden="true">{s.mark}</span>
      {s.label}
    </span>
  )
}

/** グラフ・表の右上に置く、単位の表示(例: 「単位: 百万円」)。数字だけが並ぶ図に、必ず添える */
export function UnitNote({ children }: { readonly children: string }) {
  return <p className="tnum mb-1 text-right text-sm text-solid-gray-700">{children}</p>
}

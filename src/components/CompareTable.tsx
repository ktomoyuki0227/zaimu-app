import type { ReactNode } from 'react'
import type { CompareColumn } from '../domain/compare'
import { basisLabel } from '../domain/basis'

export interface CompareTableRow {
  readonly key: string
  readonly label: string
  /** 行の見出しに添える、小さな説明(目安など) */
  readonly hint?: string
  readonly cells: readonly ReactNode[]
}

interface Props {
  readonly caption: string
  readonly columns: readonly CompareColumn[]
  readonly rows: readonly CompareTableRow[]
}

/** 企業の列の見出し: 企業名・最新の期・範囲(連結・単体) */
function ColumnHeading({ column }: { readonly column: CompareColumn }) {
  return (
    <>
      <span className="block font-bold">{column.name}</span>
      <span className="block text-sm font-normal text-solid-gray-700">
        {column.label}
        {column.basis === undefined ? '' : `(${basisLabel(column.basis)})`}
      </span>
    </>
  )
}

/**
 * 企業を横に並べた表(行: 項目、列: 企業)。狭い画面では、横にスクロールし、項目の列は左に残す。
 * 表の見出し(caption)は、読み上げ用。見える見出しは、呼び出し側の節の題で出す。
 */
export function CompareTable({ caption, columns, rows }: Props) {
  return (
    // 横にスクロールする領域は、キーボードで届くようにする(スクロールできる領域に、キーボードで入れない環境がある)
    <div role="region" aria-label={caption} tabIndex={0} className="relative overflow-x-auto">
      <table className="tnum w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-solid-gray-900">
            <th scope="col" className="sticky left-0 z-[1] bg-white py-2 pr-4">
              <span className="sr-only">項目</span>
            </th>
            {columns.map((c) => (
              <th key={c.id} scope="col" className="min-w-[8.5rem] px-3 py-2 align-bottom">
                <ColumnHeading column={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-solid-gray-200 align-top">
              <th scope="row" className="sticky left-0 z-[1] bg-white py-2 pr-4 font-normal">
                <span className="block">{row.label}</span>
                {row.hint === undefined ? null : <span className="block text-sm text-solid-gray-700">{row.hint}</span>}
              </th>
              {row.cells.map((cell, i) => (
                <td key={columns[i]?.id ?? i} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

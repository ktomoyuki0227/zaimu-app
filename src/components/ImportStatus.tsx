import { useEffect, useRef } from 'react'
import { attentionItems, type AttentionItem } from '../domain/import/review'
import { amountInUnit } from '../domain/import/toCompany'
import type { ExtractionResult } from '../domain/import/types'
import type { AmountUnit, Company } from '../domain/types'
import { formatAmount } from '../lib/format'
import type { BatchItem, ImportPhase } from './useImport'

const STATUS_TEXT = {
  missing: { mark: '▲', text: '見つからず、0 で仮置き' },
  derived: { mark: '△', text: '差額や近似で算出' },
  found: { mark: '△', text: '合算して算出' },
  notApplicable: { mark: '−', text: '該当なし' },
} as const

function AttentionTable({ items, unit }: { readonly items: readonly AttentionItem[]; readonly unit: AmountUnit }) {
  return (
    <div className="relative mt-3 overflow-x-auto">
      <table className="tnum w-full min-w-[40rem] border-collapse text-left">
        <caption className="sr-only">確認してほしい項目(単位: {unit})</caption>
        <thead>
          <tr className="border-b-2 border-solid-gray-900">
            <th scope="col" className="py-2 pr-3">期</th>
            <th scope="col" className="py-2 pr-3">項目</th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right">値({unit})</th>
            <th scope="col" className="py-2 pr-3">状態</th>
            <th scope="col" className="py-2">書類上の根拠</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const s = STATUS_TEXT[item.status]
            return (
              <tr key={`${item.periodLabel}-${item.fieldLabel}-${i}`} className="border-b border-solid-gray-200 align-top">
                <td className="py-2 pr-3">{item.periodLabel}</td>
                <td className="py-2 pr-3">{item.fieldLabel}</td>
                <td className="py-2 pr-3 text-right">{formatAmount(amountInUnit(item.valueYen, unit))}</td>
                <td className="py-2 pr-3">
                  <span aria-hidden="true">{s.mark} </span>
                  {s.text}
                </td>
                <td className="py-2">{item.sources.length > 0 ? item.sources.join(' / ') : (item.note ?? '−')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface ReviewProps {
  readonly fileName: string
  readonly result: ExtractionResult
  readonly company: Company | null
  readonly onApply: () => void
  readonly onCancel: () => void
}

function ReviewBlock({ fileName, result, company, onApply, onCancel }: ReviewProps) {
  const items = attentionItems(result)
  const blocked = company === null
  const panelRef = useRef<HTMLDivElement>(null)
  // 確認が必要なことを、読み上げ・キーボードの利用者にも伝えるため、表示されたらフォーカスを移す
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="rounded-8 border border-yellow-900 bg-yellow-50 p-4 text-yellow-1100"
    >
      <p className="font-bold">
        {blocked ? '▲ このファイルは読み込めません' : '△ 確認してから読み込みます'}
        <span className="font-normal">({fileName})</span>
      </p>

      {result.errors.length > 0 ? (
        <ul className="mt-2 list-disc pl-5">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      {result.warnings.length > 0 ? (
        <>
          <p className="mt-3 font-bold">確認してほしい点</p>
          <ul className="mt-1 list-disc pl-5">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      ) : null}

      {items.length > 0 ? (
        <>
          <p className="mt-3 font-bold">自動で決めきれなかった項目</p>
          <p>
            0 で仮置きした項目や、差額で求めた項目です。読み込むと、この値のまま分析します
            (仮置きした項目に関わる指標は、実際とずれることがあります)。
          </p>
          <AttentionTable items={items} unit={company?.unit ?? '円'} />
        </>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {company !== null ? (
          <button
            type="button"
            onClick={onApply}
            className="min-h-11 rounded-8 bg-blue-900 px-5 py-2 font-bold text-white hover:bg-blue-1000 active:bg-blue-1200"
          >
            この内容で読み込む
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-8 border border-blue-900 bg-white px-5 py-2 font-bold text-blue-900 hover:bg-blue-50 active:bg-blue-100"
        >
          {blocked ? '閉じる' : '読み込まない'}
        </button>
      </div>
    </div>
  )
}

const BATCH_MARK = { applied: '✓', review: '△', failed: '▲' } as const
const BATCH_TEXT = {
  applied: '読み込みました',
  review: '確認が必要です(まだ読み込んでいません)',
  failed: '読み込めませんでした',
} as const

interface BatchProps {
  readonly items: readonly BatchItem[]
  readonly companyId: string | null
  readonly onReviewItem: (index: number) => void
  readonly onOpenCompany: (id: string) => void
  readonly onClose: () => void
}

/** まとめて取り込んだ書類ごとの結果。確認が必要なもの・読めなかったものを知らせる */
function BatchBlock({ items, companyId, onReviewItem, onOpenCompany, onClose }: BatchProps) {
  const applied = items.filter((i) => i.status === 'applied').length
  const panelRef = useRef<HTMLDivElement>(null)
  // 結果が出たことを、読み上げ・キーボードの利用者にも伝えるため、表示されたらフォーカスを移す
  useEffect(() => {
    panelRef.current?.focus()
  }, [])
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="rounded-8 border border-yellow-900 bg-yellow-50 p-4 text-yellow-1100"
    >
      <p className="font-bold">
        {applied === items.length
          ? `${items.length} 件の書類を、すべて読み込みました。`
          : `${items.length} 件の書類のうち、${applied} 件を読み込みました。残りは確認が必要か、読み込めませんでした。`}
      </p>
      <ul className="mt-2 list-none space-y-2 p-0">
        {items.map((item, i) => (
          <li key={`${item.fileName}-${i}`}>
            <span aria-hidden="true">{BATCH_MARK[item.status]} </span>
            <span className="font-bold">{item.fileName}</span>: {BATCH_TEXT[item.status]}
            {item.message ? <span className="block pl-6">{item.message}</span> : null}
            {item.status === 'review' ? (
              <button
                type="button"
                onClick={() => onReviewItem(i)}
                className="ml-6 text-blue-900 underline underline-offset-4 hover:text-blue-1000"
              >
                内容を確認する
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-3">
        {companyId !== null ? (
          <button
            type="button"
            onClick={() => onOpenCompany(companyId)}
            className="min-h-11 rounded-8 bg-blue-900 px-5 py-2 font-bold text-white hover:bg-blue-1000 active:bg-blue-1200"
          >
            読み込んだ分で分析を見る
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-8 border border-blue-900 bg-white px-5 py-2 font-bold text-blue-900 hover:bg-blue-50 active:bg-blue-100"
        >
          閉じる
        </button>
      </div>
    </div>
  )
}

interface Props {
  readonly phase: ImportPhase
  readonly onApply: () => void
  readonly onClose: () => void
  /** まとめて取り込んだうち、確認が必要な 1 件を開く */
  readonly onReviewItem: (index: number) => void
  readonly onOpenCompany: (id: string) => void
}

/** 読み込みの途中経過・エラー・確認を、ヘッダーの下に出す。何も無いときは何も出さない */
export function ImportStatus({ phase, onApply, onClose, onReviewItem, onOpenCompany }: Props) {
  return (
    <div>
      {/* 読み上げ対象の領域は常に置いておき、中身だけを差し込む */}
      <div role="status" aria-live="polite">
        {phase.kind === 'reading' ? (
          <p className="mt-4 font-bold">「{phase.fileName}」を読み取っています…</p>
        ) : null}
      </div>
      {phase.kind === 'error' ? (
        <p role="alert" className="mt-4 rounded-8 border border-red-900 bg-red-50 p-3 text-red-1100">
          ▲ {phase.fileName ? `「${phase.fileName}」を読み込めませんでした。` : ''}
          {phase.message}
          <button
            type="button"
            onClick={onClose}
            className="ml-3 text-blue-900 underline underline-offset-4 hover:text-blue-1000"
          >
            閉じる
          </button>
        </p>
      ) : null}
      {phase.kind === 'batch' ? (
        <div className="mt-4">
          <BatchBlock
            items={phase.items}
            companyId={phase.companyId}
            onReviewItem={onReviewItem}
            onOpenCompany={onOpenCompany}
            onClose={onClose}
          />
        </div>
      ) : null}
      {phase.kind === 'review' ? (
        <div className="mt-4">
          <ReviewBlock
            fileName={phase.fileName}
            result={phase.result}
            company={phase.company}
            onApply={onApply}
            onCancel={onClose}
          />
        </div>
      ) : null}
    </div>
  )
}

import type { ExtractionResult } from '../domain/import/types'
import type { Company } from '../domain/types'

export interface ImportNotice {
  readonly fileName: string
  readonly company: Company
  readonly result: ExtractionResult
}

interface Props {
  readonly notice: ImportNotice
  readonly onUndo: () => void
  readonly onClose: () => void
}

/** ファイルを読み込んだ直後に出す知らせ。取り消せる */
export function ImportBanner({ notice, onUndo, onClose }: Props) {
  const { company, result } = notice
  const labels = company.periods.map((p) => p.label).join('、')
  return (
    <div className="mb-6 rounded-8 border border-green-800 bg-green-50 p-3 text-green-1000">
      <p className="font-bold">
        ✓ 「{notice.fileName}」から読み込みました
      </p>
      <p>
        {company.name} / {labels}(単位: {company.unit ?? '未設定'}、
        {result.consolidation === 'consolidated' ? '連結(連結が無い会社は単体)' : '個別'})
      </p>
      {result.notes.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={onUndo}
          className="text-blue-900 underline underline-offset-4 hover:text-blue-1000"
        >
          元に戻す
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-blue-900 underline underline-offset-4 hover:text-blue-1000"
        >
          この知らせを閉じる
        </button>
      </div>
    </div>
  )
}

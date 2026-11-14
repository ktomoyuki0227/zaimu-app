import { LINK_PLAIN } from './styles'

interface Props {
  readonly saveFailed: boolean
  readonly showCorrupted: boolean
  readonly onDismissCorrupted: () => void
  readonly statusMessage: string | null
  readonly onDismissStatus: () => void
}

/** 保存の失敗・保存データの破損・操作の結果の知らせ。読み上げ対象の領域は、中身が無くても置いておく */
export function Notices({ saveFailed, showCorrupted, onDismissCorrupted, statusMessage, onDismissStatus }: Props) {
  return (
    <>
      {saveFailed ? (
        <p className="mb-6 rounded-8 border border-yellow-900 bg-yellow-50 p-3 text-yellow-1100">
          △ このブラウザでは、取り込んだデータを保存できません。ページを閉じると消えるので注意してください。
        </p>
      ) : null}
      {showCorrupted ? (
        <div className="mb-6 rounded-8 border border-yellow-900 bg-yellow-50 p-3 text-yellow-1100">
          <p>
            △ 保存されていたデータを読み込めなかったため、空の状態で始めます。
            元のデータはこのブラウザ内に退避してあり、上書きされません。
          </p>
          <button type="button" onClick={onDismissCorrupted} className={`mt-2 ${LINK_PLAIN}`}>
            このお知らせを閉じる
          </button>
        </div>
      ) : null}
      {statusMessage !== null ? (
        <p className="mb-6 font-bold text-solid-gray-900">
          {statusMessage}
          <button type="button" onClick={onDismissStatus} className={`ml-3 ${LINK_PLAIN}`}>
            閉じる
          </button>
        </p>
      ) : null}
    </>
  )
}

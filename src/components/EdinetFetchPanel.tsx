import { useEffect, useId, useRef } from 'react'
import type { CompanyHit, LocalApiStatus } from '../lib/edinet/localApi'
import { disabledReason, fiscalYearEndText } from './edinetFetchModel'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD } from './styles'
import { YEAR_CHOICES, useEdinetFetch } from './useEdinetFetch'
import type { FetchedDocument } from './useImport'

const MAX_QUERY_LENGTH = 100

interface Props {
  /** 取得した書類を、取り込む(古い期から順) */
  readonly onDocuments: (documents: readonly FetchedDocument[]) => void
  /** 中継が使えるかどうかが分かったとき(ready: 使える / needsKey: API キー未設定 / unavailable: 使えない) */
  readonly onStatusKnown?: (kind: LocalApiStatus['kind']) => void
}

function CompanyRow({
  company,
  reason,
  onFetch,
}: {
  readonly company: CompanyHit
  readonly reason: string | null
  readonly onFetch: () => void
}) {
  const reasonId = useId()
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="grow basis-60">
        <p className="font-bold">{company.name}</p>
        <p className="tnum text-solid-gray-700">
          {company.secCode !== null ? `証券コード ${company.secCode.slice(0, 4)} ・ ` : ''}
          {company.edinetCode} ・ {fiscalYearEndText(company.fiscalYearEnd)}
          {company.listed ? ' ・ 上場' : ''}
        </p>
        {reason !== null ? (
          <p id={reasonId} className="text-solid-gray-700">
            {reason}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={reason !== null}
        aria-describedby={reason !== null ? reasonId : undefined}
        onClick={onFetch}
        className={BUTTON_PRIMARY}
      >
        有価証券報告書を取得する
      </button>
    </li>
  )
}

/** API キーが未設定のときの、設定の案内 */
function KeySetupGuide() {
  return (
    <div className="mt-2">
      <p>EDINET から自動で取得するには、API キーの設定が必要です。いまは企業を探すところまで使えます。</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>EDINET の閲覧サイトでアカウントを作り、API キーを発行します(メール・パスワード・SMS の確認コード)。</li>
        <li>
          プロジェクトの <code>.env</code> に <code>EDINET_API_KEY=発行したキー</code>{' '}
          と書きます(キーは他人に見せず、チャットにも貼りません)。
        </li>
        <li>開発サーバーを起こし直します。</li>
      </ol>
      <p className="mt-2 text-solid-gray-700">くわしい手順は docs/edinet-local-fetch.md にあります。</p>
    </div>
  )
}

/** EDINET から、企業の有価証券報告書を探して取り込む。この PC 内の中継が使えるときだけ出す */
export function EdinetFetchPanel({ onDocuments, onStatusKnown }: Props) {
  const queryId = useId()
  const yearsId = useId()
  const f = useEdinetFetch({ onDocuments, onStatusKnown })
  const { status, task, running, busy } = f
  const progressRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLParagraphElement>(null)
  const finished = task.kind === 'done' || task.kind === 'error'
  // 進み具合を出す間だけ入る(TypeScript に、headline と detail があることを伝える)
  const progress = task.kind === 'scanning' || task.kind === 'downloading' ? task : null

  // 取得を始めたら進み具合の欄へ、終わったら結果へフォーカスを移す(押したボタンが消えたり無効になったりするため)
  const wasRunning = useRef(false)
  useEffect(() => {
    if (running && !wasRunning.current) progressRef.current?.focus()
    if (finished) resultRef.current?.focus()
    wasRunning.current = running
  }, [running, finished])

  if (status === null || status.kind === 'unavailable') {
    return null
  }

  return (
    <section aria-labelledby="edinet-title" className="mt-6 rounded-8 border border-solid-gray-420 bg-white p-4 sm:p-6">
      <h2 id="edinet-title" className="text-lg font-bold">
        企業名・証券コードで探して、自動で取り込む
      </h2>

      {status.kind === 'needsKey' ? (
        <KeySetupGuide />
      ) : (
        <p className="mt-1 text-solid-gray-800">
          EDINET から有価証券報告書を取得し、直近の数年分をまとめて取り込みます。取得はこの PC 内で行い、
          API キーは画面には渡りません。
        </p>
      )}

      <form onSubmit={(e) => void f.search(e)} className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="grow basis-64">
          <label htmlFor={queryId} className="block font-bold">
            企業名・証券コード・EDINET コード
          </label>
          <input
            id={queryId}
            type="text"
            value={f.query}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(e) => f.setQuery(e.target.value)}
            placeholder="例: 7203 / サンプル製作所"
            className={`${FIELD} mt-1 w-full`}
          />
        </div>
        <button type="submit" disabled={busy || f.query.trim() === ''} className={BUTTON_PRIMARY}>
          企業を探す
        </button>
      </form>

      {/* 読み上げに出すのは、変化の少ない文だけ(1 日ごとの細かい進み具合は、画面にだけ出す) */}
      <div role="status" aria-live="polite">
        {task.kind === 'searching' ? <p className="mt-3 font-bold">探しています…</p> : null}
        {f.hits !== null && task.kind !== 'searching' ? (
          <p className="mt-3">
            {f.hits.length === 0 ? '該当する企業が見つかりませんでした。' : `${f.hits.length} 件の企業が見つかりました。`}
          </p>
        ) : null}
        {progress !== null ? <p className="mt-3 font-bold">{progress.headline}</p> : null}
      </div>
      {progress !== null ? (
        <div ref={progressRef} tabIndex={-1} className="mt-1">
          <p aria-hidden="true" className="tnum text-solid-gray-700">
            {progress.detail}
          </p>
          <button type="button" onClick={f.cancel} className={`${BUTTON_SECONDARY} mt-2`}>
            中止する
          </button>
        </div>
      ) : null}
      {task.kind === 'done' ? (
        <p ref={resultRef} tabIndex={-1} className="mt-3 font-bold">
          {task.company.name}: {task.text}
        </p>
      ) : null}
      {task.kind === 'error' ? (
        <p
          ref={resultRef}
          tabIndex={-1}
          role="alert"
          className="mt-3 rounded-8 border border-red-900 bg-red-50 p-3 text-red-1100"
        >
          ▲ {task.message}
        </p>
      ) : null}

      {f.hits !== null && f.hits.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label htmlFor={yearsId} className="font-bold">
              取得する期間
            </label>
            <select
              id={yearsId}
              value={f.years}
              onChange={(e) => f.setYears(Number(e.target.value))}
              className={FIELD}
            >
              {YEAR_CHOICES.map((y) => (
                <option key={y} value={y}>
                  直近 {y} 事業年度の書類
                </option>
              ))}
            </select>
            <span className="text-solid-gray-700">書類 1 件に 2 期分が入っているので、期は 1 つ多くなります。</span>
          </div>
          <ul className="mt-3 list-none divide-y divide-solid-gray-200 p-0">
            {f.hits.map((c) => (
              <CompanyRow
                key={c.edinetCode}
                company={c}
                reason={disabledReason(c, status, busy)}
                onFetch={() => void f.fetchReports(c)}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

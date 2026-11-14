import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  fetchDocument,
  fetchStatus,
  searchCompanies,
  streamReports,
  type CompanyHit,
  type FiscalYearEnd,
  type LocalApiStatus,
  type ReportEvent,
  type ReportInfo,
} from '../lib/edinet/localApi'
import type { FetchedDocument } from './useImport'

const BUTTON_PRIMARY =
  'min-h-11 rounded-8 bg-blue-900 px-5 py-2 font-bold text-white hover:bg-blue-1000 active:bg-blue-1200 disabled:bg-solid-gray-420'
const BUTTON_SECONDARY =
  'min-h-11 rounded-8 border border-blue-900 bg-white px-4 py-2 font-bold text-blue-900 hover:bg-blue-50 active:bg-blue-100'
const FIELD = 'min-h-11 rounded-6 border border-solid-gray-536 bg-white px-3 py-2'

const YEAR_CHOICES = [2, 3, 4, 5] as const
const DEFAULT_YEARS = 3
const MAX_QUERY_LENGTH = 100

function fiscalYearEndText(fye: FiscalYearEnd | null): string {
  if (fye === null) return '決算日不明'
  return fye.day === 'end' ? `${fye.month}月末日決算` : `${fye.month}月${fye.day}日決算`
}

/** 「2025-03-31」→「2025年3月期」 */
function periodLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split('-')
  return `${Number(y)}年${Number(m)}月期`
}

type Task =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  /** headline: 読み上げに出す、事業年度ごとの粗い文。detail: 1 日ごとに変わる細かい文(読み上げには出さない) */
  | { readonly kind: 'scanning'; readonly company: CompanyHit; readonly headline: string; readonly detail: string }
  | { readonly kind: 'downloading'; readonly company: CompanyHit; readonly headline: string; readonly detail: string }
  | { readonly kind: 'done'; readonly company: CompanyHit; readonly text: string }
  | { readonly kind: 'error'; readonly message: string }

interface Props {
  /** 取得した書類を、取り込む(古い期から順) */
  readonly onDocuments: (documents: readonly FetchedDocument[]) => void
  /** 中継が使えるかどうかが分かったとき(ready: 使える / needsKey: API キー未設定 / unavailable: 使えない) */
  readonly onStatusKnown?: (kind: LocalApiStatus['kind']) => void
}

function scanTask(company: CompanyHit, event: Extract<ReportEvent, { type: 'progress' }>): Task {
  const place = event.cached ? '(保存済みの一覧)' : ''
  return {
    kind: 'scanning',
    company,
    headline: `${periodLabel(event.fiscalYearEnd)}の書類を探しています…`,
    detail: `${event.date} の提出分を確認中${place}(${event.checked} / 最大 ${event.planned} 日)`,
  }
}

/** 取得の結果の文章。見つからなかった事業年度や、まだ提出されていない可能性のある事業年度も知らせる */
function summaryText(count: number, notFound: readonly string[], pending: readonly string[]): string {
  const parts = [count === 0 ? '有価証券報告書が見つかりませんでした。' : `${count} 件の書類を取得しました。`]
  if (notFound.length > 0) parts.push(`見つからなかった事業年度: ${notFound.map(periodLabel).join('、')}。`)
  if (pending.length > 0) {
    parts.push(`まだ提出期限が来ていない事業年度(未提出の可能性): ${pending.map(periodLabel).join('、')}。`)
  }
  return parts.join('')
}

/** 取得するボタンを押せない理由。押せるなら null */
function disabledReason(company: CompanyHit, status: LocalApiStatus, busy: boolean): string | null {
  if (status.kind !== 'ready') return 'API キーが未設定のため、取得できません。'
  if (company.fiscalYearEnd === null) return '決算日が不明なため、有価証券報告書を探せません。'
  return busy ? '別の処理を実行中です。' : null
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

/** EDINET から、企業の有価証券報告書を探して取り込む。この PC 内の中継が使えるときだけ出す */
export function EdinetFetchPanel({ onDocuments, onStatusKnown }: Props) {
  const queryId = useId()
  const yearsId = useId()
  const [status, setStatus] = useState<LocalApiStatus | null>(null)
  const [query, setQuery] = useState('')
  const [years, setYears] = useState<number>(DEFAULT_YEARS)
  const [hits, setHits] = useState<readonly CompanyHit[] | null>(null)
  const [task, setTask] = useState<Task>({ kind: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLParagraphElement>(null)
  const running = task.kind === 'scanning' || task.kind === 'downloading'
  const finished = task.kind === 'done' || task.kind === 'error'

  const onStatusKnownRef = useRef(onStatusKnown)
  useEffect(() => {
    onStatusKnownRef.current = onStatusKnown
  })

  useEffect(() => {
    const abort = new AbortController()
    void fetchStatus(abort.signal).then((s) => {
      if (abort.signal.aborted) return
      setStatus(s)
      onStatusKnownRef.current?.(s.kind)
    })
    return () => abort.abort()
  }, [])

  // 画面を離れるとき、実行中の取得を止める
  useEffect(() => () => controller.current?.abort(), [])

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

  const busy = task.kind === 'searching' || running

  const cancel = (): void => {
    controller.current?.abort()
    setTask({ kind: 'idle' })
  }

  const search = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const q = query.trim()
    if (q === '' || busy) return
    const abort = new AbortController()
    controller.current = abort
    setTask({ kind: 'searching' })
    setHits(null)
    try {
      setHits(await searchCompanies(q, abort.signal))
      setTask({ kind: 'idle' })
    } catch (error) {
      if (!abort.signal.aborted) {
        setTask({ kind: 'error', message: error instanceof Error ? error.message : '企業を探せませんでした。' })
      }
    }
  }

  /** 事業年度の古い順に、書類をダウンロードする */
  const downloadAll = async (
    company: CompanyHit,
    reports: readonly ReportInfo[],
    signal: AbortSignal,
  ): Promise<FetchedDocument[]> => {
    const ordered = [...reports].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
    const documents: FetchedDocument[] = []
    for (const [i, report] of ordered.entries()) {
      setTask({
        kind: 'downloading',
        company,
        headline: `${periodLabel(report.periodEnd)}の書類をダウンロードしています…`,
        detail: `${i + 1} / ${ordered.length} 件目`,
      })
      documents.push({
        fileName: `${company.name} ${periodLabel(report.periodEnd)}`,
        bytes: await fetchDocument(report.docID, signal),
      })
    }
    return documents
  }

  const fetchReports = async (company: CompanyHit): Promise<void> => {
    if (busy) return
    const abort = new AbortController()
    controller.current = abort
    setTask({ kind: 'scanning', company, headline: '有価証券報告書を探しています…', detail: '' })
    try {
      let reports: readonly ReportInfo[] = []
      let notFound: readonly string[] = []
      let pending: readonly string[] = []
      let failure: string | null = null
      await streamReports(
        company.edinetCode,
        years,
        (e) => {
          if (e.type === 'progress') setTask(scanTask(company, e))
          else if (e.type === 'done') {
            reports = e.reports
            notFound = e.notFound
            pending = e.pending
          } else failure = e.message
        },
        abort.signal,
      )
      if (failure !== null) throw new Error(failure)
      if (reports.length === 0) {
        setTask({
          kind: 'done',
          company,
          text: summaryText(0, notFound, pending),
        })
        return
      }
      const documents = await downloadAll(company, reports, abort.signal)
      setTask({ kind: 'done', company, text: summaryText(documents.length, notFound, pending) })
      onDocuments(documents)
    } catch (error) {
      if (!abort.signal.aborted) {
        setTask({ kind: 'error', message: error instanceof Error ? error.message : '取得できませんでした。' })
      }
    }
  }

  return (
    <section aria-labelledby="edinet-title" className="mt-6 rounded-8 border border-solid-gray-420 bg-white p-4 sm:p-6">
      <h2 id="edinet-title" className="text-lg font-bold">
        企業名・証券コードで探して、自動で取り込む
      </h2>

      {status.kind === 'needsKey' ? (
        <div className="mt-2">
          <p>
            EDINET から自動で取得するには、API キーの設定が必要です。いまは企業を探すところまで使えます。
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>EDINET の閲覧サイトでアカウントを作り、API キーを発行します(メール・パスワード・SMS の確認コード)。</li>
            <li>
              プロジェクトの <code>.env</code> に <code>EDINET_API_KEY=発行したキー</code> と書きます(キーは他人に見せず、チャットにも貼りません)。
            </li>
            <li>開発サーバーを起こし直します。</li>
          </ol>
          <p className="mt-2 text-solid-gray-700">くわしい手順は docs/edinet-local-fetch.md にあります。</p>
        </div>
      ) : (
        <p className="mt-1 text-solid-gray-800">
          EDINET から有価証券報告書を取得し、直近の数年分をまとめて取り込みます。取得はこの PC 内で行い、
          API キーは画面には渡りません。
        </p>
      )}

      <form onSubmit={(e) => void search(e)} className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="grow basis-64">
          <label htmlFor={queryId} className="block font-bold">
            企業名・証券コード・EDINET コード
          </label>
          <input
            id={queryId}
            type="text"
            value={query}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例: 7203 / サンプル製作所"
            className={`${FIELD} mt-1 w-full`}
          />
        </div>
        <button type="submit" disabled={busy || query.trim() === ''} className={BUTTON_PRIMARY}>
          企業を探す
        </button>
      </form>

      {/* 読み上げに出すのは、変化の少ない文だけ(1 日ごとの細かい進み具合は、画面にだけ出す) */}
      <div role="status" aria-live="polite">
        {task.kind === 'searching' ? <p className="mt-3 font-bold">探しています…</p> : null}
        {hits !== null && task.kind !== 'searching' ? (
          <p className="mt-3">{hits.length === 0 ? '該当する企業が見つかりませんでした。' : `${hits.length} 件の企業が見つかりました。`}</p>
        ) : null}
        {running ? <p className="mt-3 font-bold">{task.headline}</p> : null}
      </div>
      {running ? (
        <div ref={progressRef} tabIndex={-1} className="mt-1">
          <p aria-hidden="true" className="tnum text-solid-gray-700">
            {task.detail}
          </p>
          <button type="button" onClick={cancel} className={`${BUTTON_SECONDARY} mt-2`}>
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

      {hits !== null && hits.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label htmlFor={yearsId} className="font-bold">
              取得する期間
            </label>
            <select id={yearsId} value={years} onChange={(e) => setYears(Number(e.target.value))} className={FIELD}>
              {YEAR_CHOICES.map((y) => (
                <option key={y} value={y}>
                  直近 {y} 事業年度の書類
                </option>
              ))}
            </select>
            <span className="text-solid-gray-700">書類 1 件に 2 期分が入っているので、期は 1 つ多くなります。</span>
          </div>
          <ul className="mt-3 list-none divide-y divide-solid-gray-200 p-0">
            {hits.map((c) => (
              <CompanyRow
                key={c.edinetCode}
                company={c}
                reason={disabledReason(c, status, busy)}
                onFetch={() => void fetchReports(c)}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

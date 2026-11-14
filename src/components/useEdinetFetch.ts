import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  fetchDocument,
  fetchStatus,
  searchCompanies,
  type CompanyHit,
  type LocalApiStatus,
  type ReportInfo,
} from '../lib/edinet/localApi'
import { periodLabel, scanReports, scanTask, summaryText, type Task } from './edinetFetchModel'
import type { FetchedDocument } from './useImport'

export const YEAR_CHOICES = [2, 3, 4, 5] as const
const DEFAULT_YEARS = 3

interface Options {
  /** 取得した書類を、取り込む(古い期から順) */
  readonly onDocuments: (documents: readonly FetchedDocument[]) => void
  /** 中継が使えるかどうかが分かったとき */
  readonly onStatusKnown?: (kind: LocalApiStatus['kind']) => void
}

/** 事業年度の古い順に、書類をダウンロードする */
async function downloadAll(
  company: CompanyHit,
  reports: readonly ReportInfo[],
  signal: AbortSignal,
  setTask: (task: Task) => void,
): Promise<FetchedDocument[]> {
  const ordered = [...reports].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
  const documents: FetchedDocument[] = []
  for (const [i, report] of ordered.entries()) {
    // 中止されたあとに、「ダウンロードしています」の表示に戻してしまわない
    signal.throwIfAborted()
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

/**
 * EDINET から企業を探して、有価証券報告書を取得する流れの状態と操作。
 * 画面を離れたら、実行中の通信は止める。
 */
export function useEdinetFetch({ onDocuments, onStatusKnown }: Options) {
  const [status, setStatus] = useState<LocalApiStatus | null>(null)
  const [query, setQuery] = useState('')
  const [years, setYears] = useState<number>(DEFAULT_YEARS)
  const [hits, setHits] = useState<readonly CompanyHit[] | null>(null)
  const [task, setTask] = useState<Task>({ kind: 'idle' })
  const controller = useRef<AbortController | null>(null)
  const running = task.kind === 'scanning' || task.kind === 'downloading'
  const busy = task.kind === 'searching' || running

  const onStatusKnownRef = useRef(onStatusKnown)
  const onDocumentsRef = useRef(onDocuments)
  useEffect(() => {
    onStatusKnownRef.current = onStatusKnown
    onDocumentsRef.current = onDocuments
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

  const cancel = useCallback((): void => {
    controller.current?.abort()
    setTask({ kind: 'idle' })
  }, [])

  const search = useCallback(
    async (event: FormEvent): Promise<void> => {
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
    },
    [query, busy],
  )

  const fetchReports = useCallback(
    async (company: CompanyHit): Promise<void> => {
      if (busy) return
      const abort = new AbortController()
      controller.current = abort
      setTask({ kind: 'scanning', company, headline: '有価証券報告書を探しています…', detail: '' })
      try {
        const { reports, notFound, pending } = await scanReports(
          company.edinetCode,
          years,
          (event) => setTask(scanTask(company, event)),
          abort.signal,
        )
        if (reports.length === 0) {
          setTask({ kind: 'done', company, text: summaryText(0, notFound, pending) })
          return
        }
        const documents = await downloadAll(company, reports, abort.signal, setTask)
        setTask({ kind: 'done', company, text: summaryText(documents.length, notFound, pending) })
        onDocumentsRef.current(documents)
      } catch (error) {
        if (!abort.signal.aborted) {
          setTask({ kind: 'error', message: error instanceof Error ? error.message : '取得できませんでした。' })
        }
      }
    },
    [busy, years],
  )

  return { status, query, setQuery, years, setYears, hits, task, busy, running, cancel, search, fetchReports }
}

import { useState } from 'react'
import { GrowthView } from './components/GrowthView'
import type { LocalApiStatus } from './lib/edinet/localApi'
import { HomeView } from './components/HomeView'
import { ImportBanner, type ImportNotice } from './components/ImportBanner'
import { MetricsView } from './components/MetricsView'
import { OverviewView } from './components/OverviewView'
import { useImport, type AppliedItem, type ApplyOptions } from './components/useImport'
import { SAMPLE_COMPANY } from './data/sample'
import { MAX_COMPANIES, removeCompany, upsertCompany } from './domain/portfolio'
import type { Company } from './domain/types'
import { loadCompanies, saveCompanies, type LoadResult } from './lib/storage'

type TabId = 'overview' | 'growth' | 'profitability' | 'stability'

const TABS: readonly { readonly id: TabId; readonly label: string; readonly hint: string }[] = [
  { id: 'overview', label: '概要', hint: 'ひとことで言うと' },
  { id: 'growth', label: '成長性', hint: '売上・利益の伸び' },
  { id: 'profitability', label: '収益性', hint: '儲ける力' },
  { id: 'stability', label: '安定性', hint: '倒れにくさ' },
]

const BUTTON_SECONDARY =
  'min-h-11 rounded-8 border border-blue-900 bg-white px-4 py-2 font-bold text-blue-900 hover:bg-blue-50 active:bg-blue-100'

/** 取り込む前の状態。取り消すと、ここに戻る */
interface Snapshot {
  readonly companies: readonly Company[]
  readonly selectedId: string | null
}

export default function App() {
  const [loaded] = useState<LoadResult>(loadCompanies)
  const [companies, setCompanies] = useState<readonly Company[]>(() =>
    loaded.status === 'ok' ? loaded.companies : [],
  )
  // null のとき、取り込みのページ(企業の一覧)を出す。選ぶと分析のページに移る
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [saveFailed, setSaveFailed] = useState(loaded.status === 'unavailable')
  const [showCorruptedNotice, setShowCorruptedNotice] = useState(loaded.status === 'corrupted')

  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null)
  const [beforeImport, setBeforeImport] = useState<Snapshot | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  // EDINET からの自動取得が使えるか。最初のページは企業の画面から戻るたびに作り直されるので、ここに持つ
  const [relay, setRelay] = useState<LocalApiStatus['kind'] | null>(null)

  const company = companies.find((c) => c.id === selectedId) ?? null

  // 変更のたびに保存する。保存に失敗したときは、その場でお知らせを出す
  const updateCompanies = (next: readonly Company[]): void => {
    setCompanies(next)
    setSaveFailed(!saveCompanies(next))
  }

  /** 知らせのボタンは、押すと知らせごと消える。キーボードの利用者が迷子にならないよう、本文へフォーカスを移す */
  const focusMain = (): void => {
    document.getElementById('main')?.focus()
  }

  const openCompany = (id: string, nextTab: TabId = 'overview'): void => {
    setSelectedId(id)
    setTab(nextTab)
    setStatusMessage(null)
    window.scrollTo({ top: 0 })
    // 押したボタンを含む画面が入れ替わるので、キーボードの利用者が迷子にならないよう、本文へフォーカスを移す
    window.setTimeout(focusMain, 0)
  }

  const openTab = (next: TabId): void => {
    setTab(next)
    window.scrollTo({ top: 0 })
  }

  const backToList = (): void => {
    setSelectedId(null)
    setImportNotice(null)
    window.scrollTo({ top: 0 })
  }

  /**
   * 読み込んだ企業を、一覧に足す(同じ企業は、期を積み上げる)。複数の書類は、古い期から順に積み上げる。
   * open が true なら、その企業の分析ページへ移り、取り消せる知らせを出す。
   */
  const applyImports = (items: readonly AppliedItem[], options: ApplyOptions): boolean => {
    let next: readonly Company[] | null = companies
    for (const item of items) {
      next = next === null ? null : upsertCompany(next, item.company)
    }
    if (next === null) {
      setStatusMessage(
        `取り込める企業は最大 ${MAX_COMPANIES} 社までです。不要な企業を削除してから、もう一度お試しください。`,
      )
      return false
    }
    const first = items[0]
    const last = items[items.length - 1]
    const merged = next.find((c) => c.id === first.company.id) ?? first.company
    updateCompanies(next)
    if (options.open) {
      // 取り消せるのは、分析ページへ移って、知らせ(元に戻す)が出る場合だけ
      setBeforeImport({ companies, selectedId })
      setImportNotice({
        fileName: items.length === 1 ? first.fileName : `${items.length} 件の書類`,
        company: merged,
        result: last.result,
      })
      openCompany(first.company.id)
    } else {
      setStatusMessage(`${items.length} 件の書類を読み込みました。`)
    }
    return true
  }

  const importer = useImport(applyImports, selectedId === null)

  const undoImport = (): void => {
    if (beforeImport !== null) {
      updateCompanies(beforeImport.companies)
      setSelectedId(beforeImport.selectedId)
    }
    setImportNotice(null)
    setBeforeImport(null)
    setStatusMessage('読み込みを取り消し、元の状態に戻しました。')
    focusMain()
  }

  const closeImportNotice = (): void => {
    setImportNotice(null)
    focusMain()
  }

  const addSample = (): void => {
    const next = upsertCompany(companies, SAMPLE_COMPANY)
    if (next === null) {
      setStatusMessage(`取り込める企業は最大 ${MAX_COMPANIES} 社までです。`)
      return
    }
    updateCompanies(next)
    openCompany(SAMPLE_COMPANY.id)
  }

  const deleteCompany = (id: string): void => {
    const target = companies.find((c) => c.id === id)
    if (target === undefined) return
    if (window.confirm(`「${target.name || '(名前なし)'}」を一覧から削除します。元に戻せません。よろしいですか?`)) {
      updateCompanies(removeCompany(companies, id))
      if (selectedId === id) setSelectedId(null)
    }
  }

  return (
    <div className="min-h-dvh bg-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:bg-white focus:p-2"
      >
        本文へ移動
      </a>

      {company !== null ? (
        <header className="border-b border-solid-gray-420 bg-white">
          <div className="mx-auto max-w-[70rem] px-4 pt-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={backToList} className={BUTTON_SECONDARY}>
                ← 企業の一覧へ
              </button>
              <p className="font-bold text-blue-900">財務ビュー</p>
            </div>
            <h1 className="mt-3 text-[2rem] font-bold leading-tight sm:text-[2.25rem]">
              {company.name || '(名前なし)'}
            </h1>
            <p className="tnum mt-1 text-solid-gray-800">
              {company.periods.length} 期分
              {company.unit !== undefined ? ` ・ 金額の単位: ${company.unit}` : null}
            </p>

            <nav aria-label="表示する内容" className="mt-3">
              <ul className="-mb-px flex list-none gap-1 overflow-x-auto p-0">
                {TABS.map((t) => {
                  const current = t.id === tab
                  return (
                    <li key={t.id} className="shrink-0">
                      <button
                        type="button"
                        aria-current={current ? 'page' : undefined}
                        onClick={() => openTab(t.id)}
                        className={`min-h-12 border-b-4 px-4 py-2 text-left ${
                          current
                            ? 'border-blue-900 font-bold text-blue-900'
                            : 'border-transparent text-solid-gray-800 hover:bg-blue-50'
                        }`}
                      >
                        <span className="block font-bold">{t.label}</span>
                        <span className="hidden text-sm font-normal text-solid-gray-700 sm:block">{t.hint}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>
          </div>
        </header>
      ) : null}

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[70rem] px-4 py-8 focus-visible:shadow-none focus-visible:outline-none sm:px-6 sm:py-10"
      >
        {/* 読み上げ対象の領域は常に置いておき、中身だけを差し込む(後から挿入した領域は読み上げられないことがある) */}
        <div role="status" aria-live="polite">
          {saveFailed ? (
            <p className="mb-6 rounded-8 border border-yellow-900 bg-yellow-50 p-3 text-yellow-1100">
              △ このブラウザでは、取り込んだデータを保存できません。ページを閉じると消えるので注意してください。
            </p>
          ) : null}
          {showCorruptedNotice ? (
            <div className="mb-6 rounded-8 border border-yellow-900 bg-yellow-50 p-3 text-yellow-1100">
              <p>
                △ 保存されていたデータを読み込めなかったため、空の状態で始めます。
                元のデータはこのブラウザ内に退避してあり、上書きされません。
              </p>
              <button
                type="button"
                onClick={() => setShowCorruptedNotice(false)}
                className="mt-2 text-blue-900 underline underline-offset-4 hover:text-blue-1000"
              >
                このお知らせを閉じる
              </button>
            </div>
          ) : null}
          {statusMessage !== null ? (
            <p className="mb-6 font-bold text-solid-gray-900">
              {statusMessage}
              <button
                type="button"
                onClick={() => setStatusMessage(null)}
                className="ml-3 font-normal text-blue-900 underline underline-offset-4 hover:text-blue-1000"
              >
                閉じる
              </button>
            </p>
          ) : null}
          {/* データが変わったら(別の企業を開いたときなど)、取り消しの知らせは出さない */}
          {company !== null && importNotice !== null && importNotice.company === company ? (
            <ImportBanner notice={importNotice} onUndo={undoImport} onClose={closeImportNotice} />
          ) : null}
        </div>

        {company === null ? (
          <HomeView
            companies={companies}
            importer={importer}
            onOpenCompany={(id) => openCompany(id)}
            onRemoveCompany={deleteCompany}
            onAddSample={addSample}
            relay={relay}
            onRelayKnown={setRelay}
          />
        ) : null}
        {company !== null && tab === 'overview' ? <OverviewView company={company} onOpen={openTab} /> : null}
        {company !== null && tab === 'growth' ? <GrowthView company={company} /> : null}
        {company !== null && tab === 'profitability' ? <MetricsView company={company} group="profitability" /> : null}
        {company !== null && tab === 'stability' ? <MetricsView company={company} group="stability" /> : null}
      </main>

      <footer className="border-t border-solid-gray-420">
        <p className="mx-auto max-w-[70rem] px-4 py-6 text-sm text-solid-gray-700 sm:px-6">
          学習用のツールです。投資や融資の判断を助言するものではありません。サンプルの会社は架空のものです。
        </p>
        <p className="mx-auto max-w-[70rem] px-4 pb-6 text-sm text-solid-gray-700 sm:px-6">
          EDINET から取得した財務データの出典: EDINET(金融庁)。公共データ利用規約(PDL1.0)に基づき、このツールで読み取り・計算・加工して表示しています(原文のままではありません)。
        </p>
      </footer>

      {importer.dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-900/85"
        >
          <p className="rounded-8 border-4 border-dashed border-white px-8 py-6 text-2xl font-bold text-white">
            ここにドロップして読み込む
          </p>
        </div>
      ) : null}
    </div>
  )
}

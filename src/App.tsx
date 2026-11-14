import { useEffect, useState } from 'react'
import { AppFooter } from './components/AppFooter'
import { CompanyHeader, type TabId } from './components/CompanyHeader'
import { GrowthView } from './components/GrowthView'
import { HomeView } from './components/HomeView'
import { ImportBanner, type ImportNotice } from './components/ImportBanner'
import { MetricsView } from './components/MetricsView'
import { Notices } from './components/Notices'
import { OverviewView } from './components/OverviewView'
import { useCompanies } from './components/useCompanies'
import { useImport, type AppliedItem, type ApplyOptions } from './components/useImport'
import { SAMPLE_COMPANY } from './data/sample'
import { MAX_COMPANIES, removeCompany, upsertAll, upsertCompany } from './domain/portfolio'
import type { Company } from './domain/types'
import type { LocalApiStatus } from './lib/edinet/localApi'
import { companyLabel } from './lib/format'

/** 取り込む前の状態。取り消すと、ここに戻る */
interface Snapshot {
  readonly companies: readonly Company[]
  readonly selectedId: string | null
  /** 取り込んだ時点の、別のタブからの書き換えの回数。変わっていたら、この状態に戻すと、他のタブの内容を消してしまう */
  readonly externalVersion: number
}

const LIMIT_MESSAGE = `取り込める企業は最大 ${MAX_COMPANIES} 社までです。不要な企業を削除してから、もう一度お試しください。`

export default function App() {
  const store = useCompanies()
  const { companies, update: updateCompanies } = store
  // null のとき、取り込みのページ(企業の一覧)を出す。選ぶと分析のページに移る
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('overview')

  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null)
  const [beforeImport, setBeforeImport] = useState<Snapshot | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  // EDINET からの自動取得が使えるか。最初のページは企業の画面から戻るたびに作り直されるので、ここに持つ
  const [relay, setRelay] = useState<LocalApiStatus['kind'] | null>(null)

  /**
   * 本文へフォーカスを移してほしい、という合図(増えるたびに移す)。
   * 押したボタンを含む画面が入れ替わったり、知らせが消えたりするので、キーボードの利用者が迷子にならないようにする。
   */
  const [focusRequest, setFocusRequest] = useState(0)
  useEffect(() => {
    if (focusRequest > 0) document.getElementById('main')?.focus()
  }, [focusRequest])
  const focusMain = (): void => setFocusRequest((n) => n + 1)

  const company = companies.find((c) => c.id === selectedId) ?? null
  // 取り込んだあとに、別のタブが一覧を書き換えたら、「元に戻す」は出さない(古い状態で、他のタブの内容を上書きしないため)
  const undoable = beforeImport !== null && beforeImport.externalVersion === store.externalVersion

  const openCompany = (id: string, nextTab: TabId = 'overview'): void => {
    setSelectedId(id)
    setTab(nextTab)
    setStatusMessage(null)
    window.scrollTo({ top: 0 })
    focusMain()
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
    if (items.length === 0) return true
    const next = upsertAll(
      companies,
      items.map((item) => item.company),
    )
    if (next === null) {
      setStatusMessage(LIMIT_MESSAGE)
      return false
    }
    const first = items[0]
    const last = items[items.length - 1]
    const merged = next.find((c) => c.id === first.company.id) ?? first.company
    updateCompanies(next)
    if (options.open) {
      // 取り消せるのは、分析ページへ移って、知らせ(元に戻す)が出る場合だけ
      setBeforeImport({ companies, selectedId, externalVersion: store.externalVersion })
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
      setStatusMessage(LIMIT_MESSAGE)
      return
    }
    updateCompanies(next)
    openCompany(SAMPLE_COMPANY.id)
  }

  const deleteCompany = (id: string): void => {
    const target = companies.find((c) => c.id === id)
    if (target === undefined) return
    if (window.confirm(`「${companyLabel(target)}」を一覧から削除します。元に戻せません。よろしいですか?`)) {
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

      {company !== null ? <CompanyHeader company={company} tab={tab} onBack={backToList} onTab={openTab} /> : null}

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[70rem] px-4 py-8 focus-visible:shadow-none focus-visible:outline-none sm:px-6 sm:py-10"
      >
        {/* 読み上げ対象の領域は常に置いておき、中身だけを差し込む(後から挿入した領域は読み上げられないことがある) */}
        <div role="status" aria-live="polite">
          <Notices
            saveFailed={store.saveFailed}
            showCorrupted={store.showCorruptedNotice}
            onDismissCorrupted={store.dismissCorruptedNotice}
            statusMessage={statusMessage}
            onDismissStatus={() => setStatusMessage(null)}
          />
          {/* データが変わったら(別の企業を開いたときなど)、取り消しの知らせは出さない */}
          {company !== null && importNotice !== null && importNotice.company === company && undoable ? (
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

      <AppFooter />

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

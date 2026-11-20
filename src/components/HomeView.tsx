import { useMemo } from 'react'
import { MIN_COMPARE } from '../domain/compare'
import { MAX_COMPANIES } from '../domain/portfolio'
import { summarize } from '../domain/overview'
import type { Company } from '../domain/types'
import type { LocalApiStatus } from '../lib/edinet/localApi'
import { companyLabel } from '../lib/format'
import { AXIS_VERDICT_LABEL, LEVEL_STYLE } from './levelStyle'
import { EdinetFetchPanel } from './EdinetFetchPanel'
import { ImportStatus } from './ImportStatus'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, LINK } from './styles'
import type { ImportController } from './useImport'


/** 企業ごとの、3 つの軸の判定(◎△▲)を小さく並べる */
function VerdictChips({ company }: { readonly company: Company }) {
  const overview = useMemo(() => summarize(company), [company])
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {overview.axes.map((axis) => {
        const style = LEVEL_STYLE[axis.verdict]
        return (
          <li
            key={axis.key}
            className={`inline-flex items-center gap-1.5 rounded-6 border px-2 py-0.5 text-sm font-bold ${style.className}`}
          >
            <span aria-hidden="true">{style.mark}</span>
            {axis.label}: {AXIS_VERDICT_LABEL[axis.verdict]}
          </li>
        )
      })}
    </ul>
  )
}

function CompanyCard({
  company,
  onOpen,
  onRemove,
}: {
  readonly company: Company
  readonly onOpen: () => void
  readonly onRemove: () => void
}) {
  const first = company.periods[0]
  const last = company.periods[company.periods.length - 1]
  return (
    <li className="flex flex-col rounded-8 border border-solid-gray-420 bg-white p-4">
      <h3 className="text-lg font-bold leading-snug">{companyLabel(company)}</h3>
      <p className="tnum mt-1 text-solid-gray-800">
        {first.label === last.label ? first.label : `${first.label} 〜 ${last.label}`}({company.periods.length} 期分
        {company.unit !== undefined ? `、単位: ${company.unit}` : ''})
      </p>
      <div className="mt-3 grow">
        <VerdictChips company={company} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onOpen} className={BUTTON_PRIMARY}>
          分析を見る
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${companyLabel(company)}を一覧から削除`}
          className="min-h-11 min-w-11 px-2 text-blue-900 underline underline-offset-4 hover:text-blue-1000"
        >
          削除
        </button>
      </div>
    </li>
  )
}

interface Props {
  readonly companies: readonly Company[]
  readonly importer: ImportController
  readonly onOpenCompany: (id: string) => void
  readonly onRemoveCompany: (id: string) => void
  readonly onAddSample: () => void
  /** 他社比較のページを開く(企業が 2 社以上あるときだけ、ボタンを出す) */
  readonly onCompare: () => void
  /** EDINET からの自動取得が使えるか(null: まだ分からない) */
  readonly relay: LocalApiStatus['kind'] | null
  readonly onRelayKnown: (kind: LocalApiStatus['kind']) => void
}

/**
 * 最初のページ。企業名・証券コードで探すと、EDINET から有価証券報告書を取得して分析のページへ移る。
 * 取り込んだ企業は一覧に積み上がり、同じ企業の別年度の書類を取り込むと、その企業の期が増える。
 * 手元のファイル(EDINET の CSV)からの取り込みは、末尾の折りたたみに置く(ドロップは画面のどこでも効く)。
 * EDINET から自動で取得できない環境では、この折りたたみを最初から開き、取り込みの主な入口として案内する。
 */
export function HomeView({
  companies,
  importer,
  onOpenCompany,
  onRemoveCompany,
  onAddSample,
  onCompare,
  relay,
  onRelayKnown,
}: Props) {
  const {
    setPickerButton,
    setHomeFocus,
    setInput,
    openPicker,
    onInputChange,
    phase,
    applyReview,
    closeReview,
    importDocuments,
    reviewBatchItem,
  } = importer
  // EDINET から自動で取得できないとき(公開用の配信・API キー未設定)は、ファイルからの取り込みが主な入口になる
  const fileImportIsMain = relay === 'unavailable' || relay === 'needsKey'
  return (
    <div>
      <section aria-labelledby="home-title">
        <p className="font-bold text-blue-900">財務3表の指標を、グラフで読み解く</p>
        <h1
          id="home-title"
          ref={setHomeFocus}
          tabIndex={-1}
          className="text-[2rem] font-bold leading-tight outline-none sm:text-[2.5rem]"
        >
          財務ビュー
        </h1>
        <p className="mt-3 max-w-[44rem] text-solid-gray-800">
          {relay === 'unavailable'
            ? '有価証券報告書のファイル(EDINET の CSV)を、下の「手元のファイルから取り込む」から取り込むと、財務数値を自動で読み取り、成長性・収益性・安定性を分析します。'
            : '企業名か証券コードを入れると、EDINET から有価証券報告書を取得して、財務数値を自動で読み取り、成長性・収益性・安定性を分析します。'}
          読み取りはこの端末の中だけで行います。
        </p>
        <EdinetFetchPanel
          onDocuments={(documents) => void importDocuments(documents)}
          onStatusKnown={onRelayKnown}
        />
        <div>
          <ImportStatus
            phase={phase}
            onApply={applyReview}
            onClose={closeReview}
            onReviewItem={reviewBatchItem}
            onOpenCompany={onOpenCompany}
          />
        </div>
      </section>

      <section aria-labelledby="companies-title" className="mt-12">
        <h2 id="companies-title" className="text-[1.375rem] font-bold leading-snug">
          取り込んだ企業
          <span className="ml-2 text-base font-normal text-solid-gray-700">
            ({companies.length} / {MAX_COMPANIES} 社)
          </span>
        </h2>
        {companies.length >= MIN_COMPARE ? (
          <p className="mt-3">
            <button type="button" onClick={onCompare} className={BUTTON_SECONDARY}>
              企業を比べる(他社比較)
            </button>
          </p>
        ) : null}
        {companies.length === 0 ? (
          <p className="mt-3 text-solid-gray-800">
            {relay === 'unavailable'
              ? 'まだありません。ファイルを取り込むと、ここに積み上がります。'
              : 'まだありません。企業を探して取得すると、ここに積み上がります。'}
            同じ企業の別の年度を取り込むと、その企業の期が増えます。
          </p>
        ) : (
          <ul className="mt-4 grid list-none grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4 p-0">
            {companies.map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                onOpen={() => onOpenCompany(company.id)}
                onRemove={() => onRemoveCompany(company.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <details
        open={fileImportIsMain || undefined}
        className="mt-12 rounded-8 border border-solid-gray-420 bg-solid-gray-50 p-4 sm:p-6"
      >
        <summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">
          手元のファイルから取り込む
          <span className="ml-2 text-base font-normal text-solid-gray-700">(ファイルは画面のどこにドロップしても読めます)</span>
        </summary>
        <p className="mt-3 text-solid-gray-800">
          EDINET からダウンロードした有価証券報告書の「CSV」(zip のまま)を、1 ファイルずつ取り込めます。
          ファイルは、この画面のどこにドロップしても読み込めます。読み取りはこの端末の中だけで行い、ファイルや数字を外部には送りません。
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <button ref={setPickerButton} type="button" onClick={openPicker} className={BUTTON_PRIMARY}>
            ファイルを選ぶ
          </button>
          <span className="text-solid-gray-700">
            ファイルが無いときは、
            <a href={`${import.meta.env.BASE_URL}samples/edinet-sample-ok.zip`} download className={LINK}>
              架空の企業のサンプルファイル
            </a>
            を保存して置くか、
            <button type="button" onClick={onAddSample} className={LINK}>
              練習用データで試す
            </button>
            。
          </span>
        </div>
        <input
          ref={setInput}
          type="file"
          accept=".zip,.csv,application/zip,text/csv"
          className="hidden"
          onChange={onInputChange}
        />
      </details>
    </div>
  )
}

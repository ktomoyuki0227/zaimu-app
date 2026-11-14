import type { Company } from '../domain/types'
import { companyLabel } from '../lib/format'
import { BUTTON_SECONDARY } from './styles'

export type TabId = 'overview' | 'growth' | 'profitability' | 'stability'

const TABS: readonly { readonly id: TabId; readonly label: string; readonly hint: string }[] = [
  { id: 'overview', label: '概要', hint: 'ひとことで言うと' },
  { id: 'growth', label: '成長性', hint: '売上・利益の伸び' },
  { id: 'profitability', label: '収益性', hint: '儲ける力' },
  { id: 'stability', label: '安定性', hint: '倒れにくさ' },
]

interface Props {
  readonly company: Company
  readonly tab: TabId
  readonly onBack: () => void
  readonly onTab: (tab: TabId) => void
}

/** 分析のページの見出し: 一覧へ戻るボタン・企業名・4 つのタブ */
export function CompanyHeader({ company, tab, onBack, onTab }: Props) {
  return (
    <header className="border-b border-solid-gray-420 bg-white">
      <div className="mx-auto max-w-[70rem] px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onBack} className={BUTTON_SECONDARY}>
            ← 企業の一覧へ
          </button>
          <p className="font-bold text-blue-900">財務ビュー</p>
        </div>
        <h1 className="mt-3 text-[2rem] font-bold leading-tight sm:text-[2.25rem]">{companyLabel(company)}</h1>
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
                    onClick={() => onTab(t.id)}
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
  )
}

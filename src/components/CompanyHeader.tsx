import { useEffect, useRef } from 'react'
import { basisChangeLabels, basisSummary, hasMixedBasis } from '../domain/basis'
import type { Company } from '../domain/types'
import { companyLabel } from '../lib/format'
import { BUTTON_SECONDARY } from './styles'

export type TabId = 'overview' | 'growth' | 'profitability' | 'stability' | 'cashflow'

const TABS: readonly { readonly id: TabId; readonly label: string; readonly hint: string }[] = [
  { id: 'overview', label: '概要', hint: 'ひとことで言うと' },
  { id: 'growth', label: '成長性', hint: '売上・利益の伸び' },
  { id: 'profitability', label: '収益性', hint: '儲ける力' },
  { id: 'stability', label: '安定性', hint: '倒れにくさ' },
  { id: 'cashflow', label: 'キャッシュフロー', hint: 'お金の出入り' },
]

interface Props {
  readonly company: Company
  readonly tab: TabId
  readonly onBack: () => void
  readonly onTab: (tab: TabId) => void
}

/** 分析のページの見出し: 一覧へ戻るボタン・企業名・タブ(概要・成長性・収益性・安定性・キャッシュフロー) */
export function CompanyHeader({ company, tab, onBack, onTab }: Props) {
  const tabList = useRef<HTMLUListElement>(null)
  // 狭い画面では、タブの列が横にスクロールする。選んだタブが画面の外にあれば、見える位置まで動かす
  useEffect(() => {
    const current = tabList.current?.querySelector('[aria-current="page"]')
    // jsdom など、scrollIntoView が無い環境では何もしない
    current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [tab])
  const summary = basisSummary(company.periods)
  const changes = hasMixedBasis(company.periods) ? basisChangeLabels(company.periods) : []
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
        {summary !== null ? <p className="mt-1 text-solid-gray-800">数字の範囲: {summary}</p> : null}
        {changes.length > 0 ? (
          <p role="note" className="mt-2 rounded-8 border border-yellow-900 bg-yellow-50 p-3 text-yellow-1100">
            <span aria-hidden="true">△ </span>
            連結と単体の数字が混ざっています。範囲が変わる期({changes.join('、')})は、範囲が違うため、前期との増減を計算していません。
          </p>
        ) : null}

        <nav aria-label="表示する内容" className="mt-3">
          <ul ref={tabList} className="-mb-px flex list-none gap-1 overflow-x-auto p-0">
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

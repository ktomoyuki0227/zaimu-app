import { useCallback, useEffect, useState } from 'react'
import type { Company } from '../domain/types'
import { isPortfolioChange, loadCompanies, saveCompanies, type LoadResult } from '../lib/storage'

export interface CompaniesController {
  readonly companies: readonly Company[]
  /** 一覧を置き換えて、保存する(失敗したら saveFailed になる) */
  readonly update: (next: readonly Company[]) => void
  /** 保存できていない(ページを閉じると消える) */
  readonly saveFailed: boolean
  /** 別のタブの書き換えを取り込んだ回数。取り込み前の状態への「元に戻す」が、古くなったかの判定に使う */
  readonly externalVersion: number
  /** 保存データが壊れていて、退避したことの知らせを出すか */
  readonly showCorruptedNotice: boolean
  readonly dismissCorruptedNotice: () => void
}

/**
 * 取り込んだ企業の一覧と、その保存。
 * - 起動時にブラウザの保存領域から読む。壊れていれば空で始めて、知らせを出す
 * - 変更のたびに保存する
 * - 別のタブが一覧を書き換えたら、それに追随する(古い内容で上書きして、他のタブの取り込みを消さないため)
 */
export function useCompanies(): CompaniesController {
  const [loaded] = useState<LoadResult>(loadCompanies)
  const [companies, setCompanies] = useState<readonly Company[]>(() =>
    loaded.status === 'ok' ? loaded.companies : [],
  )
  const [saveFailed, setSaveFailed] = useState(loaded.status === 'unavailable')
  const [showCorruptedNotice, setShowCorruptedNotice] = useState(loaded.status === 'corrupted')
  const [externalVersion, setExternalVersion] = useState(0)

  const update = useCallback((next: readonly Company[]): void => {
    setCompanies(next)
    setSaveFailed(!saveCompanies(next))
  }, [])

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (!isPortfolioChange(event)) return
      const result = loadCompanies()
      if (result.status === 'ok') {
        setCompanies(result.companies)
        setExternalVersion((n) => n + 1)
      } else if (result.status === 'none') {
        setCompanies([])
        setExternalVersion((n) => n + 1)
      }
      // 壊れている・使えないときは、いま見えている内容を変えない
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const dismissCorruptedNotice = useCallback((): void => setShowCorruptedNotice(false), [])

  return { companies, update, saveFailed, externalVersion, showCorruptedNotice, dismissCorruptedNotice }
}

import type { Company } from '../domain/types'
import { PORTFOLIO_VERSION, parseCompany, parsePortfolio } from '../domain/validate'

const PORTFOLIO_KEY = 'zaimu-view:portfolio:v2'
/** 1 社分だけを保存していた旧い形式。あれば、読み込んで企業の一覧に引き継ぐ */
const LEGACY_COMPANY_KEY = 'zaimu-view:company:v1'
const BACKUP_KEY = 'zaimu-view:portfolio:backup'
/** 旧い形式で、練習用データを自動で保存していたときの id。引き継がない(練習用データは、いつでも読み込み直せる) */
const LEGACY_SAMPLE_ID = 'sample'

/**
 * 保存データを読んだ結果。
 * - none: まだ保存がない(初回)
 * - ok: 正しく読めた(空の一覧も含む)
 * - corrupted: 保存はあったが壊れている。元の文字列は別のキーに退避済み
 * - unavailable: ブラウザが保存領域を使わせてくれない(プライベートウィンドウなど)
 */
export type LoadResult =
  | { readonly status: 'none' }
  | { readonly status: 'ok'; readonly companies: readonly Company[] }
  | { readonly status: 'corrupted' }
  | { readonly status: 'unavailable' }

/** 壊れたデータは、次の自動保存で上書きされる前に退避しておく(失敗しても画面は止めない) */
function backUp(raw: string): void {
  try {
    window.localStorage.setItem(BACKUP_KEY, raw)
  } catch {
    // 退避できなくても、読み込み結果の通知は続ける
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** 旧い形式(1 社分)を、企業の一覧に引き継ぐ */
function migrateLegacy(raw: string): LoadResult {
  const company = parseCompany(parseJson(raw))
  if (company === null) {
    backUp(raw)
    return { status: 'corrupted' }
  }
  return company.id === LEGACY_SAMPLE_ID ? { status: 'none' } : { status: 'ok', companies: [company] }
}

export function loadCompanies(): LoadResult {
  let current: string | null
  let legacy: string | null
  try {
    current = window.localStorage.getItem(PORTFOLIO_KEY)
    legacy = current === null ? window.localStorage.getItem(LEGACY_COMPANY_KEY) : null
  } catch {
    return { status: 'unavailable' }
  }

  if (current !== null) {
    const companies = parsePortfolio(parseJson(current))
    if (companies === null) {
      backUp(current)
      return { status: 'corrupted' }
    }
    return { status: 'ok', companies }
  }
  return legacy === null ? { status: 'none' } : migrateLegacy(legacy)
}

/** 保存に成功したら true */
export function saveCompanies(companies: readonly Company[]): boolean {
  try {
    window.localStorage.setItem(PORTFOLIO_KEY, JSON.stringify({ version: PORTFOLIO_VERSION, companies }))
    return true
  } catch {
    return false
  }
}

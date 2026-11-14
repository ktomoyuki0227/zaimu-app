import { EDINET_CODE } from './patterns.ts'

/** EDINET コードリスト(金融庁が公開している、提出者の一覧)の読み取りと検索 */

export interface FiscalYearEnd {
  readonly month: number
  /** 日。「3月末日」のような月末は 'end' */
  readonly day: number | 'end'
}

export interface CompanyEntry {
  readonly edinetCode: string
  readonly name: string
  readonly nameEn: string
  /** 証券コード(5 桁)。無ければ null */
  readonly secCode: string | null
  /** 決算日。無ければ null(有価証券報告書の提出時期を絞れない) */
  readonly fiscalYearEnd: FiscalYearEnd | null
  readonly listed: boolean
}

const SEC_CODE = /^\d{5}$/

/** 検索で使う列の見出し(コードリストの 2 行目) */
const COLUMN = {
  edinetCode: 'ＥＤＩＮＥＴコード',
  listing: '上場区分',
  fiscalYearEnd: '決算日',
  name: '提出者名',
  nameEn: '提出者名（英字）',
  secCode: '証券コード',
} as const

/** 引用符で囲める、カンマ区切りの行を読む(中の改行は扱わない。コードリストには無い) */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields
}

function parseFiscalYearEnd(text: string): FiscalYearEnd | null {
  const end = /^(\d{1,2})月末日$/.exec(text)
  if (end !== null) {
    const month = Number(end[1])
    return month >= 1 && month <= 12 ? { month, day: 'end' } : null
  }
  const date = /^(\d{1,2})月(\d{1,2})日$/.exec(text)
  if (date !== null) {
    const month = Number(date[1])
    const day = Number(date[2])
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null
  }
  return null
}

/** コードリストの文字列から、提出者の一覧を作る。見出しが想定と違えば例外 */
export function parseCodeListText(text: string): CompanyEntry[] {
  const lines = text.split(/\r?\n/)
  // 1 行目はダウンロード日などのメタ情報。見出しは先頭の数行のどこかにある
  const headerIndex = lines.slice(0, 5).findIndex((l) => l.includes(COLUMN.edinetCode) && l.includes(COLUMN.name))
  if (headerIndex < 0) {
    throw new Error('EDINET コードリストの形式が想定と違います(見出しが見つかりません)。')
  }
  const header = parseCsvLine(lines[headerIndex])
  const col = (name: string): number => header.indexOf(name)
  const iCode = col(COLUMN.edinetCode)
  const iListing = col(COLUMN.listing)
  const iFye = col(COLUMN.fiscalYearEnd)
  const iName = col(COLUMN.name)
  const iNameEn = col(COLUMN.nameEn)
  const iSec = col(COLUMN.secCode)
  if ([iCode, iListing, iFye, iName, iNameEn, iSec].some((i) => i < 0)) {
    throw new Error('EDINET コードリストの形式が想定と違います(必要な列がありません)。')
  }

  const companies: CompanyEntry[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    if (line === '') continue
    const row = parseCsvLine(line)
    const edinetCode = row[iCode]?.trim()
    const name = row[iName]?.trim()
    if (edinetCode === undefined || !EDINET_CODE.test(edinetCode) || !name) continue
    const sec = row[iSec]?.trim() ?? ''
    companies.push({
      edinetCode,
      name,
      nameEn: row[iNameEn]?.trim() ?? '',
      secCode: SEC_CODE.test(sec) ? sec : null,
      fiscalYearEnd: parseFiscalYearEnd(row[iFye]?.trim() ?? ''),
      listed: row[iListing]?.trim() === '上場',
    })
  }
  return companies
}

/** コードリストの CSV(Shift_JIS)のバイト列から、提出者の一覧を作る */
export function parseCodeListBytes(bytes: Uint8Array): CompanyEntry[] {
  return parseCodeListText(new TextDecoder('shift_jis').decode(bytes))
}

/** 検索のための正規化。全角・半角、大文字小文字、空白、「株式会社」の有無を吸収する */
function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/株式会社|\(株\)|㈱|有限会社|\s+/g, '')
}

const MIN_NAME_QUERY_LENGTH = 2

/**
 * 証券コード(4 桁または 5 桁)・EDINET コード・社名(の一部)で、提出者を探す。
 * 上場企業を先に、名前が短い(=検索語に近い)ものを先に並べ、limit 件まで返す。
 */
export function searchCompanies(list: readonly CompanyEntry[], query: string, limit = 20): CompanyEntry[] {
  const q = query.normalize('NFKC').trim()
  if (q === '') {
    return []
  }
  let matched: CompanyEntry[]
  if (/^\d{4}$/.test(q)) {
    matched = list.filter((c) => c.secCode !== null && c.secCode.startsWith(q))
  } else if (/^\d{5}$/.test(q)) {
    matched = list.filter((c) => c.secCode === q)
  } else if (/^e\d{5}$/i.test(q)) {
    matched = list.filter((c) => c.edinetCode === q.toUpperCase())
  } else {
    const nq = normalize(q)
    if (nq.length < MIN_NAME_QUERY_LENGTH) {
      return []
    }
    matched = list.filter((c) => normalize(c.name).includes(nq) || normalize(c.nameEn).includes(nq))
  }
  return matched
    .sort((a, b) => Number(b.listed) - Number(a.listed) || a.name.length - b.name.length)
    .slice(0, limit)
}

import { describe, expect, test } from 'vitest'
import {
  isImportableAnnualReport,
  keepAnnualReports,
  parseDocumentList,
  pickAnnualReports,
  type ListedDocument,
} from './documents.ts'

function doc(overrides: Partial<ListedDocument> = {}): ListedDocument {
  return {
    docID: 'S100AAAA',
    edinetCode: 'E90001',
    secCode: '12340',
    filerName: 'サンプル製作所株式会社',
    docTypeCode: '120',
    periodEnd: '2025-03-31',
    submitDateTime: '2025-06-27 15:00',
    csvFlag: '1',
    withdrawalStatus: '0',
    ...overrides,
  }
}

describe('parseDocumentList', () => {
  const raw = {
    metadata: { status: '200', message: 'OK' },
    results: [
      {
        docID: 'S100AAAA',
        edinetCode: 'E90001',
        secCode: '12340',
        filerName: 'サンプル製作所株式会社',
        docTypeCode: '120',
        periodEnd: '2025-03-31',
        submitDateTime: '2025-06-27 15:00',
        csvFlag: '1',
        withdrawalStatus: '0',
      },
    ],
  }

  test('提出書類の一覧から、必要な項目を取り出す', () => {
    expect(parseDocumentList(raw)).toEqual([doc()])
  })

  test('結果が 0 件(results が無い)なら空', () => {
    expect(parseDocumentList({ metadata: { status: '200' } })).toEqual([])
  })

  test('メタデータ(ステータス)が無い応答は、「0 件」と区別できないので拒否する', () => {
    expect(() => parseDocumentList({})).toThrow()
    expect(() => parseDocumentList({ results: [] })).toThrow()
  })

  test('ステータスが 200 でなければ例外', () => {
    expect(() => parseDocumentList({ metadata: { status: '401', message: 'Access denied' } })).toThrow()
  })

  test('形の崩れた 1 件(書類管理番号・EDINET コードの書式が違う)は読み飛ばす', () => {
    const broken = {
      ...raw,
      results: [
        ...raw.results,
        { ...raw.results[0], docID: '../etc/passwd' },
        { ...raw.results[0], edinetCode: 'X1' },
        { ...raw.results[0], docTypeCode: 120 },
        null,
        'x',
      ],
    }
    expect(parseDocumentList(broken)).toHaveLength(1)
  })

  test('期間(至)が日付でなければ null', () => {
    const r = { ...raw, results: [{ ...raw.results[0], periodEnd: 'abc' }] }
    expect(parseDocumentList(r)[0].periodEnd).toBeNull()
  })

  test('オブジェクトでない入力は例外', () => {
    expect(() => parseDocumentList(null)).toThrow()
    expect(() => parseDocumentList('x')).toThrow()
  })
})

describe('keepAnnualReports', () => {
  test('有価証券報告書(120)と訂正(130)だけ残す', () => {
    const list = [doc(), doc({ docTypeCode: '130' }), doc({ docTypeCode: '140' }), doc({ docTypeCode: '350' })]
    expect(keepAnnualReports(list).map((d) => d.docTypeCode)).toEqual(['120', '130'])
  })
})

describe('isImportableAnnualReport', () => {
  test('その企業の、CSV があり取り下げられていない有価証券報告書は取り込める', () => {
    expect(isImportableAnnualReport(doc(), 'E90001')).toBe(true)
  })

  test('別の企業・CSV なし・取り下げ・事業年度が不明なものは取り込めない', () => {
    expect(isImportableAnnualReport(doc({ edinetCode: 'E90002' }), 'E90001')).toBe(false)
    expect(isImportableAnnualReport(doc({ csvFlag: '0' }), 'E90001')).toBe(false)
    expect(isImportableAnnualReport(doc({ withdrawalStatus: '2' }), 'E90001')).toBe(false)
    expect(isImportableAnnualReport(doc({ periodEnd: null }), 'E90001')).toBe(false)
    expect(isImportableAnnualReport(doc({ docTypeCode: '140' }), 'E90001')).toBe(false)
  })
})

describe('pickAnnualReports', () => {
  test('同じ事業年度は、原本(120)を優先する(訂正は財務諸表がそろっている保証がない)', () => {
    const original = doc({ docID: 'S100AAAA', submitDateTime: '2025-06-27 15:00' })
    const corrected = doc({ docID: 'S100BBBB', docTypeCode: '130', submitDateTime: '2025-08-01 10:00' })
    expect(pickAnnualReports([original, corrected], 'E90001').map((d) => d.docID)).toEqual(['S100AAAA'])
    expect(pickAnnualReports([corrected, original], 'E90001').map((d) => d.docID)).toEqual(['S100AAAA'])
  })

  test('原本が無ければ、訂正を使う。同じ種別が複数あれば、あとに提出されたもの', () => {
    const corrected1 = doc({ docID: 'S100BBBB', docTypeCode: '130', submitDateTime: '2025-08-01 10:00' })
    const corrected2 = doc({ docID: 'S100CCCC', docTypeCode: '130', submitDateTime: '2025-09-01 10:00' })
    expect(pickAnnualReports([corrected1, corrected2], 'E90001').map((d) => d.docID)).toEqual(['S100CCCC'])
  })

  test('事業年度の新しい順に並べる', () => {
    const a = doc({ docID: 'S100AAAA', periodEnd: '2024-03-31' })
    const b = doc({ docID: 'S100BBBB', periodEnd: '2025-03-31' })
    expect(pickAnnualReports([a, b], 'E90001').map((d) => d.docID)).toEqual(['S100BBBB', 'S100AAAA'])
  })

  test('別の企業の書類は選ばない', () => {
    expect(pickAnnualReports([doc({ edinetCode: 'E90002' })], 'E90001')).toEqual([])
  })
})

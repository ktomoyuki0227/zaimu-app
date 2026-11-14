import { describe, expect, test } from 'vitest'
import type { EdinetCache } from './cache.ts'
import type { CompanyEntry } from './codeList.ts'
import type { ListedDocument } from './documents.ts'
import { findAnnualReports, getDocumentZip } from './service.ts'

const COMPANY: CompanyEntry = {
  edinetCode: 'E90001',
  name: 'サンプル製作所株式会社',
  nameEn: 'SAMPLE',
  secCode: '12340',
  fiscalYearEnd: { month: 3, day: 31 },
  listed: true,
}

function report(
  docID: string,
  periodEnd: string,
  submitted: string,
  overrides: Partial<ListedDocument> = {},
): ListedDocument {
  return {
    docID,
    edinetCode: 'E90001',
    secCode: '12340',
    filerName: 'サンプル製作所株式会社',
    docTypeCode: '120',
    periodEnd,
    submitDateTime: `${submitted} 15:00`,
    csvFlag: '1',
    withdrawalStatus: '0',
    ...overrides,
  }
}

function memoryCache() {
  const days = new Map<string, ListedDocument[]>()
  const zips = new Map<string, Uint8Array>()
  const cache: EdinetCache = {
    getDay: async (d) => days.get(d) ?? null,
    putDay: async (d, docs) => {
      days.set(d, [...docs])
    },
    getZip: async (id) => zips.get(id) ?? null,
    putZip: async (id, b) => {
      zips.set(id, b)
    },
  }
  return { cache, days, zips }
}

/** 日付 → その日の一覧 を返す、偽のクライアント。呼ばれた日付を記録する */
function fakeClient(byDate: Record<string, ListedDocument[]>) {
  const listed: string[] = []
  const downloaded: string[] = []
  return {
    listed,
    downloaded,
    client: {
      listDocuments: async (date: string) => {
        listed.push(date)
        return byDate[date] ?? []
      },
      downloadCsvZip: async (docID: string) => {
        downloaded.push(docID)
        return Uint8Array.from([0x50, 0x4b, 3, 4])
      },
    },
  }
}

describe('findAnnualReports', () => {
  test('提出期限(6/30)に近い日から調べ、見つかった事業年度は、そこで止める', async () => {
    const { client, listed } = fakeClient({
      '2025-06-27': [report('S100AAAA', '2025-03-31', '2025-06-27')],
      '2024-06-26': [report('S100BBBB', '2024-03-31', '2024-06-26')],
    })
    const result = await findAnnualReports({ client, cache: memoryCache().cache }, COMPANY, {
      years: 2,
      today: '2025-11-13',
    })
    expect(result.reports.map((r) => r.docID)).toEqual(['S100AAAA', 'S100BBBB'])
    expect(result.notFound).toEqual([])
    // 2025 年度: 6/30, 6/27 で見つかる(6/27 より前の日は調べない)
    expect(listed.slice(0, 2)).toEqual(['2025-06-30', '2025-06-27'])
    expect(listed).not.toContain('2025-06-26')
  })

  test('見つからなかった事業年度は notFound に入れる(全日付を調べたあと)', async () => {
    const { client, listed } = fakeClient({})
    const result = await findAnnualReports({ client, cache: memoryCache().cache }, COMPANY, {
      years: 1,
      today: '2025-11-13',
    })
    expect(result.reports).toEqual([])
    expect(result.notFound).toEqual(['2025-03-31'])
    expect(listed.length).toBeGreaterThan(30)
  })

  test('同じ日を 2 度は EDINET に問い合わせない(キャッシュ)。2 社目の探索にも使える', async () => {
    const byDate = {
      '2025-06-27': [
        report('S100AAAA', '2025-03-31', '2025-06-27'),
        report('S100CCCC', '2025-03-31', '2025-06-27', { edinetCode: 'E90002' }),
      ],
    }
    const { cache } = memoryCache()
    const first = fakeClient(byDate)
    await findAnnualReports({ client: first.client, cache }, COMPANY, { years: 1, today: '2025-11-13' })
    const second = fakeClient(byDate)
    const other = await findAnnualReports(
      { client: second.client, cache },
      { ...COMPANY, edinetCode: 'E90002' },
      { years: 1, today: '2025-11-13' },
    )
    expect(second.listed).toEqual([]) // 全部キャッシュから
    expect(other.reports.map((r) => r.docID)).toEqual(['S100CCCC'])
  })

  test('直近 7 日の一覧は、まだ変わりうる(CSV の準備・取り下げ)のでキャッシュしない。それより前は残す', async () => {
    const { cache, days } = memoryCache()
    const { client } = fakeClient({})
    await findAnnualReports({ client, cache }, COMPANY, { years: 1, today: '2026-04-20', maxRequests: 1000 })
    // 2026 年度の窓は 4/14〜。直近 7 日(4/13 より後)は残さない
    expect(days.has('2026-04-20')).toBe(false)
    expect(days.has('2026-04-17')).toBe(false)
    const old = memoryCache()
    await findAnnualReports({ client: fakeClient({}).client, cache: old.cache }, COMPANY, {
      years: 1,
      today: '2025-11-13',
      maxRequests: 1000,
    })
    expect(old.days.has('2025-06-30')).toBe(true)
  })

  test('決算日が違う(別の事業年度の)書類は、その事業年度として数えない', async () => {
    const { client } = fakeClient({ '2025-06-27': [report('S100AAAA', '2024-03-31', '2025-06-27')] })
    const result = await findAnnualReports({ client, cache: memoryCache().cache }, COMPANY, {
      years: 1,
      today: '2025-11-13',
    })
    expect(result.reports).toEqual([])
  })

  test('原本と訂正があれば、原本(120)を選ぶ(同じ日でも、別の日でも)', async () => {
    const sameDay = fakeClient({
      '2025-06-27': [
        report('S100AAAA', '2025-03-31', '2025-06-27'),
        report('S100BBBB', '2025-03-31', '2025-06-27', { docTypeCode: '130', submitDateTime: '2025-06-27 16:00' }),
      ],
    })
    const a = await findAnnualReports({ client: sameDay.client, cache: memoryCache().cache }, COMPANY, {
      years: 1,
      today: '2025-11-13',
    })
    expect(a.reports.map((r) => r.docID)).toEqual(['S100AAAA'])

    // 訂正(6/27)を先に見つけても、原本(6/10)まで探す
    const acrossDays = fakeClient({
      '2025-06-27': [report('S100BBBB', '2025-03-31', '2025-06-27', { docTypeCode: '130' })],
      '2025-06-10': [report('S100AAAA', '2025-03-31', '2025-06-10')],
    })
    const b = await findAnnualReports({ client: acrossDays.client, cache: memoryCache().cache }, COMPANY, {
      years: 1,
      today: '2025-11-13',
    })
    expect(b.reports.map((r) => r.docID)).toEqual(['S100AAAA'])
  })

  test('訂正しか見つからなければ、それを使う', async () => {
    const { client } = fakeClient({ '2025-06-27': [report('S100BBBB', '2025-03-31', '2025-06-27', { docTypeCode: '130' })] })
    const result = await findAnnualReports({ client, cache: memoryCache().cache }, COMPANY, {
      years: 1,
      today: '2025-11-13',
    })
    expect(result.reports.map((r) => r.docID)).toEqual(['S100BBBB'])
  })

  test('提出期限がまだ来ていない事業年度は、見つからなくても notFound ではなく pending にし、枠を使わない', async () => {
    const sep = { ...COMPANY, fiscalYearEnd: { month: 9, day: 30 as const } }
    const { client } = fakeClient({ '2025-12-26': [report('S100AAAA', '2025-09-30', '2025-12-26')] })
    // 今日 2026-11-13: 2026-09-30 の期限(12/31)は未来。2025-09-30 の書類は、期限前に提出されていたものとして見つかる
    const result = await findAnnualReports({ client, cache: memoryCache().cache }, sep, {
      years: 1,
      today: '2026-11-13',
      maxRequests: 1000,
    })
    expect(result.pending).toEqual(['2026-09-30'])
    expect(result.notFound).toEqual([])
    expect(result.reports.map((r) => r.docID)).toEqual(['S100AAAA'])
  })

  test('1 回の探索で EDINET に問い合わせる日数に上限がある(超えたら、続きは次回に回す)', async () => {
    const { client, listed } = fakeClient({})
    await expect(
      findAnnualReports({ client, cache: memoryCache().cache }, COMPANY, {
        years: 3,
        today: '2025-11-13',
        maxRequests: 5,
      }),
    ).rejects.toThrow('上限')
    expect(listed).toHaveLength(5)
  })

  test('キャッシュの読み書きに失敗しても、探索は続く', async () => {
    const { client } = fakeClient({ '2025-06-30': [report('S100AAAA', '2025-03-31', '2025-06-30')] })
    const broken: EdinetCache = {
      getDay: async () => {
        throw new Error('disk error')
      },
      putDay: async () => {
        throw new Error('disk full')
      },
      getZip: async () => {
        throw new Error('disk error')
      },
      putZip: async () => {
        throw new Error('disk full')
      },
    }
    const result = await findAnnualReports({ client, cache: broken }, COMPANY, { years: 1, today: '2025-11-13' })
    expect(result.reports.map((r) => r.docID)).toEqual(['S100AAAA'])
    expect(Array.from(await getDocumentZip({ client, cache: broken }, 'S100AAAA'))).toEqual([0x50, 0x4b, 3, 4])
  })

  test('進み具合を報告する', async () => {
    const { client } = fakeClient({ '2025-06-30': [report('S100AAAA', '2025-03-31', '2025-06-30')] })
    const events: { date: string; checked: number; cached: boolean }[] = []
    await findAnnualReports({ client, cache: memoryCache().cache }, COMPANY, {
      years: 1,
      today: '2025-11-13',
      onProgress: (p) => events.push({ date: p.date, checked: p.checked, cached: p.cached }),
    })
    expect(events).toEqual([{ date: '2025-06-30', checked: 1, cached: false }])
  })

  test('途中で中止できる', async () => {
    const { client } = fakeClient({})
    const controller = new AbortController()
    controller.abort()
    await expect(
      findAnnualReports({ client, cache: memoryCache().cache }, COMPANY, {
        years: 1,
        today: '2025-11-13',
        signal: controller.signal,
      }),
    ).rejects.toThrow()
  })

  test('決算日が不明な提出者は、探せない', async () => {
    const { client } = fakeClient({})
    await expect(
      findAnnualReports(
        { client, cache: memoryCache().cache },
        { ...COMPANY, fiscalYearEnd: null },
        { years: 1, today: '2025-11-13' },
      ),
    ).rejects.toThrow('決算日')
  })
})

describe('getDocumentZip', () => {
  test('初回は EDINET から取得して保存し、2 回目はキャッシュから返す', async () => {
    const { cache } = memoryCache()
    const { client, downloaded } = fakeClient({})
    const a = await getDocumentZip({ client, cache }, 'S100AAAA')
    const b = await getDocumentZip({ client, cache }, 'S100AAAA')
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(downloaded).toEqual(['S100AAAA'])
  })
})

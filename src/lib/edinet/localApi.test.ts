import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CONNECTION_ERROR,
  fetchDocument,
  fetchStatus,
  parseReportEvent,
  readLines,
  searchCompanies,
  streamReports,
  type ReportEvent,
} from './localApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>): string[] {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input))
    return respond(String(input), init)
  })
  return urls
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('fetchStatus', () => {
  test('API キーが設定済みなら ready、未設定なら needsKey', async () => {
    stubFetch(() => json({ configured: true }))
    expect(await fetchStatus()).toEqual({ kind: 'ready' })
    stubFetch(() => json({ configured: false }))
    expect(await fetchStatus()).toEqual({ kind: 'needsKey' })
  })

  test('中継が無い(HTML が返る・404・通信失敗)ときは unavailable', async () => {
    stubFetch(() => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }))
    expect(await fetchStatus()).toEqual({ kind: 'unavailable' })
    stubFetch(() => new Response('x', { status: 404 }))
    expect(await fetchStatus()).toEqual({ kind: 'unavailable' })
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network')
    })
    expect(await fetchStatus()).toEqual({ kind: 'unavailable' })
  })

  test('自前のヘッダを付けて、同じオリジンの中継を呼ぶ', async () => {
    let seen: RequestInit | undefined
    const urls = stubFetch((_url, init) => {
      seen = init
      return json({ configured: true })
    })
    await fetchStatus()
    expect(urls).toEqual(['/local-api/edinet/status'])
    const headers = seen?.headers as Record<string, string> | undefined
    expect(headers?.['x-local-api']).toBe('1')
  })
})

describe('searchCompanies', () => {
  test('候補の一覧を、画面の形で返す(形の崩れた項目は捨てる)', async () => {
    const urls = stubFetch(() =>
      json({
        companies: [
          { edinetCode: 'E90001', name: 'サンプル製作所', secCode: '12340', fiscalYearEnd: { month: 3, day: 31 }, listed: true },
          { edinetCode: 'E90002', name: '別社', secCode: null, fiscalYearEnd: { month: 2, day: 'end' }, listed: false },
          { name: 'コード無し' },
          null,
        ],
      }),
    )
    const hits = await searchCompanies('サンプル 製作所')
    expect(hits.map((h) => h.edinetCode)).toEqual(['E90001', 'E90002'])
    expect(hits[1].fiscalYearEnd).toEqual({ month: 2, day: 'end' })
    expect(urls[0]).toContain(encodeURIComponent('サンプル 製作所'))
  })

  test('中継が返したエラーの文章を、そのまま例外にする', async () => {
    stubFetch(() => json({ error: 'コードリストを取得できませんでした' }, 502))
    await expect(searchCompanies('x')).rejects.toThrow('コードリスト')
  })
})

describe('parseReportEvent', () => {
  test('進み具合・完了・エラーの行を読む', () => {
    expect(
      parseReportEvent(
        JSON.stringify({ type: 'progress', fiscalYearEnd: '2025-03-31', date: '2025-06-27', checked: 2, planned: 20, cached: false }),
      ),
    ).toMatchObject({ type: 'progress', checked: 2 })
    expect(
      parseReportEvent(
        JSON.stringify({
          type: 'done',
          reports: [{ docID: 'S100AAAA', periodEnd: '2025-03-31', submitDateTime: '2025-06-27 15:00', docTypeCode: '120' }, { docID: 1 }],
          notFound: ['2023-03-31', 5],
        }),
      ),
    ).toEqual({
      type: 'done',
      reports: [{ docID: 'S100AAAA', periodEnd: '2025-03-31', submitDateTime: '2025-06-27 15:00', docTypeCode: '120' }],
      notFound: ['2023-03-31'],
      pending: [],
    })
    expect(
      parseReportEvent(JSON.stringify({ type: 'done', reports: [], notFound: [], pending: ['2026-09-30', 3] })),
    ).toEqual({ type: 'done', reports: [], notFound: [], pending: ['2026-09-30'] })
    expect(parseReportEvent(JSON.stringify({ type: 'error', message: '失敗' }))).toEqual({ type: 'error', message: '失敗' })
  })

  test('読めない行(壊れた JSON・知らない種類・項目の型違い)は null', () => {
    expect(parseReportEvent('{broken')).toBeNull()
    expect(parseReportEvent('[]')).toBeNull()
    expect(parseReportEvent(JSON.stringify({ type: 'other' }))).toBeNull()
    expect(parseReportEvent(JSON.stringify({ type: 'progress', date: 1 }))).toBeNull()
    expect(parseReportEvent(JSON.stringify({ type: 'done', reports: 'x' }))).toBeNull()
  })
})

describe('readLines', () => {
  test('チャンクの途中で行が切れても、1 行ずつ組み立てる。最後の改行が無くてもよい', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"a":1}\n{"b"'))
        controller.enqueue(encoder.encode(':2}\n\n{"c":3}'))
        controller.close()
      },
    })
    const lines: string[] = []
    await readLines(stream, (l) => lines.push(l))
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })

  test('日本語の文字がチャンクの境目で割れても、壊れない', async () => {
    const bytes = new TextEncoder().encode('{"m":"財務"}\n')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7)) // 「財」の途中
        controller.enqueue(bytes.slice(7))
        controller.close()
      },
    })
    const lines: string[] = []
    await readLines(stream, (l) => lines.push(l))
    expect(lines).toEqual(['{"m":"財務"}'])
  })
})

describe('streamReports', () => {
  function ndjson(events: unknown[]): Response {
    return new Response(events.map((e) => JSON.stringify(e)).join('\n') + '\n', {
      headers: { 'content-type': 'application/x-ndjson' },
    })
  }

  test('イベントを順に渡し、done で終わる', async () => {
    const urls = stubFetch(() =>
      ndjson([
        { type: 'progress', fiscalYearEnd: '2025-03-31', date: '2025-06-30', checked: 1, planned: 10, cached: true },
        { type: 'done', reports: [], notFound: ['2025-03-31'] },
      ]),
    )
    const events: ReportEvent[] = []
    await streamReports('E90001', 3, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['progress', 'done'])
    expect(urls[0]).toBe('/local-api/edinet/reports?edinetCode=E90001&years=3')
  })

  test('done も error も届かずに終わったら、例外(途切れたことを黙らない)', async () => {
    stubFetch(() =>
      ndjson([{ type: 'progress', fiscalYearEnd: '2025-03-31', date: '2025-06-30', checked: 1, planned: 10, cached: true }]),
    )
    await expect(streamReports('E90001', 3, () => undefined)).rejects.toThrow('途切れ')
  })

  test('HTTP エラーは、中継のメッセージ(503 の設定案内など)で例外にする', async () => {
    stubFetch(() => json({ error: 'API キーが設定されていません' }, 503))
    await expect(streamReports('E90001', 3, () => undefined)).rejects.toThrow('API キー')
  })
})

describe('fetchDocument', () => {
  test('zip のバイト列を返す', async () => {
    const urls = stubFetch(() => new Response(Uint8Array.from([0x50, 0x4b, 3, 4])))
    expect(Array.from(await fetchDocument('S100AAAA'))).toEqual([0x50, 0x4b, 3, 4])
    expect(urls[0]).toBe('/local-api/edinet/document/S100AAAA')
  })

  test('失敗したら、中継のメッセージで例外', async () => {
    stubFetch(() => json({ error: '書類が見つかりません' }, 502))
    await expect(fetchDocument('S100AAAA')).rejects.toThrow('見つかりません')
  })
})

describe('中継の応答を、入力として疑う', () => {
  const company = (extra: Record<string, unknown>) => ({
    edinetCode: 'E90001',
    name: 'サンプル製作所',
    secCode: '12340',
    fiscalYearEnd: { month: 3, day: 'end' },
    listed: true,
    ...extra,
  })

  test('会社名の制御文字・表示を偽装する文字(右から左への切り替え、ゼロ幅など)は取り除く', async () => {
    stubFetch(() => json({ companies: [company({ name: '‮サンプル​製作所\n' })] }))
    const [hit] = await searchCompanies('x')
    expect(hit.name).toBe('サンプル製作所')
  })

  test('会社名が空になる提出者は、結果に含めない', async () => {
    stubFetch(() => json({ companies: [company({ name: '​‮' })] }))
    expect(await searchCompanies('x')).toEqual([])
  })

  test('決算日の月・日が範囲外・小数なら、決算日不明(null)にする', async () => {
    stubFetch(() =>
      json({
        companies: [
          company({ fiscalYearEnd: { month: 99, day: 1 } }),
          company({ edinetCode: 'E90002', fiscalYearEnd: { month: 3, day: 1.5 } }),
          company({ edinetCode: 'E90003', fiscalYearEnd: { month: 12, day: 31 } }),
        ],
      }),
    )
    const hits = await searchCompanies('x')
    expect(hits.map((h) => h.fiscalYearEnd)).toEqual([null, null, { month: 12, day: 31 }])
  })

  test('中継のエラーの文章も、制御文字を取り除き、長さを制限する', async () => {
    stubFetch(() => json({ error: `‮${'あ'.repeat(1_000)}` }, 502))
    await expect(searchCompanies('x')).rejects.toThrow(/^あ{300}$/)
  })

  test('取り込みの上限を超える大きさを名乗る書類は、読み込まずに断る', async () => {
    stubFetch(
      () =>
        new Response(Uint8Array.of(0x50, 0x4b), {
          status: 200,
          headers: { 'content-length': String(21 * 1024 * 1024) },
        }),
    )
    await expect(fetchDocument('S100AAAA')).rejects.toThrow('大きすぎる')
  })
})

describe('開発サーバーに届かないとき', () => {
  /** サーバーが止まっているときの、ブラウザの fetch の失敗(TypeError: Failed to fetch) */
  function serverDown(): void {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
  }

  test('企業の検索: 生の「Failed to fetch」ではなく、サーバーの確認を促す文章にする', async () => {
    serverDown()
    await expect(searchCompanies('NTT')).rejects.toThrow(CONNECTION_ERROR)
    await expect(searchCompanies('NTT')).rejects.not.toThrow(/Failed to fetch/)
  })

  test('書類の探索・書類の取得も、同じ文章にする', async () => {
    serverDown()
    await expect(streamReports('E90001', 3, () => undefined)).rejects.toThrow(CONNECTION_ERROR)
    await expect(fetchDocument('S100AAAA')).rejects.toThrow(CONNECTION_ERROR)
  })

  test('探索の途中でサーバーが止まったときも、同じ文章にする', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('network error'))
      },
    })
    stubFetch(() => new Response(stream, { status: 200 }))
    await expect(streamReports('E90001', 3, () => undefined)).rejects.toThrow(CONNECTION_ERROR)
  })

  test('利用者が中止したときは、接続エラーにしない(中止のまま)', async () => {
    const abort = new AbortController()
    vi.stubGlobal('fetch', async () => {
      abort.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(searchCompanies('NTT', abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

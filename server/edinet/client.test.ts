import { describe, expect, test } from 'vitest'
import { EDINET_API_BASE, EdinetApiError, createEdinetClient } from './client.ts'

const KEY = 'SECRET-KEY-123'

interface Call {
  readonly url: URL
  readonly init: RequestInit | undefined
}

function fakeFetch(respond: (url: URL) => Response | Promise<Response>): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof URL ? input.href : String(input))
    calls.push({ url, init })
    return respond(url)
  }) as typeof fetch
  return { fetchImpl, calls }
}

const noSleep = async (): Promise<void> => undefined

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

function zipResponse(bytes: number[] = [0x50, 0x4b, 3, 4, 0, 0]): Response {
  return new Response(Uint8Array.from(bytes), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
}

const DOC = {
  docID: 'S100AAAA',
  edinetCode: 'E90001',
  docTypeCode: '120',
  submitDateTime: '2025-06-27 15:00',
  periodEnd: '2025-03-31',
  csvFlag: '1',
  withdrawalStatus: '0',
}

describe('createEdinetClient: 書類一覧', () => {
  test('日付・type=2・API キーを付けて、EDINET の書類一覧 API を呼び、一覧を返す', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ metadata: { status: '200' }, results: [DOC] }))
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    const docs = await client.listDocuments('2025-06-27')
    expect(docs).toHaveLength(1)
    const { url, init } = calls[0]
    expect(url.origin + url.pathname).toBe(`${EDINET_API_BASE}/documents.json`)
    expect(url.searchParams.get('date')).toBe('2025-06-27')
    expect(url.searchParams.get('type')).toBe('2')
    expect(url.searchParams.get('Subscription-Key')).toBe(KEY)
    expect(init?.redirect).toBe('error')
    expect(init?.method).toBe('GET')
  })

  test('実在しない日付は、通信せずに断る', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({}))
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    await expect(client.listDocuments('2025-13-01')).rejects.toBeInstanceOf(EdinetApiError)
    await expect(client.listDocuments('../../etc')).rejects.toBeInstanceOf(EdinetApiError)
    expect(calls).toHaveLength(0)
  })

  test('401 は「API キーが受け付けられない」と伝える。メッセージに API キーや URL を含めない', async () => {
    const { fetchImpl } = fakeFetch(() => json({ statusCode: 401, message: 'Access denied' }, 401))
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    const error = await client.listDocuments('2025-06-27').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdinetApiError)
    expect(String((error as Error).message)).toContain('API キー')
    expect(String((error as Error).message)).not.toContain(KEY)
  })

  test('HTTP 200 でも、本文が JSON のエラー(statusCode)なら失敗として扱う', async () => {
    const { fetchImpl } = fakeFetch(() => json({ statusCode: 401, message: 'Access denied' }))
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    await expect(client.listDocuments('2025-06-27')).rejects.toBeInstanceOf(EdinetApiError)
  })

  test('ネットワークの失敗は、元の例外(URL と API キーを含みうる)を出さずに伝える', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      throw new TypeError(`fetch failed ${String(input)}`)
    }) as typeof fetch
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    const error = await client.listDocuments('2025-06-27').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EdinetApiError)
    expect(String((error as Error).message)).not.toContain(KEY)
  })

  test('API キーが空なら、作れない', () => {
    expect(() => createEdinetClient({ apiKey: '  ' })).toThrow()
  })
})

describe('createEdinetClient: 書類の取得', () => {
  test('type=5(CSV)で書類管理番号を指定して取得する', async () => {
    const { fetchImpl, calls } = fakeFetch(() => zipResponse())
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    const bytes = await client.downloadCsvZip('S100AAAA')
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b])
    const { url } = calls[0]
    expect(url.pathname).toBe('/api/v2/documents/S100AAAA')
    expect(url.searchParams.get('type')).toBe('5')
  })

  test('書類管理番号の書式が違えば、通信せずに断る(パス操作を防ぐ)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => zipResponse())
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    for (const bad of ['../x', 'S100AAAA/../../y', 's100aaaa', 'S1', '']) {
      await expect(client.downloadCsvZip(bad)).rejects.toBeInstanceOf(EdinetApiError)
    }
    expect(calls).toHaveLength(0)
  })

  test('zip でない応答(HTML など)は、zip として扱わない', async () => {
    const { fetchImpl } = fakeFetch(
      () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
    )
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    await expect(client.downloadCsvZip('S100AAAA')).rejects.toBeInstanceOf(EdinetApiError)
  })

  test('JSON のエラー応答は、理由を伝える', async () => {
    const { fetchImpl } = fakeFetch(() => json({ statusCode: 404, message: 'Not Found' }))
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    await expect(client.downloadCsvZip('S100AAAA')).rejects.toThrow('見つかりません')
  })

  test('大きすぎる書類は、中身を読まずに断る', async () => {
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(Uint8Array.from([0x50, 0x4b, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream', 'content-length': String(100 * 1024 * 1024) },
        }),
    )
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    await expect(client.downloadCsvZip('S100AAAA')).rejects.toThrow('大きすぎる')
  })
})

describe('createEdinetClient: 間隔', () => {
  test('続けて呼ぶと、前の要求から最小の間隔を空ける', async () => {
    let clock = 10_000
    const sleeps: number[] = []
    const { fetchImpl } = fakeFetch(() => json({ metadata: { status: '200' } }))
    const client = createEdinetClient({
      apiKey: KEY,
      fetchImpl,
      minIntervalMs: 1_000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
    })
    await client.listDocuments('2025-06-27')
    clock += 200 // 200ms 後に、次の要求
    await client.listDocuments('2025-06-26')
    expect(sleeps).toEqual([800])
  })

  test('同時に呼んでも、順番に 1 つずつ実行する', async () => {
    let active = 0
    let maxActive = 0
    const { fetchImpl } = fakeFetch(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active -= 1
      return json({ metadata: { status: '200' } })
    })
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep, minIntervalMs: 0 })
    await Promise.all(['2025-06-27', '2025-06-26', '2025-06-25'].map((d) => client.listDocuments(d)))
    expect(maxActive).toBe(1)
  })

  test('前の要求が失敗しても、次の要求は実行される', async () => {
    let n = 0
    const { fetchImpl } = fakeFetch(() => (n++ === 0 ? json({}, 500) : json({ metadata: { status: '200' } })))
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep, minIntervalMs: 0 })
    const first = client.listDocuments('2025-06-27').catch((e: unknown) => e)
    const second = client.listDocuments('2025-06-26')
    expect(await first).toBeInstanceOf(EdinetApiError)
    expect(await second).toEqual([])
  })
})

describe('createEdinetClient: 制限を示されたあと', () => {
  test('429 を受けたら、しばらく何も送らない(押し直しで続けて送らない)。残り時間を伝える', async () => {
    let clock = 0
    let n = 0
    const { fetchImpl, calls } = fakeFetch(() =>
      n++ === 0 ? json({ message: 'Too Many Requests' }, 429) : json({ metadata: { status: '200' } }),
    )
    const client = createEdinetClient({
      apiKey: KEY,
      fetchImpl,
      sleep: noSleep,
      minIntervalMs: 0,
      cooldownMs: 10 * 60_000,
      now: () => clock,
    })
    await expect(client.listDocuments('2025-06-27')).rejects.toThrow('制限')
    expect(calls).toHaveLength(1)

    clock += 60_000 // 1 分後
    const blocked = await client.listDocuments('2025-06-26').catch((e: unknown) => e)
    expect(blocked).toBeInstanceOf(EdinetApiError)
    expect(String((blocked as Error).message)).toContain('止めています')
    expect(String((blocked as Error).message)).toContain('9 分')
    expect(calls).toHaveLength(1) // 送っていない

    clock += 10 * 60_000 // 冷却が明けたら、再び送れる
    expect(await client.listDocuments('2025-06-25')).toEqual([])
    expect(calls).toHaveLength(2)
  })

  test('401・403 や、本文が JSON のエラー(statusCode 429)でも、同じく送信を止める', async () => {
    for (const make of [() => json({}, 401), () => json({}, 403), () => json({ statusCode: 429, message: 'x' })]) {
      const { fetchImpl, calls } = fakeFetch(make)
      const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep, minIntervalMs: 0 })
      await client.listDocuments('2025-06-27').catch(() => undefined)
      await client.listDocuments('2025-06-26').catch(() => undefined)
      expect(calls).toHaveLength(1)
    }
  })

  test('404 や 500 では、止めない(次の要求は送る)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({}, 500))
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep, minIntervalMs: 0 })
    await client.listDocuments('2025-06-27').catch(() => undefined)
    await client.listDocuments('2025-06-26').catch(() => undefined)
    expect(calls).toHaveLength(2)
  })

  test('順番待ちの間に中止された要求は、送らず、間隔も消費しない', async () => {
    let clock = 0
    const sleeps: number[] = []
    const { fetchImpl, calls } = fakeFetch(() => json({ metadata: { status: '200' } }))
    const client = createEdinetClient({
      apiKey: KEY,
      fetchImpl,
      minIntervalMs: 1_000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms)
        clock += ms
      },
    })
    await client.listDocuments('2025-06-27') // 1 本目
    const controller = new AbortController()
    const aborted = client.listDocuments('2025-06-26', controller.signal).catch((e: unknown) => e)
    controller.abort()
    expect(await aborted).toBeDefined()
    expect(calls).toHaveLength(1)
    // 中止された要求は lastStarted を進めていないので、次の要求の待ち時間は、1 本目からの 1 秒だけ
    clock += 400
    await client.listDocuments('2025-06-25')
    expect(sleeps[sleeps.length - 1]).toBe(600)
  })

  test('タイムアウトは、接続失敗とは別の文章で伝える(キーを含めない)', async () => {
    const fetchImpl = (async () => {
      const e = new Error(`timeout SECRET ${KEY}`)
      e.name = 'TimeoutError'
      throw e
    }) as typeof fetch
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep, minIntervalMs: 0 })
    const error = await client.listDocuments('2025-06-27').catch((e: unknown) => e)
    expect(String((error as Error).message)).toContain('時間内')
    expect(String((error as Error).message)).not.toContain(KEY)
  })

  test('書類の受信が途中で切れたら、EdinetApiError にする', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([0x50, 0x4b]))
        controller.error(new Error('socket hang up'))
      },
    })
    const { fetchImpl } = fakeFetch(
      () => new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
    )
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep, minIntervalMs: 0 })
    await expect(client.downloadCsvZip('S100AAAA')).rejects.toBeInstanceOf(EdinetApiError)
  })
})

describe('createEdinetClient: 中止・サイズ・エラーの境目', () => {
  test('順番待ちの間隔の待機中に中止すると、待たずにすぐ終わる(切断後に「実行中」が残らない)', async () => {
    const { fetchImpl } = fakeFetch(() => json({ metadata: { status: '200' }, results: [] }))
    // 既定の待機(中止できる sleep)を使う。2 回目は、1 回目から 600ms 空けないと送れない
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, minIntervalMs: 600 })
    await client.listDocuments('2025-06-26')
    const abort = new AbortController()
    const started = Date.now()
    const second = client.listDocuments('2025-06-27', abort.signal)
    setTimeout(() => abort.abort(), 20)
    await expect(second).rejects.toBeDefined()
    expect(Date.now() - started).toBeLessThan(300)
  })

  test('中止された待機のあとも、次の要求は続けられる(待ち行列が詰まらない)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ metadata: { status: '200' }, results: [] }))
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, minIntervalMs: 100 })
    await client.listDocuments('2025-06-26')
    const abort = new AbortController()
    const aborted = client.listDocuments('2025-06-27', abort.signal)
    abort.abort()
    await expect(aborted).rejects.toBeDefined()
    await client.listDocuments('2025-06-28')
    expect(calls.map((c) => c.url.searchParams.get('date'))).toEqual(['2025-06-26', '2025-06-28'])
  })

  test('metadata.status が null の応答を、「ステータス 0 のエラー」にしない', async () => {
    const { fetchImpl } = fakeFetch(() => json({ metadata: { status: null }, results: [DOC] }))
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    await expect(client.listDocuments('2025-06-27')).rejects.not.toThrow(/ステータス 0/)
  })

  test('Content-Length を名乗らない巨大な応答は、上限で読むのをやめて断る', async () => {
    let pulled = 0
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled += 1
              controller.enqueue(new Uint8Array(8 * 1024 * 1024))
              if (pulled > 100) controller.close()
            },
          }),
          { status: 200, headers: { 'content-type': 'application/octet-stream' } },
        ),
    )
    const client = createEdinetClient({ apiKey: KEY, fetchImpl, sleep: noSleep })
    await expect(client.downloadCsvZip('S100AAAA')).rejects.toThrow(/大きすぎる/)
    // 上限(30MB)を超えた時点で止まり、100 回分(800MB)を読み続けない
    expect(pulled).toBeLessThan(10)
  })
})

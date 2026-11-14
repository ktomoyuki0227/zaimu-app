import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import type { EdinetCache } from './cache.ts'
import { EdinetApiError } from './client.ts'
import { UserFacingError } from './errors.ts'
import { parseCodeListText, type CompanyEntry } from './codeList.ts'
import type { CodeListStore } from './codeListStore.ts'
import type { ListedDocument } from './documents.ts'
import { createLocalApiHandler, type LocalApiDeps } from './localApi.ts'

const KEY = 'SECRET-KEY-123'

const CODE_LIST: readonly CompanyEntry[] = parseCodeListText(
  [
    'ＥＤＩＮＥＴコード,提出者種別,上場区分,連結の有無,資本金,決算日,提出者名,提出者名（英字）,提出者名（ヨミ）,所在地,提出者業種,証券コード,提出者法人番号',
    'E90001,内国法人・組合,上場,有,100000,3月31日,サンプル製作所株式会社,SAMPLE,サンプル,東京都,機械,12340,1',
  ].join('\n'),
)

const DOC: ListedDocument = {
  docID: 'S100AAAA',
  edinetCode: 'E90001',
  secCode: '12340',
  filerName: 'サンプル製作所株式会社',
  docTypeCode: '120',
  periodEnd: '2025-03-31',
  submitDateTime: '2025-06-27 15:00',
  csvFlag: '1',
  withdrawalStatus: '0',
}

function memoryCache(): EdinetCache {
  const days = new Map<string, ListedDocument[]>()
  const zips = new Map<string, Uint8Array>()
  return {
    getDay: async (d) => days.get(d) ?? null,
    putDay: async (d, docs) => {
      days.set(d, [...docs])
    },
    getZip: async (id) => zips.get(id) ?? null,
    putZip: async (id, b) => {
      zips.set(id, b)
    },
  }
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
})

async function start(overrides: Partial<LocalApiDeps> = {}): Promise<number> {
  const codeList: CodeListStore = { load: async () => CODE_LIST }
  const deps: LocalApiDeps = {
    codeList,
    service: {
      client: {
        listDocuments: async (date: string) => (date === '2025-06-27' ? [DOC] : []),
        downloadCsvZip: async () => Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2]),
      },
      cache: memoryCache(),
    },
    today: () => '2025-11-13',
    ...overrides,
  }
  const handler = createLocalApiHandler(deps)
  const server = createServer((req, res) =>
    handler(req, res, () => {
      res.statusCode = 404
      res.end('next')
    }),
  )
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

const OK_HEADERS = { 'x-local-api': '1', 'sec-fetch-site': 'same-origin' }

async function get(port: number, path: string, headers: Record<string, string> = OK_HEADERS): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, { headers })
}

/** Host ヘッダを指定して送る(fetch は Host を上書きできない) */
function rawGet(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = ''
      res.on('data', (c: Buffer) => {
        body += c.toString('utf-8')
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('ローカル API: アクセスの制限', () => {
  test('自前の画面が付けるヘッダが無い要求は、断る', async () => {
    const port = await start()
    expect((await get(port, '/local-api/edinet/status', {})).status).toBe(403)
  })

  test('別のサイトからの要求(Sec-Fetch-Site が same-origin 以外)は、断る', async () => {
    const port = await start()
    const res = await get(port, '/local-api/edinet/status', { 'x-local-api': '1', 'sec-fetch-site': 'cross-site' })
    expect(res.status).toBe(403)
  })

  test('Host が localhost 系でない要求(DNS リバインディング)は、断る', async () => {
    const port = await start()
    const res = await rawGet(port, '/local-api/edinet/status', { host: 'evil.example.com', ...OK_HEADERS })
    expect(res.status).toBe(403)
  })

  test('GET 以外は、断る', async () => {
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/local-api/edinet/status`, { method: 'POST', headers: OK_HEADERS })
    expect(res.status).toBe(405)
  })

  test('この API 以外のパスは、次の処理に渡す', async () => {
    const port = await start()
    const res = await get(port, '/index.html', {})
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('next')
  })

  test('どの応答にも、キャッシュ禁止と nosniff を付ける', async () => {
    const port = await start()
    const res = await get(port, '/local-api/edinet/status')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('ローカル API: status / companies', () => {
  test('status は、API キーが設定されているかを返す(キーそのものは返さない)', async () => {
    const port = await start()
    const body = await (await get(port, '/local-api/edinet/status')).json()
    expect(body).toEqual({ configured: true })
    const none = await start({ service: null })
    expect(await (await get(none, '/local-api/edinet/status')).json()).toEqual({ configured: false })
  })

  test('companies は、企業名・証券コードで探せる。API キーが無くても使える', async () => {
    const port = await start({ service: null })
    const res = await get(port, `/local-api/edinet/companies?q=${encodeURIComponent('サンプル製作所')}`)
    const body = (await res.json()) as { companies: CompanyEntry[] }
    expect(body.companies.map((c) => c.edinetCode)).toEqual(['E90001'])
    const bySec = (await (await get(port, '/local-api/edinet/companies?q=1234')).json()) as { companies: CompanyEntry[] }
    expect(bySec.companies).toHaveLength(1)
  })

  test('検索語が空・長すぎるときは 400', async () => {
    const port = await start()
    expect((await get(port, '/local-api/edinet/companies?q=')).status).toBe(400)
    expect((await get(port, `/local-api/edinet/companies?q=${'あ'.repeat(101)}`)).status).toBe(400)
  })

  test('コードリストを読めなければ 502(想定外の例外の中身は出さない)', async () => {
    const port = await start({
      codeList: {
        load: async () => {
          throw new Error(`secret detail ${KEY}`)
        },
      },
    })
    const res = await get(port, '/local-api/edinet/companies?q=abc')
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain(KEY)
  })
})

describe('ローカル API: reports / document', () => {
  test('API キーが無ければ、reports と document は 503(設定の案内つき)', async () => {
    const port = await start({ service: null })
    const a = await get(port, '/local-api/edinet/reports?edinetCode=E90001')
    const b = await get(port, '/local-api/edinet/document/S100AAAA')
    expect([a.status, b.status]).toEqual([503, 503])
    expect(await a.text()).toContain('EDINET_API_KEY')
  })

  test('reports は、進み具合を 1 行ずつ(NDJSON)流し、最後に見つかった書類を返す', async () => {
    const port = await start()
    const res = await get(port, '/local-api/edinet/reports?edinetCode=E90001&years=1')
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    const events = (await res.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string; reports?: { docID: string }[] })
    expect(events[0].type).toBe('progress')
    const done = events[events.length - 1]
    expect(done.type).toBe('done')
    expect(done.reports?.map((r) => r.docID)).toEqual(['S100AAAA'])
  })

  test('reports: EDINET コード・年数の指定が不正なら 400', async () => {
    const port = await start()
    for (const q of ['edinetCode=X1', 'edinetCode=E90001&years=0', 'edinetCode=E90001&years=9', 'edinetCode=E90001&years=abc']) {
      expect((await get(port, `/local-api/edinet/reports?${q}`)).status).toBe(400)
    }
  })

  test('reports: 知らない EDINET コードは、エラーの行を返す', async () => {
    const port = await start()
    const text = await (await get(port, '/local-api/edinet/reports?edinetCode=E99998')).text()
    expect(JSON.parse(text.trim().split('\n').pop() ?? '{}')).toMatchObject({ type: 'error' })
  })

  test('reports: EDINET 側の失敗は、利用者向けの文章で返す(キーを含めない)', async () => {
    const port = await start({
      service: {
        client: {
          listDocuments: async () => {
            throw new EdinetApiError('EDINET が API キーを受け付けませんでした。')
          },
          downloadCsvZip: async () => new Uint8Array(),
        },
        cache: memoryCache(),
      },
    })
    const text = await (await get(port, '/local-api/edinet/reports?edinetCode=E90001&years=1')).text()
    expect(text).toContain('API キー')
    expect(text).not.toContain(KEY)
  })

  test('document は、探索で見つかった書類の zip のバイト列を返す', async () => {
    const port = await start()
    await (await get(port, '/local-api/edinet/reports?edinetCode=E90001&years=1')).text()
    const res = await get(port, '/local-api/edinet/document/S100AAAA')
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([0x50, 0x4b, 3, 4, 1, 2])
  })

  test('document: 探索で見つかっていない書類管理番号は、書式が正しくても 404(任意の書類を取らせない)', async () => {
    const port = await start()
    const res = await get(port, '/local-api/edinet/document/S100ZZZZ')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toContain('先に')
  })

  test('document: 書類管理番号の書式でないものは 400(パスをたどらせない)', async () => {
    const port = await start()
    expect((await get(port, '/local-api/edinet/document/..%2F..%2Fetc')).status).toBe(400)
    expect((await get(port, '/local-api/edinet/document/s1')).status).toBe(400)
  })

  test('存在しない経路は 404', async () => {
    const port = await start()
    expect((await get(port, '/local-api/edinet/unknown')).status).toBe(404)
  })
})

describe('ローカル API: Origin・Referer の検査', () => {
  const SAME = { 'x-local-api': '1', 'sec-fetch-site': 'same-origin' }

  test('Sec-Fetch-Site が same-origin でも、Origin のホストが違えば断る(別のホストのページ)', async () => {
    const port = await start()
    const res = await get(port, '/local-api/edinet/status', { ...SAME, origin: 'https://abc.example.net' })
    expect(res.status).toBe(403)
  })

  test('Referer のホストが違えば断る(ヘッダを足さずに TCP を転送する中継を通った、外のブラウザ)', async () => {
    const port = await start()
    const res = await get(port, '/local-api/edinet/status', { ...SAME, referer: 'https://abc.example.net/' })
    expect(res.status).toBe(403)
  })

  test('Referer が自分のホストなら通す(自前の画面からの呼び出し)', async () => {
    const port = await start()
    const res = await get(port, '/local-api/edinet/status', { ...SAME, referer: `http://127.0.0.1:${port}/` })
    expect(res.status).toBe(200)
  })
})

describe('ローカル API: 追加のアクセス制限', () => {
  test('同じサイト(別ポートの localhost など)からの要求(Sec-Fetch-Site: same-site)は、断る', async () => {
    const port = await start()
    const res = await get(port, '/local-api/edinet/status', { 'x-local-api': '1', 'sec-fetch-site': 'same-site' })
    expect(res.status).toBe(403)
  })

  test('Sec-Fetch-Site を送らない古いブラウザでも、Origin が自分と違えば断る', async () => {
    const port = await start()
    const other = await rawGet(port, '/local-api/edinet/status', {
      host: `127.0.0.1:${port}`,
      'x-local-api': '1',
      origin: 'http://localhost:9999',
    })
    expect(other.status).toBe(403)
    const same = await rawGet(port, '/local-api/edinet/status', {
      host: `127.0.0.1:${port}`,
      'x-local-api': '1',
      origin: `http://127.0.0.1:${port}`,
    })
    expect(same.status).toBe(200)
  })

  test('中継(トンネル・リバースプロキシ)を経由した要求は、断る', async () => {
    const port = await start()
    for (const header of ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'via', 'x-forwarded-proto']) {
      const res = await rawGet(port, '/local-api/edinet/status', {
        host: `127.0.0.1:${port}`,
        'x-local-api': '1',
        [header]: 'tunnel.example.com',
      })
      expect(res.status, header).toBe(403)
    }
  })
})

describe('ローカル API: 失敗の文章と中止・同時実行', () => {
  test('利用者向けの例外(UserFacingError)の文章は、そのまま伝える。想定外の例外は伝えない', async () => {
    const make = (error: Error) => ({
      client: {
        listDocuments: async () => {
          throw error
        },
        downloadCsvZip: async () => new Uint8Array(),
      },
      cache: memoryCache(),
    })
    const shown = await start({ service: make(new UserFacingError('この提出者は決算日が不明です')) })
    const hidden = await start({ service: make(new Error(`secret ${KEY}`)) })
    const a = await (await get(shown, '/local-api/edinet/reports?edinetCode=E90001&years=1')).text()
    const b = await (await get(hidden, '/local-api/edinet/reports?edinetCode=E90001&years=1')).text()
    expect(a).toContain('決算日が不明です')
    expect(b).not.toContain(KEY)
    expect(b).toContain('問題が起きました')
  })

  test('探索は同時に 1 つだけ。実行中にもう 1 つ要求すると 409', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const port = await start({
      service: {
        client: {
          listDocuments: async () => {
            await gate
            return []
          },
          downloadCsvZip: async () => new Uint8Array(),
        },
        cache: memoryCache(),
      },
    })
    const first = get(port, '/local-api/edinet/reports?edinetCode=E90001&years=1')
    await new Promise((r) => setTimeout(r, 100))
    const second = await get(port, '/local-api/edinet/reports?edinetCode=E90001&years=1')
    expect(second.status).toBe(409)
    release()
    const text = await (await first).text()
    expect(text).toContain('"type":"done"')
    // 終わったら、また探索できる
    const third = await get(port, '/local-api/edinet/reports?edinetCode=E90001&years=1')
    expect(third.status).toBe(200)
    await third.text()
  })

  test('探索の結果に、提出期限が来ていない事業年度(pending)も含める', async () => {
    const port = await start()
    const text = await (await get(port, '/local-api/edinet/reports?edinetCode=E90001&years=1')).text()
    const done = JSON.parse(text.trim().split('\n').pop() ?? '{}') as { pending?: unknown }
    expect(Array.isArray(done.pending)).toBe(true)
  })
})

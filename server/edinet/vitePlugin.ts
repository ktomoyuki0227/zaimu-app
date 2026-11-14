import { join } from 'node:path'
import type { Plugin } from 'vite'
import { createFileCache } from './cache.ts'
import { createEdinetClient } from './client.ts'
import { createCodeListStore } from './codeListStore.ts'
import { createLocalApiHandler } from './localApi.ts'

export interface EdinetLocalApiOptions {
  /** EDINET の API キー。未設定(空)なら、企業の検索だけができる */
  readonly apiKey: string | undefined
  /** キャッシュを置くフォルダ(プロジェクト内の .cache/edinet。git には入れない) */
  readonly cacheDir: string
}

const JST_OFFSET_MS = 9 * 3_600_000

/** 日本時間の今日(YYYY-MM-DD)。EDINET の提出日は日本時間 */
export function todayInJapan(nowMs: number = Date.now()): string {
  return new Date(nowMs + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 開発サーバー(npm run dev)と、ビルド後の確認用サーバー(npm run preview)に、
 * EDINET から有価証券報告書を取得するための、この PC 内だけの API を足す。
 * ビルド成果物(dist)には含まれない。公開用の静的ホスティングでは、この機能は使えない。
 */
export function edinetLocalApi(options: EdinetLocalApiOptions): Plugin {
  const apiKey = options.apiKey?.trim() ?? ''
  const cacheDir = join(options.cacheDir, 'edinet')
  const handler = createLocalApiHandler({
    codeList: createCodeListStore({ dir: cacheDir }),
    service:
      apiKey === ''
        ? null
        : { client: createEdinetClient({ apiKey }), cache: createFileCache(cacheDir) },
    today: () => todayInJapan(),
  })
  return {
    name: 'edinet-local-api',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

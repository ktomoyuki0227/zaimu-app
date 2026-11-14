import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { edinetLocalApi } from './server/edinet/vitePlugin.ts'
import { contentSecurityPolicy } from './server/securityHeaders.ts'

/** このファイルのあるフォルダ(プロジェクトの根)。どのフォルダから起動しても、.env とキャッシュの場所が変わらないようにする */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
    // EDINET から有価証券報告書を取得する、この PC 内だけの API(開発・確認用サーバーにだけ足す)。
    // API キーは .env の EDINET_API_KEY から読む。VITE_ で始まらない名前なので、画面のコードには渡らない
    edinetLocalApi({
      apiKey: loadEnv(mode, PROJECT_ROOT, 'EDINET_').EDINET_API_KEY,
      cacheDir: join(PROJECT_ROOT, '.cache'),
    }),
  ],
  build: {
    // 小さなフォントを data: URI に埋め込まない(CSP の font-src 'self' で読めなくなるため)
    assetsInlineLimit: 0,
  },
  server: {
    // 画面は同じオリジンから開くので、ほかのオリジンからの通信(CORS)は許可しない。
    // 既定のままだと、別のポートの localhost のページからも、中継の API を呼べてしまう
    cors: false,
    // この PC の中だけで待ち受ける(既定と同じ。EDINET の中継を、LAN や外に見せない意思をここに残す)
    host: 'localhost',
    fs: {
      // 既定の拒否リスト(.env など)に、取得結果のキャッシュ(調べた企業の履歴)を足す。
      // fs.deny を指定すると既定が置き換わりうるので、既定の分も書く
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.cache/**', '**/.claude/**'],
    },
    // キャッシュの書き込みで、開発サーバーが反応しないようにする
    watch: { ignored: ['**/.cache/**'] },
  },
  preview: { cors: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // 下回ったら、カバレッジの確認(npm run test:coverage)が失敗する。実測は、文 93%・分岐 85%(2026-11)
      thresholds: { statements: 85, lines: 85, functions: 85, branches: 75 },
      include: ['src/domain/**/*.ts', 'src/lib/**/*.ts', 'src/components/**/*.{ts,tsx}', 'src/App.tsx', 'server/edinet/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        'src/domain/fixtures.ts',
        'src/domain/**/testing/**',
        'src/domain/types.ts',
        'src/domain/import/types.ts',
        'src/data/**',
        // Vite への組み込み(薄い接続部分)は、起動して確かめる
        'server/edinet/vitePlugin.ts',
      ],
    },
  },
}))

import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { edinetLocalApi } from './server/edinet/vitePlugin.ts'

/**
 * 本番ビルドに入れる Content-Security-Policy。
 * 外部への通信を一切許さず、スクリプト・スタイル・フォントを同じオリジンのファイルだけに限る。
 * - style-src-attr 'unsafe-inline': グラフ(Recharts)や React が style 属性を使うため、属性だけ許可する
 *   (スタイルシートや <style> タグのインライン指定は許可しない)
 * - frame-ancestors は meta では効かないため、ホスティング側の HTTP ヘッダで設定する
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** 開発サーバー(HMR がインラインのスクリプトを使う)には入れず、ビルドにだけ meta を差し込む */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'inject-content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
    // EDINET から有価証券報告書を取得する、この PC 内だけの API(開発・確認用サーバーにだけ足す)。
    // API キーは .env の EDINET_API_KEY から読む。VITE_ で始まらない名前なので、画面のコードには渡らない
    edinetLocalApi({
      apiKey: loadEnv(mode, process.cwd(), 'EDINET_').EDINET_API_KEY,
      cacheDir: join(process.cwd(), '.cache'),
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
    fs: {
      // 既定の拒否リスト(.env など)に、取得結果のキャッシュ(調べた企業の履歴)を足す。
      // fs.deny を指定すると既定が置き換わりうるので、既定の分も書く
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.cache/**'],
    },
    // キャッシュの書き込みで、開発サーバーが反応しないようにする
    watch: { ignored: ['**/.cache/**'] },
  },
  preview: { cors: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts', 'server/edinet/**/*.ts'],
      exclude: [
        'src/domain/**/*.test.ts',
        'src/domain/fixtures.ts',
        'src/domain/types.ts',
        'server/edinet/**/*.test.ts',
        // Vite への組み込み(薄い接続部分)は、起動して確かめる
        'server/edinet/vitePlugin.ts',
      ],
    },
  },
}))

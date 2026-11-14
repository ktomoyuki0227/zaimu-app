import type { Plugin } from 'vite'

/**
 * 公開するときの、セキュリティ関連のヘッダ。
 * Content-Security-Policy は、ビルドに入れる meta タグと、ホスティング側の HTTP ヘッダで、同じ内容を使う
 * (HTTP ヘッダでは frame-ancestors も効くので、他のサイトの <iframe> に埋め込まれるのを断る)。
 */

/**
 * 外部への通信を一切許さず、スクリプト・スタイル・フォントを同じオリジンのファイルだけに限る。
 * - style-src-attr 'unsafe-inline': グラフ(Recharts)や React が style 属性を使うため、属性だけ許可する
 *   (スタイルシートや <style> タグのインライン指定は許可しない)
 * - frame-ancestors は meta では効かないため、HTTP ヘッダの側にだけ足す
 */
export const CONTENT_SECURITY_POLICY = [
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

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': `${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000',
}

/** ファイル名にハッシュが付く、ビルド済みのファイルは、長くキャッシュしてよい */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/**
 * `_headers` ファイルの中身(Netlify・Cloudflare Pages の形式)。
 * Vercel など、ほかのホスティングで使うときは、同じヘッダを、そのホスティングの設定に写す(docs/hosting-headers.md)。
 */
export function headersFile(): string {
  const lines = ['/*', ...Object.entries(SECURITY_HEADERS).map(([name, value]) => `  ${name}: ${value}`)]
  lines.push('', '/assets/*', `  Cache-Control: ${IMMUTABLE_CACHE}`)
  return `${lines.join('\n')}\n`
}

/**
 * 開発サーバー(HMR がインラインのスクリプトを使う)には入れず、ビルドにだけ入れる。
 * - index.html に、CSP の meta タグを差し込む
 * - 公開用のヘッダのファイル(_headers。Netlify・Cloudflare Pages では、置くだけで効く)も、同じ定義から出す
 */
export function contentSecurityPolicy(): Plugin {
  return {
    name: 'inject-content-security-policy',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile() })
    },
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
        injectTo: 'head-prepend',
      },
    ],
  }
}

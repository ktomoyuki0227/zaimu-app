import { describe, expect, test } from 'vitest'
import { CONTENT_SECURITY_POLICY, contentSecurityPolicy, headersFile } from './securityHeaders.ts'

describe('CONTENT_SECURITY_POLICY', () => {
  test('外部への通信・外部のスクリプト・プラグインを許さない', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'")
    expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval')
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*unsafe-inline/)
  })

  test('frame-ancestors は meta では効かないので、ここには入れない', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('frame-ancestors')
  })
})

describe('headersFile', () => {
  const file = headersFile()

  test('すべてのパスに、CSP(frame-ancestors つき)・nosniff・フレーム埋め込みの拒否・Referrer-Policy を付ける', () => {
    const all = file.split('\n\n')[0]
    expect(all.startsWith('/*\n')).toBe(true)
    expect(all).toContain(`Content-Security-Policy: ${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`)
    expect(all).toContain('X-Content-Type-Options: nosniff')
    expect(all).toContain('X-Frame-Options: DENY')
    expect(all).toContain('Referrer-Policy: strict-origin-when-cross-origin')
    expect(all).toContain('Strict-Transport-Security: max-age=31536000')
  })

  test('ビルド済みのファイル(/assets)だけ、長くキャッシュする', () => {
    expect(file).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable')
    expect(file.indexOf('Cache-Control')).toBeGreaterThan(file.indexOf('/assets/*'))
  })

  test('各行は、ヘッダ名と値が「名前: 値」の形(Netlify・Cloudflare の書式)', () => {
    for (const line of file.split('\n').filter((l) => l.startsWith('  '))) {
      expect(line).toMatch(/^ {2}[A-Za-z-]+: .+$/)
    }
  })
})

describe('contentSecurityPolicy(Vite のプラグイン)', () => {
  const plugin = contentSecurityPolicy()

  test('ビルドのときだけ動く(開発サーバーには、HMR のために入れない)', () => {
    expect(plugin.apply).toBe('build')
  })

  test('index.html の先頭に、CSP の meta タグを差し込む', () => {
    const transform = plugin.transformIndexHtml as unknown as () => { tag: string; attrs: Record<string, string>; injectTo: string }[]
    const [tag] = transform()
    expect(tag.tag).toBe('meta')
    expect(tag.attrs['http-equiv']).toBe('Content-Security-Policy')
    expect(tag.injectTo).toBe('head-prepend')
  })

  test('meta の CSP と、_headers の CSP は、同じ方針(HTTP ヘッダの側は、frame-ancestors だけが加わる)', () => {
    const transform = plugin.transformIndexHtml as unknown as () => { attrs: Record<string, string> }[]
    const metaPolicy = transform()[0].attrs.content
    const emitted: { fileName: string; source: string }[] = []
    const generate = plugin.generateBundle as unknown as (this: { emitFile: (f: { fileName: string; source: string }) => void }) => void
    generate.call({ emitFile: (f) => emitted.push(f) })
    expect(emitted).toHaveLength(1)
    expect(emitted[0].fileName).toBe('_headers')
    expect(emitted[0].source).toContain(`Content-Security-Policy: ${metaPolicy}; frame-ancestors 'none'`)
  })
})

import { describe, expect, test } from 'vitest'
import { decodeText } from './decodeText'

function utf16le(text: string, bom: boolean): Uint8Array {
  const body = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    body[i * 2] = code & 0xff
    body[i * 2 + 1] = code >> 8
  }
  return bom ? Uint8Array.from([0xff, 0xfe, ...body]) : body
}

describe('decodeText', () => {
  test('BOM 付きの UTF-16LE を読める(EDINET の CSV)', () => {
    expect(decodeText(utf16le('要素ID\t値', true))).toBe('要素ID\t値')
  })

  test('BOM の無い UTF-16LE も、ゼロバイトの並びから見分けて読める', () => {
    expect(decodeText(utf16le('abc\tdef', false))).toBe('abc\tdef')
  })

  test('BOM 付きの UTF-8 を読める', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('値')])
    expect(decodeText(bytes)).toBe('値')
  })

  test('BOM の無い UTF-8 を読める', () => {
    expect(decodeText(new TextEncoder().encode('財務ビュー'))).toBe('財務ビュー')
  })

  test('UTF-8 として不正なバイト列は null', () => {
    expect(decodeText(Uint8Array.from([0xff, 0x41, 0xc3, 0x28]))).toBeNull()
  })

  test('空のデータは空文字', () => {
    expect(decodeText(new Uint8Array(0))).toBe('')
  })
})

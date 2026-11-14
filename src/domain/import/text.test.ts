import { describe, expect, test } from 'vitest'
import { cleanText } from './text'

describe('cleanText', () => {
  test('ふつうの文字列はそのまま(前後の空白だけ除く)', () => {
    expect(cleanText('  サンプル製作所(架空) ', 100)).toBe('サンプル製作所(架空)')
  })

  test('表示を偽装できる文字(右から左への切り替え・ゼロ幅・改行・タブ)を取り除く', () => {
    expect(cleanText('abc‮def​\ng\th', 100)).toBe('abcdefgh')
  })

  test('空になる文字列と undefined は null', () => {
    expect(cleanText('​\n', 100)).toBeNull()
    expect(cleanText('   ', 100)).toBeNull()
    expect(cleanText(undefined, 100)).toBeNull()
  })

  test('切り詰めは文字単位で行い、サロゲートペア(𠮷など)を壊さない', () => {
    expect(cleanText('𠮷𠮷𠮷', 2)).toBe('𠮷𠮷')
    expect(cleanText('abcdef', 3)).toBe('abc')
  })
})

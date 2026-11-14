import { describe, expect, test } from 'vitest'
import { parseTsv } from './tsv'

describe('parseTsv', () => {
  test('タブ区切りと改行で行・列に分ける', () => {
    expect(parseTsv('a\tb\nc\td', 100)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  test('CRLF の改行と、末尾の改行を扱える', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n', 100)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  test('二重引用符で囲まれた欄は、中のタブ・改行・引用符をそのまま持つ', () => {
    expect(parseTsv('"a\tb"\t"c\nd"\t"e""f"', 100)).toEqual([['a\tb', 'c\nd', 'e"f']])
  })

  test('空の欄を保つ', () => {
    expect(parseTsv('a\t\tc', 100)).toEqual([['a', '', 'c']])
  })

  test('空の入力は行なし', () => {
    expect(parseTsv('', 100)).toEqual([])
  })

  test('行数が上限を超えたら null(巨大ファイルで固まらない)', () => {
    expect(parseTsv('a\nb\nc\nd', 3)).toBeNull()
    expect(parseTsv('a\nb\nc', 3)).toEqual([['a'], ['b'], ['c']])
  })

  test('引用符が閉じていなければ、読み取りを諦める(null)', () => {
    expect(parseTsv('a\t"b\tc', 100)).toBeNull()
  })

  test('引用符のあとに文字が続いても、区切りまでを同じ欄として読む', () => {
    expect(parseTsv('"a"b\tc', 100)).toEqual([['ab', 'c']])
  })

  test('1 つの欄が大きすぎたら null(引用符つきでも、なしでも)', () => {
    const limits = { maxFieldChars: 10, maxFieldsPerRow: 100, maxFields: 1000 }
    expect(parseTsv('x'.repeat(11), 100, limits)).toBeNull()
    expect(parseTsv(`"${'x'.repeat(11)}"`, 100, limits)).toBeNull()
    expect(parseTsv('x'.repeat(10), 100, limits)).toEqual([['x'.repeat(10)]])
  })

  test('1 行の欄が多すぎたら null(タブだけの巨大なファイル対策)', () => {
    const limits = { maxFieldChars: 10, maxFieldsPerRow: 5, maxFields: 1000 }
    expect(parseTsv('\t'.repeat(6), 100, limits)).toBeNull()
    expect(parseTsv('\t'.repeat(4), 100, limits)).toHaveLength(1)
  })

  test('全体の欄の数が多すぎたら null', () => {
    const limits = { maxFieldChars: 10, maxFieldsPerRow: 5, maxFields: 7 }
    expect(parseTsv('a\tb\tc\td\na\tb\tc\td', 100, limits)).toBeNull()
  })

  test('途中の空行と、行頭だけのタブの行を区別する', () => {
    expect(parseTsv('a\n\n\t\nb', 100)).toEqual([['a'], ['', ''], ['b']])
  })
})

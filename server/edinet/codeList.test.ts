import { describe, expect, test } from 'vitest'
import { parseCodeListText, searchCompanies, type CompanyEntry } from './codeList.ts'

const HEADER =
  'ＥＤＩＮＥＴコード,提出者種別,上場区分,連結の有無,資本金,決算日,提出者名,提出者名（英字）,提出者名（ヨミ）,所在地,提出者業種,証券コード,提出者法人番号'

const SAMPLE = [
  'ダウンロード実行日,2026年11月13日現在,件数,4件',
  HEADER,
  'E90001,内国法人・組合,上場,有,100000,3月31日,サンプル製作所株式会社,"SAMPLE SEISAKUSHO, INC.",サンプルセイサクショ,東京都,機械,12340,1000000000001',
  'E90002,内国法人・組合,上場,有,5000,12月31日,株式会社別のサンプル商事,OTHER SHOJI CO.,ベツノ,大阪府,卸売業,56780,1000000000002',
  'E90003,内国法人・組合,非上場,無,100,2月末日,テスト工業株式会社,TEST KOGYO,テスト,京都府,金属製品,,1000000000003',
  'E90004,外国法人・組合,非上場,無,,,Foreign Fund,Foreign Fund,,,,,',
].join('\r\n')

describe('parseCodeListText', () => {
  const list = parseCodeListText(SAMPLE)

  test('1 行目のメタ情報を飛ばし、見出しの名前で列を見つけて読む', () => {
    expect(list).toHaveLength(4)
    expect(list[0]).toEqual({
      edinetCode: 'E90001',
      name: 'サンプル製作所株式会社',
      nameEn: 'SAMPLE SEISAKUSHO, INC.',
      secCode: '12340',
      fiscalYearEnd: { month: 3, day: 31 },
      listed: true,
    })
  })

  test('「2月末日」は月末として読む', () => {
    expect(list[2].fiscalYearEnd).toEqual({ month: 2, day: 'end' })
  })

  test('決算日・証券コードが空なら null', () => {
    expect(list[3].fiscalYearEnd).toBeNull()
    expect(list[3].secCode).toBeNull()
    expect(list[2].secCode).toBeNull()
  })

  test('上場区分は「上場」のときだけ true', () => {
    expect(list.map((c) => c.listed)).toEqual([true, true, false, false])
  })

  test('EDINET コードの書式でない行は読み飛ばす', () => {
    const text = [HEADER, 'XXXX,a,上場,有,1,3月31日,名前,N,ヨミ,住所,業種,10000,1'].join('\n')
    expect(parseCodeListText(text)).toEqual([])
  })

  test('見出しが想定と違えば、例外にする(別の形式を読み違えない)', () => {
    expect(() => parseCodeListText('a,b,c\n1,2,3')).toThrow()
  })
})

describe('parseCodeListBytes', () => {
  test('Shift_JIS(cp932)のバイト列を読める', () => {
    // 「上場」の Shift_JIS: 8F E3 8F EA
    const bytes = Uint8Array.from([0x8f, 0xe3, 0x8f, 0xea])
    expect(new TextDecoder('shift_jis').decode(bytes)).toBe('上場')
  })
})

describe('searchCompanies', () => {
  const list: readonly CompanyEntry[] = parseCodeListText(SAMPLE)

  test('証券コードは、4 桁でも 5 桁でも引ける', () => {
    expect(searchCompanies(list, '1234').map((c) => c.edinetCode)).toEqual(['E90001'])
    expect(searchCompanies(list, '12340').map((c) => c.edinetCode)).toEqual(['E90001'])
  })

  test('EDINET コードで引ける(大文字小文字は問わない)', () => {
    expect(searchCompanies(list, 'e90002').map((c) => c.edinetCode)).toEqual(['E90002'])
  })

  test('社名は部分一致(全角・半角、空白の違いを吸収する)', () => {
    expect(searchCompanies(list, 'サンプル製作所').map((c) => c.edinetCode)).toEqual(['E90001'])
    expect(searchCompanies(list, 'サンプル 製作所').map((c) => c.edinetCode)).toEqual(['E90001'])
    expect(searchCompanies(list, 'ＳＡＭＰＬＥ').map((c) => c.edinetCode)).toEqual(['E90001'])
  })

  test('「株式会社」の有無は問わない', () => {
    expect(searchCompanies(list, '別のサンプル商事').map((c) => c.edinetCode)).toEqual(['E90002'])
  })

  test('上場企業を先に、件数は上限まで', () => {
    const result = searchCompanies(list, 'サンプル')
    expect(result.map((c) => c.edinetCode)).toEqual(['E90001', 'E90002'])
    expect(searchCompanies(list, 'サンプル', 1)).toHaveLength(1)
  })

  test('空の検索語・短すぎる社名の検索語は、何も返さない', () => {
    expect(searchCompanies(list, '')).toEqual([])
    expect(searchCompanies(list, ' ')).toEqual([])
    expect(searchCompanies(list, 'a')).toEqual([])
  })
})

import { describe, expect, test } from 'vitest'
import { parseEdinetCsv } from './edinetCsv'
import { extractFromFacts } from './extract'
import { attentionItems } from './review'
import { buildCsvText, fixtureRows, type FixtureOptions } from './testing/edinetFixture'

function extract(options: FixtureOptions = {}) {
  const parsed = parseEdinetCsv(buildCsvText(fixtureRows(options)), 100_000)
  if (!parsed.ok) throw new Error(parsed.reason)
  return extractFromFacts(parsed.facts, parsed.info)
}

describe('attentionItems', () => {
  test('すべて問題なく取れた書類は、要確認の項目なし', () => {
    expect(attentionItems(extract())).toEqual([])
  })

  test('取れなかった項目(0 の仮置き)は、期・項目名・理由つきで挙がる', () => {
    const items = attentionItems(extract({ omit: ['DepreciationAndAmortizationOpeCF'] }))
    expect(items).toHaveLength(2) // 前期と当期
    expect(items[1]).toMatchObject({
      periodLabel: '2025年3月期',
      fieldLabel: '減価償却費',
      status: 'missing',
      valueYen: 0,
    })
    expect(items[1].note).toContain('見つかりません')
  })

  test('差額・近似で求めた項目(信頼度 medium)も挙げ、根拠を添える', () => {
    const items = attentionItems(extract({ omit: ['SellingGeneralAndAdministrativeExpenses'] }))
    const current = items.find((i) => i.periodLabel === '2025年3月期' && i.fieldLabel === '販売費及び一般管理費')
    expect(current).toMatchObject({ status: 'derived', valueYen: 27_000_000_000 })
    expect(current?.sources).toEqual(['売上総利益 − 営業利益'])
  })

  test('「該当なし」と、確実に取れた項目は挙げない', () => {
    const items = attentionItems(extract({ omit: ['ShortTermInvestmentSecurities'] }))
    expect(items).toEqual([])
  })
})

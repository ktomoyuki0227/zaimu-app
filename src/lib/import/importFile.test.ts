import { strToU8, zipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import { DEFAULT_IMPORT_LIMITS } from '../../domain/limits'
import { buildCsvText, encodeUtf16le, fixtureRows } from '../../domain/import/testing/edinetFixture'
import { importFromBytes } from './importFile'

const LIMITS = DEFAULT_IMPORT_LIMITS
const csvBytes = (): Uint8Array => encodeUtf16le(buildCsvText(fixtureRows()))

describe('importFromBytes', () => {
  test('EDINET の CSV(zip)から、2 期分の抽出結果を作る', () => {
    const zip = zipSync({ 'XBRL_TO_CSV/jpcrp030000-asr-001.csv': csvBytes() })
    const outcome = importFromBytes(zip, LIMITS)
    expect(outcome.kind).toBe('result')
    if (outcome.kind !== 'result') return
    expect(outcome.result.errors).toEqual([])
    expect(outcome.result.periods).toHaveLength(2)
    expect(outcome.result.needsReview).toBe(false)
  })

  test('zip に入れていない CSV そのものも読める', () => {
    const outcome = importFromBytes(csvBytes(), LIMITS)
    expect(outcome.kind).toBe('result')
  })

  test('UTF-8 の CSV も読める', () => {
    const outcome = importFromBytes(strToU8(buildCsvText(fixtureRows())), LIMITS)
    expect(outcome.kind).toBe('result')
  })

  test('PDF は、対応していないと知らせる', () => {
    const outcome = importFromBytes(strToU8('%PDF-1.7\n...'), LIMITS)
    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') expect(outcome.message).toContain('PDF')
  })

  test('XML・HTML(XBRL)は、対応していないと知らせる', () => {
    expect(importFromBytes(strToU8('<?xml version="1.0"?><xbrl/>'), LIMITS).kind).toBe('error')
    expect(importFromBytes(strToU8('<html><body></body></html>'), LIMITS).kind).toBe('error')
  })

  test('EDINET の CSV でない文書は、理由つきで拒否する', () => {
    const outcome = importFromBytes(strToU8('a,b,c\n1,2,3'), LIMITS)
    expect(outcome.kind).toBe('error')
  })

  test('空のファイルは読まない', () => {
    expect(importFromBytes(new Uint8Array(0), LIMITS).kind).toBe('error')
  })

  test('大きすぎるファイルは、読む前に拒否する', () => {
    const outcome = importFromBytes(new Uint8Array(2_000), { ...LIMITS, maxFileBytes: 1_000 })
    expect(outcome.kind).toBe('error')
  })

  test('米国基準など反映できない書類は、結果の errors に理由が入る', () => {
    const outcome = importFromBytes(
      encodeUtf16le(buildCsvText(fixtureRows({ standard: 'US GAAP' }))),
      LIMITS,
    )
    expect(outcome.kind).toBe('result')
    if (outcome.kind === 'result') expect(outcome.result.errors.length).toBeGreaterThan(0)
  })
})

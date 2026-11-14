import { describe, expect, test } from 'vitest'
import { buildCsvText, encodeUtf16le, fixtureRows } from '../../domain/import/testing/edinetFixture'
import { DEFAULT_IMPORT_LIMITS } from '../../domain/limits'
import { runImportBytes } from './runImport'

function importWith(options: Parameters<typeof fixtureRows>[0]) {
  return runImportBytes(encodeUtf16le(buildCsvText(fixtureRows(options))), DEFAULT_IMPORT_LIMITS)
}

describe('runImportBytes: 企業の識別', () => {
  test('EDINET コードがあれば、同じ企業として識別する(別の年度の書類が、1 つの企業にまとまる)', () => {
    const a = importWith({ edinetCode: 'E12345' })
    const b = importWith({ edinetCode: 'E12345', currentEnd: '2026-03-31' })
    if (a.kind !== 'ready' || b.kind !== 'ready') throw new Error('読み込めませんでした')
    expect(a.company?.id).toBe('edinet-E12345')
    expect(b.company?.id).toBe(a.company?.id)
  })

  test('EDINET コードも会社名も読めない書類は、そのつど別の企業にする(無関係な書類が混ざらない)', () => {
    const a = importWith({ edinetCode: '', companyName: '' })
    const b = importWith({ edinetCode: '', companyName: '' })
    if (a.kind !== 'ready' || b.kind !== 'ready') throw new Error('読み込めませんでした')
    expect(a.company?.id.startsWith('unnamed-')).toBe(true)
    expect(a.company?.id).not.toBe(b.company?.id)
  })
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { buildCsvText, encodeUtf16le, fixtureRows, type FixtureOptions } from '../domain/import/testing/edinetFixture'
import { useImport, type AppliedItem, type FetchedDocument } from './useImport'

afterEach(cleanup)

/** 取り込める書類(UTF-16 の CSV)。name は表示に使うファイル名 */
function doc(name: string, options: FixtureOptions = {}): FetchedDocument {
  return { fileName: name, bytes: encodeUtf16le(buildCsvText(fixtureRows(options))) }
}

/** 確認が必要になる書類(現金及び預金の科目が無い) */
const needsReviewDoc = (name: string) => doc(name, { omit: ['CashAndDeposits'] })
const garbageDoc = (name: string): FetchedDocument => ({ fileName: name, bytes: Uint8Array.of(1, 2, 3) })

function setup(apply: (items: readonly AppliedItem[]) => boolean = () => true) {
  const onApply = vi.fn((items: readonly AppliedItem[]) => apply(items))
  const hook = renderHook(() => useImport(onApply, true))
  return { onApply, ...hook }
}

describe('useImport.importDocuments', () => {
  test('すべて確認不要なら、古い順のまま反映し、その企業のページを開く(一覧は出さない)', async () => {
    const { result, onApply } = setup()
    await act(() => result.current.importDocuments([doc('2024'), doc('2025', { currentEnd: '2026-03-31' })]))
    expect(onApply).toHaveBeenCalledTimes(1)
    const [items, options] = onApply.mock.calls[0] as unknown as [AppliedItem[], { open: boolean }]
    expect(items.map((i) => i.fileName)).toEqual(['2024', '2025'])
    expect(options.open).toBe(true)
    expect(result.current.phase).toEqual({ kind: 'idle' })
  })

  test('確認が必要な書類が混ざるときは、確認不要のものだけ反映し、ページは開かず、一覧で知らせる', async () => {
    const { result, onApply } = setup()
    await act(() => result.current.importDocuments([doc('良い'), needsReviewDoc('要確認'), garbageDoc('壊れ')]))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0].map((i) => i.fileName)).toEqual(['良い'])
    expect((onApply.mock.calls[0] as unknown[])[1]).toEqual({ open: false })
    const phase = result.current.phase
    if (phase.kind !== 'batch') throw new Error(`batch ではありません: ${phase.kind}`)
    expect(phase.items.map((i) => [i.fileName, i.status])).toEqual([
      ['良い', 'applied'],
      ['要確認', 'review'],
      ['壊れ', 'failed'],
    ])
    expect(phase.companyId).not.toBeNull()
  })

  test('反映できなかった(企業が上限)ときは、「読み込みました」と偽らず、失敗として知らせる', async () => {
    const { result } = setup(() => false)
    await act(() => result.current.importDocuments([doc('A')]))
    const phase = result.current.phase
    if (phase.kind !== 'batch') throw new Error('batch ではありません')
    expect(phase.items[0].status).toBe('failed')
    expect(phase.items[0].message).toContain('上限')
    expect(phase.companyId).toBeNull()
  })

  test('書類が 0 件なら、何もしない', async () => {
    const { result, onApply } = setup()
    await act(() => result.current.importDocuments([]))
    expect(onApply).not.toHaveBeenCalled()
    expect(result.current.phase).toEqual({ kind: 'idle' })
  })

  test('続けて 2 回呼ぶと、先の結果は捨てる(新しい取り込みの結果だけを反映する)', async () => {
    const { result, onApply } = setup()
    await act(async () => {
      const first = result.current.importDocuments([doc('古い呼び出し')])
      const second = result.current.importDocuments([doc('新しい呼び出し')])
      await Promise.all([first, second])
    })
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0][0].fileName).toBe('新しい呼び出し')
  })

  test('ファイル名は、表示を偽装する文字(右から左への切り替えなど)を取り除いて使う', async () => {
    const { result } = setup()
    await act(() => result.current.importDocuments([garbageDoc('‮壊れ​た')]))
    const phase = result.current.phase
    if (phase.kind !== 'batch') throw new Error('batch ではありません')
    expect(phase.items[0].fileName).toBe('壊れた')
  })
})

describe('useImport: 確認から戻るときのフォーカス', () => {
  /** ファイルを選ぶボタンが、折りたたみの中にある画面(ホームと同じ作り) */
  function Harness() {
    const c = useImport(() => true, true)
    return (
      <div>
        <h1 ref={c.setHomeFocus} tabIndex={-1}>
          見出し
        </h1>
        <details data-testid="fold">
          <summary>手元のファイルから</summary>
          <button ref={c.setPickerButton} type="button">
            ファイルを選ぶ
          </button>
          <input ref={c.setInput} type="file" onChange={c.onInputChange} data-testid="file" />
        </details>
        {c.phase.kind === 'error' ? (
          <button type="button" onClick={c.closeReview}>
            閉じる
          </button>
        ) : null}
      </div>
    )
  }

  /** 2 ファイル同時の選択は、エラーの表示になる(取り込みの中身には依存しない) */
  async function causeError(): Promise<void> {
    const input = screen.getByTestId('file') as HTMLInputElement
    const files = [new File(['a'], 'a.csv'), new File(['b'], 'b.csv')]
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    fireEvent.change(input)
    await screen.findByText('閉じる')
  }

  test('折りたたみが閉じているときは、見えないボタンではなく、見出しにフォーカスを戻す', async () => {
    render(<Harness />)
    await causeError()
    fireEvent.click(screen.getByText('閉じる'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('見出し')))
  })

  test('折りたたみが開いているときは、ファイルを選ぶボタンに戻す', async () => {
    render(<Harness />)
    ;(screen.getByTestId('fold') as HTMLDetailsElement).open = true
    await causeError()
    fireEvent.click(screen.getByText('閉じる'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('ファイルを選ぶ')))
  })
})

describe('useImport: ファイルのドロップ', () => {
  function fileDrop(type: string): Event {
    const event = new Event(type, { cancelable: true, bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [] } })
    return event
  }

  test('取り込みのページ以外でも、ブラウザがそのファイルを開いてしまわないよう、ドロップを止める', () => {
    renderHook(() => useImport(() => true, false))
    const drop = fileDrop('drop')
    window.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
  })

  test('ファイル以外(文字列など)のドラッグには反応しない', () => {
    renderHook(() => useImport(() => true, true))
    const drop = new Event('drop', { cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['text/plain'], files: [] } })
    window.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(false)
  })

  test('取り込みのページでは、ドラッグ中の表示を出し、ドロップで消す', () => {
    const { result } = renderHook(() => useImport(() => true, true))
    act(() => {
      window.dispatchEvent(fileDrop('dragenter'))
    })
    expect(result.current.dragging).toBe(true)
    act(() => {
      window.dispatchEvent(fileDrop('drop'))
    })
    expect(result.current.dragging).toBe(false)
  })
})

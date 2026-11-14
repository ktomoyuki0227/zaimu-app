import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { cleanText } from '../domain/import/text'
import type { ExtractionResult } from '../domain/import/types'
import { MAX_TEXT_LENGTH } from '../domain/limits'
import type { Company } from '../domain/types'

/** 取り込みの確認が要らず、そのまま反映する 1 件 */
export interface AppliedItem {
  readonly company: Company
  readonly result: ExtractionResult
  readonly fileName: string
}

/** まとめて取り込んだ書類のうち、1 件の結果 */
export interface BatchItem {
  readonly fileName: string
  /** applied: 反映した / review: 確認が必要(反映していない) / failed: 読めなかった */
  readonly status: 'applied' | 'review' | 'failed'
  readonly message?: string
  readonly result?: ExtractionResult
  readonly company?: Company | null
}

export type ImportPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading'; readonly fileName: string }
  | { readonly kind: 'error'; readonly fileName: string; readonly message: string }
  | {
      readonly kind: 'review'
      readonly fileName: string
      readonly result: ExtractionResult
      /** 反映できるときだけ入る(errors があれば null) */
      readonly company: Company | null
      /** まとめて取り込んだ書類の一覧から開いたとき、確認を終えたら戻る先(無ければ null) */
      readonly returnTo?: { readonly items: readonly BatchItem[]; readonly companyId: string | null; readonly index: number }
    }
  | {
      readonly kind: 'batch'
      readonly items: readonly BatchItem[]
      /** 反映した企業の id(「分析を見る」に使う)。1 件も反映していなければ null */
      readonly companyId: string | null
    }

export interface ApplyOptions {
  /** 反映したあと、その企業の分析ページへ移るか */
  readonly open: boolean
}

/** 反映できたら true(企業の数が上限のときなどは false) */
type ApplyImport = (items: readonly AppliedItem[], options: ApplyOptions) => boolean

const LIMIT_MESSAGE =
  '取り込める企業の数が上限のため、読み込めませんでした。不要な企業を一覧から削除してから、もう一度お試しください。'

/** EDINET から取得した書類 1 件(zip のバイト列) */
export interface FetchedDocument {
  readonly fileName: string
  readonly bytes: Uint8Array
}

/** ファイルをドラッグしている最中か(文字列や要素のドラッグには反応しない) */
function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

function displayName(name: string): string {
  return cleanText(name, MAX_TEXT_LENGTH) ?? 'ファイル'
}

/**
 * ファイルの読み込み(選択・画面全体へのドロップ・EDINET から取得した書類)を扱う。
 * 問題なく読めたときは確認なしで onApply を呼び、取れない項目や食い違いがあるときだけ確認の状態にする。
 */
export function useImport(onApply: ApplyImport, enabled: boolean) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pickerButtonRef = useRef<HTMLButtonElement | null>(null)
  /** ファイルを選ぶボタンが見えない(折りたたまれている)ときに、フォーカスを戻す先 */
  const homeFocusRef = useRef<HTMLElement | null>(null)
  const latest = useRef(0)
  const onApplyRef = useRef(onApply)
  const [phase, setPhase] = useState<ImportPhase>({ kind: 'idle' })
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    onApplyRef.current = onApply
  })

  const handleFiles = useCallback(async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) {
      return
    }
    // 直前に始めた読み込みの結果が、このあとに反映されないよう、いつも番号を進める
    const ticket = latest.current + 1
    latest.current = ticket
    if (files.length > 1) {
      setPhase({ kind: 'error', fileName: '', message: '一度に読み込めるのは 1 ファイルです。' })
      return
    }
    const file = files[0]
    // ファイル名は外から来た文字列。表示を偽装できる文字を取り除いてから使う
    const fileName = displayName(file.name)
    setPhase({ kind: 'reading', fileName })
    try {
      // 取り込みのコードは、ファイルを選んだときに初めて読み込む
      const { runImport } = await import('../lib/import/runImport')
      const outcome = await runImport(file)
      if (ticket !== latest.current) {
        return
      }
      if (outcome.kind === 'error') {
        setPhase({ kind: 'error', fileName, message: outcome.message })
      } else if (outcome.company !== null && !outcome.result.needsReview) {
        const ok = onApplyRef.current([{ company: outcome.company, result: outcome.result, fileName }], { open: true })
        setPhase(ok ? { kind: 'idle' } : { kind: 'error', fileName, message: LIMIT_MESSAGE })
      } else {
        setPhase({ kind: 'review', fileName, result: outcome.result, company: outcome.company })
      }
    } catch {
      if (ticket === latest.current) {
        setPhase({ kind: 'error', fileName, message: '読み込み中に問題が起きました。もう一度お試しください。' })
      }
    }
  }, [])

  /**
   * EDINET から取得した書類を、まとめて取り込む(古い期から順に)。
   * 確認が要らないものはすべて反映する。確認が必要なもの・読めなかったものは、反映せずに一覧で知らせる。
   */
  const importDocuments = useCallback(async (documents: readonly FetchedDocument[]): Promise<void> => {
    if (documents.length === 0) {
      return
    }
    const ticket = latest.current + 1
    latest.current = ticket
    setPhase({ kind: 'reading', fileName: `${documents.length} 件の書類` })
    try {
      const { runImportBytes } = await import('../lib/import/runImport')
      if (ticket !== latest.current) {
        return
      }
      const applied: AppliedItem[] = []
      const items: BatchItem[] = []
      for (const doc of documents) {
        const fileName = displayName(doc.fileName)
        const outcome = runImportBytes(doc.bytes)
        if (outcome.kind === 'error') {
          items.push({ fileName, status: 'failed', message: outcome.message })
        } else if (outcome.company === null) {
          items.push({ fileName, status: 'failed', message: outcome.result.errors[0] ?? '読み込めませんでした。', result: outcome.result })
        } else if (outcome.result.needsReview) {
          items.push({ fileName, status: 'review', result: outcome.result, company: outcome.company })
        } else {
          applied.push({ company: outcome.company, result: outcome.result, fileName })
          items.push({ fileName, status: 'applied' })
        }
      }
      let problems = items.some((i) => i.status !== 'applied')
      let companyId: string | null = applied[0]?.company.id ?? null
      if (applied.length > 0 && !onApplyRef.current(applied, { open: !problems })) {
        // 反映できなかったものを、「読み込みました」と偽らない
        problems = true
        companyId = null
        items.forEach((item, i) => {
          if (item.status === 'applied') items[i] = { fileName: item.fileName, status: 'failed', message: LIMIT_MESSAGE }
        })
      }
      setPhase(problems ? { kind: 'batch', items, companyId } : { kind: 'idle' })
    } catch {
      if (ticket === latest.current) {
        setPhase({ kind: 'error', fileName: '', message: '書類の取り込み中に問題が起きました。もう一度お試しください。' })
      }
    }
  }, [])

  // 画面のどこにドロップしても読み込める(取り込みのページにいるときだけ)
  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    let depth = 0
    const enter = (e: DragEvent): void => {
      if (isFileDrag(e)) {
        depth += 1
        setDragging(true)
      }
    }
    const over = (e: DragEvent): void => {
      if (isFileDrag(e)) {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      }
    }
    const leave = (e: DragEvent): void => {
      if (isFileDrag(e)) {
        depth = Math.max(0, depth - 1)
        if (depth === 0) setDragging(false)
      }
    }
    const drop = (e: DragEvent): void => {
      if (isFileDrag(e)) {
        e.preventDefault()
        depth = 0
        setDragging(false)
        void handleFiles(e.dataTransfer?.files ?? null)
      }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
      // ドロップを受けつけないページに移るとき、ドラッグ中の表示が残らないようにする
      setDragging(false)
    }
  }, [handleFiles, enabled])

  const setInput = useCallback((el: HTMLInputElement | null): void => {
    inputRef.current = el
  }, [])

  const setPickerButton = useCallback((el: HTMLButtonElement | null): void => {
    pickerButtonRef.current = el
  }, [])

  const setHomeFocus = useCallback((el: HTMLElement | null): void => {
    homeFocusRef.current = el
  }, [])

  const openPicker = useCallback((): void => {
    inputRef.current?.click()
  }, [])

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      void handleFiles(e.target.files)
      // 同じファイルをもう一度選んでも読み込めるように、選択をリセットする
      e.target.value = ''
    },
    [handleFiles],
  )

  /** 確認の表示を閉じる。ボタンごと消えるので、キーボードの利用者が迷子にならないようフォーカスを戻す */
  const closeReview = useCallback((): void => {
    // まとめて取り込んだ一覧から開いた確認なら、その一覧に戻る
    if (phase.kind === 'review' && phase.returnTo !== undefined) {
      setPhase({ kind: 'batch', items: phase.returnTo.items, companyId: phase.returnTo.companyId })
      return
    }
    setPhase({ kind: 'idle' })
    // 折りたたまれたボタンには、フォーカスを移せない(見えているときだけ使う)
    const picker = pickerButtonRef.current
    const pickerVisible = picker !== null && picker.closest('details:not([open])') === null
    const target = pickerVisible ? picker : homeFocusRef.current
    target?.focus()
  }, [phase])

  const applyReview = useCallback((): void => {
    if (phase.kind !== 'review' || phase.company === null) {
      closeReview()
      return
    }
    const { returnTo } = phase
    // 一覧から開いた確認は、反映しても一覧に留まる(ほかの確認が必要な書類を続けて処理できるように)
    const ok = onApplyRef.current(
      [{ company: phase.company, result: phase.result, fileName: phase.fileName }],
      { open: returnTo === undefined },
    )
    if (!ok) {
      setPhase({ kind: 'error', fileName: phase.fileName, message: LIMIT_MESSAGE })
      return
    }
    if (returnTo !== undefined) {
      const items = returnTo.items.map((item, i): BatchItem =>
        i === returnTo.index ? { fileName: item.fileName, status: 'applied' } : item,
      )
      setPhase({ kind: 'batch', items, companyId: phase.company.id })
      return
    }
    closeReview()
  }, [phase, closeReview])

  /** まとめて取り込んだうち、確認が必要な 1 件を、確認の表示で開く */
  const reviewBatchItem = useCallback(
    (index: number): void => {
      if (phase.kind !== 'batch') return
      const item = phase.items[index]
      if (item?.status === 'review' && item.result !== undefined) {
        setPhase({
          kind: 'review',
          fileName: item.fileName,
          result: item.result,
          company: item.company ?? null,
          returnTo: { items: phase.items, companyId: phase.companyId, index },
        })
      }
    },
    [phase],
  )

  return {
    phase,
    dragging,
    setInput,
    setPickerButton,
    setHomeFocus,
    openPicker,
    onInputChange,
    closeReview,
    applyReview,
    importDocuments,
    reviewBatchItem,
  }
}

export type ImportController = ReturnType<typeof useImport>

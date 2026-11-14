import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import type { ImportLimits } from '../../domain/limits'

export type UnzipResult =
  | { readonly ok: true; readonly csv: Uint8Array; readonly name: string }
  | { readonly ok: false; readonly reason: string }

interface Candidate {
  readonly name: string
  readonly chunks: Uint8Array[]
  size: number
}

/**
 * zip を渡す 1 回あたりの大きさ(バイト)。
 * fflate は渡された入力を 1 回の呼び出しで最後まで展開してから結果を返すため、
 * zip 全体を一度に渡すと、上限を確認する前に巨大な展開が終わってしまう。
 * deflate の圧縮率は最大でも約 1000 倍なので、16KB ずつ渡せば 1 回の展開は約 16MB に収まる。
 */
const PUSH_SLICE_BYTES = 16 * 1024

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** 小さいほど優先。有価証券報告書(jpcrp…-asr)の CSV を最優先にする */
function rank(name: string): number {
  if (/jpcrp/i.test(name) && /asr/i.test(name)) return 0
  if (/jpcrp/i.test(name)) return 1
  return 2
}

/**
 * zip の中から CSV を取り出す。信頼できない入力なので、小さく区切って渡しながら
 * 展開後のバイト数を数え、上限を超えたらその場で中断する(zip の見出しに書かれた大きさは信用しない)。
 * CSV 以外のファイルは展開しない。候補が複数あっても、メモリに残すのは最も優先度の高い 1 つだけ。
 */
export function extractCsvFromZip(bytes: Uint8Array, limits: ImportLimits): UnzipResult {
  let best: Candidate | null = null
  let entryCount = 0
  let totalBytes = 0
  let failure: string | null = null

  const unzipper = new Unzip()
  unzipper.register(UnzipInflate)
  unzipper.register(UnzipPassThrough)
  unzipper.onfile = (file) => {
    entryCount += 1
    if (failure !== null) {
      return
    }
    if (entryCount > limits.maxZipEntries) {
      failure = 'zip の中のファイルが多すぎます。'
      return
    }
    if (!/\.csv$/i.test(file.name)) {
      return
    }
    // すでに、より優先度の高い候補がある CSV は、展開せずに飛ばす
    if (best !== null && rank(best.name) < rank(file.name)) {
      return
    }
    const candidate: Candidate = { name: file.name, chunks: [], size: 0 }
    file.ondata = (error, chunk, final) => {
      if (failure !== null) {
        return
      }
      if (error) {
        failure = 'zip の中のファイルを展開できませんでした。'
        return
      }
      candidate.size += chunk.length
      totalBytes += chunk.length
      if (candidate.size > limits.maxEntryBytes || totalBytes > limits.maxUnzippedBytes) {
        failure = '展開後のサイズが大きすぎるため、読み込みを中止しました。'
        return
      }
      candidate.chunks.push(chunk)
      if (final && (best === null || rank(candidate.name) < rank(best.name))) {
        best = candidate
      }
    }
    file.start()
  }

  try {
    for (let start = 0; start < bytes.length && failure === null; start += PUSH_SLICE_BYTES) {
      const end = Math.min(bytes.length, start + PUSH_SLICE_BYTES)
      unzipper.push(bytes.subarray(start, end), end === bytes.length)
    }
  } catch {
    return { ok: false, reason: 'zip を読み取れませんでした(ファイルが壊れている可能性があります)。' }
  }
  if (failure !== null) {
    return { ok: false, reason: failure }
  }
  if (best === null) {
    return {
      ok: false,
      reason:
        'zip の中に CSV が見つかりませんでした。EDINET の「CSV」(XBRL_TO_CSV を含む zip)を使ってください(XBRL・Excel は未対応です)。',
    }
  }
  const picked: Candidate = best
  return { ok: true, csv: concat(picked.chunks, picked.size), name: picked.name }
}

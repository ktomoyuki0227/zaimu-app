import { describe, expect, test } from 'vitest'
import { readBoundedBody } from './boundedBody.ts'

function responseOf(chunks: readonly Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(stream)
}

describe('readBoundedBody', () => {
  test('上限以内なら、チャンクをつなげた全体を返す', async () => {
    const bytes = await readBoundedBody(responseOf([Uint8Array.of(1, 2), Uint8Array.of(3)]), 10)
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3])
  })

  test('ちょうど上限の大きさなら、読める', async () => {
    const bytes = await readBoundedBody(responseOf([Uint8Array.of(1, 2, 3, 4)]), 4)
    expect(bytes?.length).toBe(4)
  })

  test('上限を超えたら、null を返して読むのを止める(長さを名乗らない応答でも守れる)', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(1_000))
        if (pulled > 1_000) controller.close()
      },
    })
    const result = await readBoundedBody(new Response(stream), 2_500)
    expect(result).toBeNull()
    // 上限を超えた時点で止まり、延々とは読み続けない
    expect(pulled).toBeLessThan(10)
  })

  test('本文が空の応答は、空のバイト列', async () => {
    const bytes = await readBoundedBody(new Response(null, { status: 204 }), 10)
    expect(bytes?.length).toBe(0)
  })
})

/**
 * 応答の本文を、上限までだけ読む。上限を超えたら、読むのを止めて null を返す。
 * Content-Length の無い応答や、嘘の長さを名乗る応答でも、メモリを使い切らないようにするため。
 */
export async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const body = response.body
  if (body === null) {
    return new Uint8Array()
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

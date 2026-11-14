/** BOM の無い UTF-16LE かどうか。日本語混じりでも、ASCII の文字の上位バイトは 0 になる */
function looksLikeUtf16le(bytes: Uint8Array): boolean {
  const sample = Math.min(bytes.length, 200) & ~1
  if (sample < 4) {
    return false
  }
  let zeroOnOdd = 0
  let zeroOnEven = 0
  for (let i = 0; i < sample; i += 2) {
    if (bytes[i] === 0) zeroOnEven += 1
    if (bytes[i + 1] === 0) zeroOnOdd += 1
  }
  return zeroOnOdd > sample / 4 && zeroOnEven === 0
}

/**
 * ファイルのバイト列を文字列にする。BOM と中身から UTF-16LE / UTF-16BE / UTF-8 を見分ける。
 * 読めない(UTF-8 として不正な)ときは null。
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeUtf8(bytes.subarray(3))
  }
  if (looksLikeUtf16le(bytes)) {
    return new TextDecoder('utf-16le').decode(bytes)
  }
  return decodeUtf8(bytes)
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

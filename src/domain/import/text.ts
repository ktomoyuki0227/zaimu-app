/**
 * ファイル由来の文字列(会社名・項目名・ファイル名など)を、画面に出せる形にする。
 * 制御文字・書式文字(右から左へ表示を切り替える文字、ゼロ幅文字、改行など)を取り除き、
 * 見た目の偽装を防ぐ。切り詰めは、サロゲートペアを壊さないよう文字単位で行う。
 * 空になったときは null。
 */
export function cleanText(value: string | undefined, maxLength: number): string | null {
  if (value === undefined) {
    return null
  }
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  if (cleaned === '') {
    return null
  }
  return Array.from(cleaned).slice(0, maxLength).join('')
}

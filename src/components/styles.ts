/** 画面で共通に使う、ボタン・リンク・入力欄の見た目(Tailwind のクラス)。タップしやすい高さ(44px)を確保している */
export const BUTTON_PRIMARY =
  'min-h-11 rounded-8 bg-blue-900 px-5 py-2 font-bold text-white hover:bg-blue-1000 active:bg-blue-1200 disabled:bg-solid-gray-420'

export const BUTTON_SECONDARY =
  'min-h-11 rounded-8 border border-blue-900 bg-white px-4 py-2 font-bold text-blue-900 hover:bg-blue-50 active:bg-blue-100'

/** 本文の文字と同じ太さのリンク(ボタン) */
export const LINK_PLAIN = 'text-blue-900 underline underline-offset-4 hover:text-blue-1000'

export const LINK = `font-bold ${LINK_PLAIN}`

export const FIELD = 'min-h-11 rounded-6 border border-solid-gray-536 bg-white px-3 py-2'

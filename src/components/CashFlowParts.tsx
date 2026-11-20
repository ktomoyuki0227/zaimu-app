import { signOf } from '../domain/cashFlow'

/** プラス・マイナスを、色だけでなく、言葉と記号でも伝える */
export function SignBadge({ value }: { readonly value: number | null }) {
  if (value === null) return <span className="text-solid-gray-700">数字なし</span>
  const sign = signOf(value)
  const text = sign === 'plus' ? '＋ 資金が入った' : sign === 'minus' ? '− 資金が出た' : '0 出入りなし'
  const style =
    sign === 'plus'
      ? 'border-green-800 bg-green-50 text-green-1100'
      : sign === 'minus'
        ? 'border-red-900 bg-red-50 text-red-1100'
        : 'border-solid-gray-420 bg-solid-gray-50 text-solid-gray-800'
  return (
    <span className={`inline-flex w-fit items-center rounded-6 border px-2 py-0.5 text-sm font-bold ${style}`}>{text}</span>
  )
}

import type { CashBridge } from '../domain/cashReconciliation'
import { amountUnitText, formatAmount, formatSignedAmount } from '../lib/format'
import { UnitNote } from './ui'

interface Props {
  readonly bridge: CashBridge | null
  readonly unit: string | undefined
}

/** 画面に出す金額の細かさ(小数 1 桁)。これより小さい差は、表に出しても「0」にしか見えない */
const DISPLAY_RESOLUTION = 0.05

interface Step {
  readonly label: string
  readonly value: string
  readonly note?: string
  /** 計算の締め(期首・期末)の行。太字にする */
  readonly strong?: boolean
}

function beginNote(bridge: CashBridge): string {
  return bridge.beginSource === 'previous'
    ? '前の期の期末残高'
    : '前の期の数字が無いので、期末残高から、書類の増減額を引いて割り出しました'
}

function steps(bridge: CashBridge): readonly Step[] {
  return [
    { label: '期首の現金及び現金同等物', value: formatAmount(bridge.begin), note: beginNote(bridge), strong: true },
    { label: '+ 営業活動によるキャッシュフロー', value: formatSignedAmount(bridge.operating) },
    { label: '+ 投資活動によるキャッシュフロー', value: formatSignedAmount(bridge.investing) },
    { label: '+ 財務活動によるキャッシュフロー', value: formatSignedAmount(bridge.financing) },
    {
      label: '+ 為替の影響',
      value: formatSignedAmount(bridge.fx),
      ...(bridge.fxReported ? {} : { note: '書類に記載がないので、0 として計算しました' }),
    },
    // 表の数字を足して、期末残高になるように、差があれば出す(合っている範囲の差は、丸めによるもの)
    ...(Math.abs(bridge.other) < DISPLAY_RESOLUTION
      ? []
      : [
          {
            label: bridge.matches ? '+ 丸めによる差' : '+ その他の増減(式の合わない分)',
            value: formatSignedAmount(bridge.other),
            note: bridge.matches
              ? '書類の金額の丸めによる、わずかな差'
              : '期末残高 − (期首残高 + 3 区分 + 為替の影響)',
          },
        ]),
    { label: '= 期末の現金及び現金同等物', value: formatAmount(bridge.end), strong: true },
  ]
}

/** 期末残高と、貸借対照表の現金預金の関係。現金預金が 0(読み取れなかった仮置きかもしれない)なら、比べない */
function balanceSheetNote(bridge: CashBridge): string | null {
  if (bridge.balanceSheetCash === 0) {
    return null
  }
  if (Math.abs(bridge.balanceSheetGap) <= bridge.tolerance) {
    return `貸借対照表の現金預金(${formatAmount(bridge.balanceSheetCash)})と同じです。`
  }
  return (
    `貸借対照表の現金預金は ${formatAmount(bridge.balanceSheetCash)} で、期末の現金及び現金同等物との差は ${formatSignedAmount(bridge.balanceSheetGap)} です。` +
    '現金同等物は、預入期間が 3 か月を超える定期預金を含まず、取得から 3 か月以内に満期の短期投資を含むなど、貸借対照表の現金預金と範囲が違うため、同じ数字にならないことがあります。'
  )
}

/** 突き合わせの結果の文章 */
function VerdictText({ bridge }: { readonly bridge: CashBridge }) {
  if (bridge.matches && bridge.beginSource === 'derived') {
    return (
      <>
        <h5 className="font-bold">確認: 書類の増減額と合っています</h5>
        <p className="mt-2 text-solid-gray-900">
          書類の「現金及び現金同等物の増減額」が、営業 + 投資 + 財務 + 為替の影響の合計と合っています。
          ただし、前の期の数字が無く、期首は期末残高から割り出した値なので、期首から期末までの流れは、独立には確かめられていません。
        </p>
      </>
    )
  }
  if (bridge.matches) {
    return (
      <>
        <h5 className="font-bold">確認: 現金の増減と合っています</h5>
        <p className="mt-2 text-solid-gray-900">
          「期首 + 営業 + 投資 + 財務 + 為替の影響 = 期末」の式が、書類の数字で成り立ちました(丸めによる数単位の差は許しています)。
          3 区分の数字は、現金の実際の増減と整合しています。
        </p>
      </>
    )
  }
  return (
    <>
      <h5 className="font-bold">注意: 式が合いません(差 {formatSignedAmount(bridge.other)})</h5>
      <p className="mt-2 text-solid-gray-900">
        期末の現金が、「期首 + 3 区分 + 為替の影響」より {formatAmount(Math.abs(bridge.other))}
        {bridge.other > 0 ? ' 多く' : ' 少なく'}なっています。
        連結の範囲の変更・合併・売却目的で保有する資産への振替などで、3 区分の外で現金が増減したときに出ます。
        書類の「現金及び現金同等物の増減」の注記や、キャッシュフロー計算書の欄外の行を確かめてください。
        {bridge.beginSource === 'derived'
          ? ' なお、期首は割り出した値なので、この差は、書類の増減額と、3 区分 + 為替の合計との差です。'
          : ''}
      </p>
    </>
  )
}

/** 選んだ期の、現金の増減との突き合わせ(期首 → 営業・投資・財務・為替 → 期末) */
export function CashBridgeView({ bridge, unit }: Props) {
  if (bridge === null) {
    return (
      <p className="mt-2 text-solid-gray-800">
        この期は、突き合わせに必要な数字(3 区分、期末の現金残高、期首の現金残高または増減額)が、そろっていません。
        古い保存データの場合は、書類をもう一度取り込むと、表示されます。
      </p>
    )
  }
  const note = balanceSheetNote(bridge)
  return (
    <div className="mt-2">
      <UnitNote>{amountUnitText(unit)}</UnitNote>
      <div className="relative overflow-x-auto">
        <table className="tnum w-full min-w-[26rem] border-collapse text-right">
          <caption className="sr-only">期首の現金から期末の現金までの流れ(プラスは増えた、マイナスは減った)</caption>
          <thead>
            <tr className="border-b-2 border-solid-gray-900">
              <th scope="col" className="py-2 pr-4 text-left">
                項目
              </th>
              <th scope="col" className="px-3 py-2">
                金額
              </th>
              <th scope="col" className="py-2 pl-3 text-left">
                補足
              </th>
            </tr>
          </thead>
          <tbody>
            {steps(bridge).map((step) => (
              <tr key={step.label} className={`border-b border-solid-gray-200 ${step.strong ? 'font-bold' : ''}`}>
                <th scope="row" className={`py-2 pr-4 text-left ${step.strong ? '' : 'font-normal'}`}>
                  {step.label}
                </th>
                <td className="px-3 py-2">{step.value}</td>
                <td className="py-2 pl-3 text-left text-sm font-normal text-solid-gray-700">{step.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className={`mt-4 rounded-8 border-l-8 p-4 sm:p-5 ${bridge.matches ? 'border-green-800 bg-green-50' : 'border-yellow-900 bg-yellow-50'}`}
      >
        <VerdictText bridge={bridge} />
      </div>
      {note === null ? null : <p className="mt-3 text-sm text-solid-gray-700">{note}</p>}
    </div>
  )
}

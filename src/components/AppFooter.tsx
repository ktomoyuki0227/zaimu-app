/** 全ページ共通の注意書きと、データの出典(公共データ利用規約 PDL1.0 の表示) */
export function AppFooter() {
  return (
    <footer className="border-t border-solid-gray-420">
      <p className="mx-auto max-w-[70rem] px-4 py-6 text-sm text-solid-gray-700 sm:px-6">
        学習用のツールです。投資や融資の判断を助言するものではありません。サンプルの会社は架空のものです。
      </p>
      <p className="mx-auto max-w-[70rem] px-4 pb-6 text-sm text-solid-gray-700 sm:px-6">
        EDINET から取得した財務データの出典: EDINET(金融庁)。公共データ利用規約(PDL1.0)に基づき、このツールで読み取り・計算・加工して表示しています(原文のままではありません)。
      </p>
    </footer>
  )
}

import type { DerivedStatements, PeriodData } from './types'

/** 入力から、合計値と段階利益を導出する(入力は変更しない) */
export function deriveStatements(period: PeriodData): DerivedStatements {
  const { bs, pl } = period

  const currentAssets =
    bs.cash + bs.receivables + bs.securities + bs.inventory + bs.otherCurrentAssets
  const quickAssets = bs.cash + bs.receivables + bs.securities
  const totalAssets = currentAssets + bs.fixedAssets

  const currentLiabilities = bs.payables + bs.shortTermDebt + bs.otherCurrentLiabilities
  const fixedLiabilities = bs.longTermDebt + bs.otherFixedLiabilities
  const totalLiabilities = currentLiabilities + fixedLiabilities
  const interestBearingDebt = bs.shortTermDebt + bs.longTermDebt

  const grossProfit = pl.sales - pl.costOfSales
  const operatingProfit = grossProfit - pl.sga
  const ordinaryProfit =
    operatingProfit + pl.nonOperatingIncome - pl.interestExpense - pl.otherNonOperatingExpense
  const preTaxProfit = ordinaryProfit + pl.extraordinaryGain - pl.extraordinaryLoss
  const netIncome = preTaxProfit - pl.incomeTaxes

  return {
    currentAssets,
    quickAssets,
    totalAssets,
    currentLiabilities,
    fixedLiabilities,
    totalLiabilities,
    interestBearingDebt,
    grossProfit,
    operatingProfit,
    ordinaryProfit,
    preTaxProfit,
    netIncome,
    balanceGap: totalAssets - (totalLiabilities + bs.equity),
  }
}

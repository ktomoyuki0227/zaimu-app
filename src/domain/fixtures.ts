import type { PeriodData } from './types'

/**
 * 手計算で検算しやすい基準データ。
 * 総資産 1000 / 純資産 500 / 有利子負債 300 / 売上 1000 / 営業利益 100 / 当期純利益 50
 */
export const basePeriod: PeriodData = {
  label: '基準期',
  bs: {
    cash: 100,
    receivables: 200,
    securities: 50,
    inventory: 150,
    otherCurrentAssets: 0,
    fixedAssets: 500,
    payables: 150,
    shortTermDebt: 100,
    otherCurrentLiabilities: 50,
    longTermDebt: 200,
    otherFixedLiabilities: 0,
    equity: 500,
  },
  pl: {
    sales: 1000,
    costOfSales: 600,
    sga: 300,
    nonOperatingIncome: 20,
    interestExpense: 10,
    otherNonOperatingExpense: 10,
    extraordinaryGain: 0,
    extraordinaryLoss: 10,
    incomeTaxes: 40,
    depreciation: 50,
  },
}

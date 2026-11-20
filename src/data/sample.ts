import type { BalanceSheetInput, Company, IncomeStatementInput, PeriodData } from '../domain/types'

/** 貸借が必ず一致するように、固定資産を「資産合計 - 流動資産」で決める */
function period(
  label: string,
  pl: IncomeStatementInput,
  bs: Omit<BalanceSheetInput, 'fixedAssets'>,
): PeriodData {
  const currentAssets =
    bs.cash + bs.receivables + bs.securities + bs.inventory + bs.otherCurrentAssets
  const liabilities =
    bs.payables +
    bs.shortTermDebt +
    bs.otherCurrentLiabilities +
    bs.longTermDebt +
    bs.otherFixedLiabilities
  const fixedAssets = bs.equity + liabilities - currentAssets
  return { label, pl, bs: { ...bs, fixedAssets } }
}

/**
 * 練習用の架空の会社(単位: 百万円)。
 * キャッシュフローは、現金の増減(貸借対照表の現金預金の差)と合うように作ってある(営業 + 投資 + 財務 = 現金の増減)。
 * 2024年3月期は「増収減益」、2025年3月期は「増収増益」になるように作ってあり、
 * 成長性ビューの見え方を確かめられる。
 */
export const SAMPLE_COMPANY: Company = {
  id: 'sample',
  name: 'サンプル製作所(架空)',
  unit: '百万円',
  periods: [
    period(
      '2021年3月期',
      {
        sales: 8000, costOfSales: 5600, sga: 1900,
        nonOperatingIncome: 40, interestExpense: 60, otherNonOperatingExpense: 20,
        extraordinaryGain: 0, extraordinaryLoss: 30, incomeTaxes: 130, depreciation: 250,
        operatingCashFlow: 520, investingCashFlow: -380, financingCashFlow: -190,
      },
      {
        cash: 900, receivables: 1500, securities: 100, inventory: 1000, otherCurrentAssets: 100,
        payables: 1100, shortTermDebt: 700, otherCurrentLiabilities: 300,
        longTermDebt: 2200, otherFixedLiabilities: 200, equity: 2500,
      },
    ),
    period(
      '2022年3月期',
      {
        sales: 8600, costOfSales: 5990, sga: 2010,
        nonOperatingIncome: 40, interestExpense: 55, otherNonOperatingExpense: 15,
        extraordinaryGain: 0, extraordinaryLoss: 10, incomeTaxes: 170, depreciation: 260,
        operatingCashFlow: 560, investingCashFlow: -310, financingCashFlow: -150,
      },
      {
        cash: 1000, receivables: 1600, securities: 100, inventory: 1050, otherCurrentAssets: 100,
        payables: 1150, shortTermDebt: 650, otherCurrentLiabilities: 320,
        longTermDebt: 2000, otherFixedLiabilities: 200, equity: 2800,
      },
    ),
    period(
      '2023年3月期',
      {
        sales: 9400, costOfSales: 6580, sga: 2150,
        nonOperatingIncome: 50, interestExpense: 50, otherNonOperatingExpense: 10,
        extraordinaryGain: 20, extraordinaryLoss: 0, incomeTaxes: 200, depreciation: 270,
        operatingCashFlow: 640, investingCashFlow: -330, financingCashFlow: -210,
      },
      {
        cash: 1100, receivables: 1750, securities: 100, inventory: 1150, otherCurrentAssets: 100,
        payables: 1250, shortTermDebt: 600, otherCurrentLiabilities: 340,
        longTermDebt: 1800, otherFixedLiabilities: 200, equity: 3150,
      },
    ),
    period(
      '2024年3月期',
      {
        sales: 9900, costOfSales: 7000, sga: 2300,
        nonOperatingIncome: 40, interestExpense: 45, otherNonOperatingExpense: 15,
        extraordinaryGain: 0, extraordinaryLoss: 60, incomeTaxes: 170, depreciation: 280,
        operatingCashFlow: 480, investingCashFlow: -360, financingCashFlow: -70,
      },
      {
        cash: 1150, receivables: 1850, securities: 100, inventory: 1300, otherCurrentAssets: 100,
        payables: 1350, shortTermDebt: 600, otherCurrentLiabilities: 350,
        longTermDebt: 1700, otherFixedLiabilities: 200, equity: 3500,
      },
    ),
    period(
      '2025年3月期',
      {
        sales: 11000, costOfSales: 7600, sga: 2450,
        nonOperatingIncome: 45, interestExpense: 40, otherNonOperatingExpense: 10,
        extraordinaryGain: 0, extraordinaryLoss: 0, incomeTaxes: 300, depreciation: 290,
        operatingCashFlow: 780, investingCashFlow: -300, financingCashFlow: -130,
      },
      {
        cash: 1500, receivables: 2000, securities: 100, inventory: 1350, otherCurrentAssets: 100,
        payables: 1450, shortTermDebt: 500, otherCurrentLiabilities: 400,
        longTermDebt: 1600, otherFixedLiabilities: 200, equity: 4000,
      },
    ),
  ],
}

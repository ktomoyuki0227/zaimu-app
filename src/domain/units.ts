import type { AmountUnit } from './types'

/** 金額の単位 1 つぶんが、何円か */
export const UNIT_DIVISOR: Readonly<Record<AmountUnit, number>> = {
  円: 1,
  千円: 1_000,
  百万円: 1_000_000,
}

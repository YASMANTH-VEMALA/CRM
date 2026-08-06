import type { PricingMethod } from "@/lib/types";

/**
 * Selling price for a product.
 *  FIXED             — the configured selling price is used as entered.
 *  COST_PLUS_MARGIN  — purchase cost plus the configured margin percentage.
 *
 * Rounded to whole currency units: TZS (the default currency) has no
 * sub-unit in practical pharmacy retail use.
 */
export function calculateSellPrice(
  method: PricingMethod,
  buyPrice: number,
  marginPercent: number,
  fixedPrice: number
): number {
  if (method === "cost_plus_margin") {
    return Math.round(buyPrice * (1 + marginPercent / 100));
  }
  return Math.round(fixedPrice);
}

/** Gross margin percentage actually realised at a given cost/price pair. */
export function effectiveMarginPercent(buyPrice: number, sellPrice: number): number {
  if (sellPrice <= 0) return 0;
  return ((sellPrice - buyPrice) / sellPrice) * 100;
}

/** Reorder quantity for a product below its minimum stock level. */
export function reorderQuantity(available: number, restockTarget: number): number {
  return Math.max(0, restockTarget - available);
}

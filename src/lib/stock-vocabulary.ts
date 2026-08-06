import type { StockInwardType, StockOutType } from "@/lib/types";

/**
 * Labels for the stock movement vocabulary. Kept free of `server-only` so the
 * client views and the server loaders can share one definition instead of
 * drifting apart.
 */

export const INWARD_TYPE_OPTIONS: Array<{ value: StockInwardType; label: string }> = [
  { value: "purchase_from_parent", label: "Purchase from parent company" },
  { value: "purchase_from_external", label: "Purchase from external supplier" },
  { value: "foc_or_sample", label: "Free of charge / sample" },
  { value: "replacement_in", label: "Replacement in" },
];

export const STOCK_OUT_TYPES: Array<{ value: StockOutType; label: string; description: string }> = [
  {
    value: "employee_consumption",
    label: "Employee consumption",
    description: "Stock used internally by a member of staff. Removes stock on approval.",
  },
  {
    value: "expired",
    label: "Expiry write-off",
    description: "Expired stock removed from the shelf. Removes stock on approval.",
  },
  {
    value: "damaged",
    label: "Damage write-off",
    description: "Damaged or otherwise unsellable stock. Removes stock on approval.",
  },
  {
    value: "supplier",
    label: "Supplier return",
    description: "Stock returned to the supplier for credit, refund or replacement.",
  },
  {
    value: "customer",
    label: "Customer return",
    description: "Stock returned by a customer. Adds stock back on approval.",
  },
];

export const MOVEMENT_LABELS: Record<string, string> = {
  opening_stock: "Opening stock",
  purchase: "Purchase",
  purchase_receipt: "Purchase (legacy GRN)",
  foc: "Free goods / FOC",
  replacement_in: "Replacement in",
  sale: "Sale",
  sale_reversal: "Sale reversal",
  employee_consumption: "Employee consumption",
  expiry: "Expiry write-off",
  damage: "Damage write-off",
  supplier_return: "Supplier return",
  stock_correction: "Stock correction",
  adjustment: "Adjustment (legacy)",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  return: "Customer return",
  disposal: "Disposal (legacy)",
  count_correction: "Count correction (legacy)",
};

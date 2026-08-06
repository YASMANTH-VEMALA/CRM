import type { Role } from "@/lib/permissions";

export type Branch = {
  id: string;
  name: string;
  code: string;
  registered_name: string | null;
  location: string | null;
  manager_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
};

export type Employee = {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  username: string | null;
  email: string | null;
  role: Role;
  branch_id: string | null;
  approval_limit: number | null;
  permission_overrides: Record<string, boolean>;
  max_discount_percent: number;
  status: "active" | "disabled";
  last_login_at: string | null;
  created_at: string;
};

export type Category = {
  id: string;
  code: string;
  name: string;
  type: "medicine" | "supplies";
  is_active: boolean;
  created_at: string;
};

export type Supplier = {
  id: string;
  branch_id: string;
  name: string;
  supplier_type: "parent" | "external";
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_id: string | null;
  registration_number: string | null;
  payment_terms: string | null;
  lead_time_days: number | null;
  is_active: boolean;
  created_at: string;
};

export type PricingMethod = "fixed" | "cost_plus_margin";

export type Product = {
  id: string;
  branch_id: string;
  sku: string;
  name: string;
  generic_name: string | null;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  category_id: string | null;
  supplier_id: string | null;
  buy_price: number;
  sell_price: number;
  pricing_method: PricingMethod;
  margin_percent: number;
  max_discount_percent: number;
  unit: string | null;
  barcode: string | null;
  image_url: string | null;
  status: "active" | "discontinued" | "quarantined";
  reorder_level: number;
  restock_target: number;
  created_at: string;
};

export type ProductPriceHistoryEntry = {
  id: string;
  product_id: string;
  branch_id: string;
  field: "buy_price" | "sell_price" | "margin_percent" | "pricing_method" | "max_discount_percent";
  previous_value: string | null;
  new_value: string | null;
  change_type: string;
  changed_by: string | null;
  reason: string | null;
  created_at: string;
};

export type ProductBatch = {
  id: string;
  product_id: string;
  batch_number: string;
  supplier_id: string | null;
  branch_id: string;
  quantity_received: number;
  quantity_available: number;
  unit_cost: number;
  expiry_date: string | null;
  storage_location: string | null;
  status: "active" | "quarantined" | "damaged" | "expired" | "negative";
  source_type: string | null;
  source_id: string | null;
  received_at: string;
};

export type Customer = {
  id: string;
  branch_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  segment: string | null;
  loyalty_points: number;
  credit_balance: number;
  created_at: string;
};

export type PaymentMethod = "Cash" | "Bank" | "M-Pesa" | "Selcom" | "Credit";

export type Sale = {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  cashier_id: string | null;
  branch_id: string;
  payment_method: PaymentMethod;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: "completed" | "returned" | "reversed";
  reversed_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  sold_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  batch_id: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  line_total: number;
};

export type PurchaseOrder = {
  id: string;
  po_number: string;
  supplier_id: string | null;
  created_by: string | null;
  branch_id: string;
  status: "draft" | "pending_approval" | "approved" | "partially_received" | "received" | "cancelled";
  expected_date: string | null;
  total: number;
  created_at: string;
};

export type PurchaseOrderItem = {
  id: string;
  po_id: string;
  product_id: string;
  quantity: number;
  unit_cost: number;
};

export type ReceivedOrder = {
  id: string;
  grn_number: string;
  po_id: string | null;
  branch_id: string;
  supplier_invoice_number: string | null;
  received_by: string | null;
  status: "partial" | "complete" | "variance";
  created_at: string;
};

export type ReceivedOrderItem = {
  id: string;
  grn_id: string;
  product_id: string;
  batch_id: string | null;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  damaged_qty: number;
};

export type StockOutType = "customer" | "supplier" | "damaged" | "expired" | "employee_consumption";

export type ReturnRecord = {
  id: string;
  reference: string;
  type: StockOutType;
  branch_id: string;
  original_sale_id: string | null;
  original_po_id: string | null;
  product_id: string | null;
  batch_id: string | null;
  quantity: number;
  reason: string | null;
  refund_method: string | null;
  resolution_type: "credit" | "refund" | "replacement" | null;
  consumed_by: string | null;
  evidence_url: string | null;
  expiry_date: string | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  status: "pending" | "approved" | "review" | "rejected" | "completed";
  created_at: string;
};

export type StockInwardType =
  | "purchase_from_parent"
  | "purchase_from_external"
  | "foc_or_sample"
  | "replacement_in";

export type StockInward = {
  id: string;
  reference: string;
  branch_id: string;
  supplier_id: string | null;
  inward_type: StockInwardType;
  invoice_number: string | null;
  invoice_date: string | null;
  supplier_return_id: string | null;
  document_url: string | null;
  notes: string | null;
  status: "draft" | "confirmed" | "cancelled";
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export type StockInwardItem = {
  id: string;
  inward_id: string;
  product_id: string;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
  free_quantity: number;
  unit_cost: number;
  batch_id: string | null;
};

export type OpeningStockEntry = {
  id: string;
  reference: string;
  branch_id: string;
  opening_date: string;
  notes: string | null;
  status: "draft" | "confirmed" | "cancelled";
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export type OpeningStockItem = {
  id: string;
  entry_id: string;
  product_id: string;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
  unit_cost: number;
  sell_price: number | null;
  batch_id: string | null;
};

export type ProductImport = {
  id: string;
  branch_id: string;
  filename: string;
  file_hash: string;
  kind: "products" | "opening_stock" | "stock_inward";
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  status: "committed" | "failed";
  error_report: Array<{ row: number; error: string }>;
  created_by: string | null;
  created_at: string;
};

export type DraftProduct = {
  id: string;
  branch_id: string;
  import_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_name: string | null;
  manufacturer: string | null;
  unit: string | null;
  supplier_name: string | null;
  buy_price: number;
  pricing_method: PricingMethod;
  margin_percent: number;
  sell_price: number;
  max_discount_percent: number;
  reorder_level: number;
  restock_target: number;
  image_url: string | null;
  duplicate_of: string | null;
  status: "pending" | "confirmed" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type ExpenseCategory = {
  id: string;
  name: string;
  is_active: boolean;
};

export type Expense = {
  id: string;
  reference: string;
  description: string | null;
  category_id: string | null;
  vendor: string | null;
  amount: number;
  payment_method: string | null;
  branch_id: string | null;
  created_by: string | null;
  status: "pending" | "approved";
  is_recurring: boolean;
  created_at: string;
};

export type StockMovementType =
  | "opening_stock"
  | "purchase"
  | "foc"
  | "replacement_in"
  | "sale"
  | "employee_consumption"
  | "expiry"
  | "damage"
  | "supplier_return"
  | "sale_reversal"
  | "stock_correction"
  // legacy vocabulary (pre-ERP rows, transfers, counts)
  | "purchase_receipt"
  | "adjustment"
  | "transfer_out"
  | "transfer_in"
  | "return"
  | "disposal"
  | "count_correction";

export type StockMovement = {
  id: string;
  product_id: string | null;
  batch_id: string | null;
  branch_id: string;
  movement_type: StockMovementType;
  quantity_delta: number;
  balance_after: number | null;
  reference_type: string | null;
  reference_id: string | null;
  reference_number: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type StockTransfer = {
  id: string;
  reference: string;
  product_id: string | null;
  batch_id: string | null;
  from_branch_id: string | null;
  to_branch_id: string | null;
  quantity: number;
  status: "pending" | "completed";
  created_by: string | null;
  created_at: string;
};

export type StockCount = {
  id: string;
  reference: string;
  branch_id: string | null;
  status: "open" | "completed";
  created_by: string | null;
  created_at: string;
};

export type StockCountItem = {
  id: string;
  stock_count_id: string;
  product_id: string | null;
  batch_id: string | null;
  expected_qty: number;
  counted_qty: number | null;
  variance: number;
};

export type ApprovalTask = {
  id: string;
  type: "purchase_order" | "discount" | "price_change" | "stock_adjustment" | "refund" | "supplier_return" | "disposal";
  reference_id: string | null;
  requested_by: string | null;
  branch_id: string | null;
  amount: number | null;
  description: string | null;
  status: "pending" | "review" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
};

export type AuditLog = {
  id: string;
  employee_id: string | null;
  action: string;
  module: string | null;
  record_reference: string | null;
  previous_value: string | null;
  new_value: string | null;
  reason: string | null;
  branch_id: string | null;
  session_ref: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  branch_id: string | null;
  is_read: boolean;
  created_at: string;
};

export type LoginHistoryEntry = {
  id: string;
  employee_id: string | null;
  device: string | null;
  ip_address: string | null;
  session_ref: string | null;
  status: string;
  created_at: string;
};

export type Setting = {
  id: string;
  branch_id: string | null;
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

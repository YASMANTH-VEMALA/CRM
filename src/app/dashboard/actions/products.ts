"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { permissionError, requireUser, type CurrentEmployee } from "@/lib/dal";
import { ENTITY_REQUIRED_ERROR, getActiveEntityId } from "@/lib/entity";
import { createClient } from "@/lib/supabase/server";
import { buildProductDocument, upsertEmbeddingBestEffort } from "@/lib/ai/embed";
import { calculateSellPrice } from "@/lib/pricing";
import type { ActionResult, PricingMethod } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const PRICE_FIELDS = [
  "buy_price",
  "sell_price",
  "margin_percent",
  "pricing_method",
  "max_discount_percent",
] as const;
type PriceField = (typeof PRICE_FIELDS)[number];

function revalidateProductPaths() {
  revalidatePath("/dashboard/products");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
}

type ProductFormValues = {
  sku: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  manufacturer: string | null;
  barcode: string | null;
  categoryId: string | null;
  supplierId: string | null;
  unit: string | null;
  imageUrl: string | null;
  buyPrice: number;
  pricingMethod: PricingMethod;
  marginPercent: number;
  fixedSellPrice: number;
  sellPrice: number;
  maxDiscountPercent: number;
  reorderLevel: number;
  restockTarget: number;
  status: "active" | "discontinued" | "quarantined";
};

function readProductForm(formData: FormData): ProductFormValues | { error: string } {
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const pricingMethodRaw = String(formData.get("pricing_method") ?? "fixed");
  const statusRaw = String(formData.get("status") ?? "active");

  if (!sku || !name) return { error: "SKU and product name are required." };
  if (pricingMethodRaw !== "fixed" && pricingMethodRaw !== "cost_plus_margin") {
    return { error: "Select a valid pricing method." };
  }
  if (statusRaw !== "active" && statusRaw !== "discontinued" && statusRaw !== "quarantined") {
    return { error: "Select a valid status." };
  }

  const buyPrice = Number(formData.get("buy_price") ?? 0);
  const marginPercent = Number(formData.get("margin_percent") ?? 0);
  const fixedSellPrice = Number(formData.get("sell_price") ?? 0);
  const maxDiscountPercent = Number(formData.get("max_discount_percent") ?? 0);
  const reorderLevel = Number(formData.get("reorder_level") ?? 0);
  const restockTarget = Number(formData.get("restock_target") ?? 0);

  if (buyPrice < 0 || fixedSellPrice < 0) return { error: "Prices cannot be negative." };
  if (marginPercent < 0) return { error: "Margin cannot be negative." };
  if (maxDiscountPercent < 0 || maxDiscountPercent > 100) {
    return { error: "Maximum discount must be between 0 and 100." };
  }
  if (reorderLevel < 0 || restockTarget < 0) return { error: "Stock levels cannot be negative." };
  if (restockTarget > 0 && restockTarget < reorderLevel) {
    return { error: "Restock target must be at least the minimum stock quantity." };
  }

  const pricingMethod = pricingMethodRaw as PricingMethod;
  const sellPrice = calculateSellPrice(pricingMethod, buyPrice, marginPercent, fixedSellPrice);
  if (sellPrice <= 0) return { error: "The selling price must be greater than zero." };

  const text = (key: string) => String(formData.get(key) ?? "").trim() || null;

  return {
    sku,
    name,
    genericName: text("generic_name"),
    strength: text("strength"),
    form: text("form"),
    manufacturer: text("manufacturer"),
    barcode: text("barcode"),
    categoryId: text("category_id"),
    supplierId: text("supplier_id"),
    unit: text("unit"),
    imageUrl: text("image_url"),
    buyPrice,
    pricingMethod,
    marginPercent,
    fixedSellPrice,
    sellPrice,
    maxDiscountPercent,
    reorderLevel,
    restockTarget,
    status: statusRaw,
  };
}

/** Writes one price-history row per changed price field. */
async function recordPriceHistory(
  supabase: SupabaseServerClient,
  employee: CurrentEmployee,
  productId: string,
  branchId: string,
  changeType: string,
  previous: Partial<Record<PriceField, unknown>>,
  next: Record<PriceField, unknown>,
  reason: string | null
): Promise<void> {
  const rows = PRICE_FIELDS.filter((field) => {
    const before = previous[field];
    return before === undefined ? true : String(before) !== String(next[field]);
  }).map((field) => ({
    product_id: productId,
    branch_id: branchId,
    field,
    previous_value: previous[field] === undefined ? null : String(previous[field]),
    new_value: String(next[field]),
    change_type: changeType,
    changed_by: employee.id,
    reason,
  }));

  if (rows.length > 0) {
    await supabase.from("product_price_history").insert(rows);
  }
}

export async function addProduct(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_products");
  if (denied) return denied;
  const branchId = await getActiveEntityId();
  if (!branchId) return { ok: false, error: ENTITY_REQUIRED_ERROR };

  const parsed = readProductForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("products")
    .insert({
      branch_id: branchId,
      sku: parsed.sku,
      name: parsed.name,
      generic_name: parsed.genericName,
      strength: parsed.strength,
      form: parsed.form,
      manufacturer: parsed.manufacturer,
      barcode: parsed.barcode,
      category_id: parsed.categoryId,
      supplier_id: parsed.supplierId,
      unit: parsed.unit,
      image_url: parsed.imageUrl,
      buy_price: parsed.buyPrice,
      sell_price: parsed.sellPrice,
      pricing_method: parsed.pricingMethod,
      margin_percent: parsed.marginPercent,
      max_discount_percent: parsed.maxDiscountPercent,
      reorder_level: parsed.reorderLevel,
      restock_target: parsed.restockTarget,
      status: parsed.status,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    return {
      ok: false,
      error: error?.message.includes("duplicate")
        ? "That SKU already exists in this entity."
        : error?.message ?? "Could not create product.",
    };
  }

  await recordPriceHistory(
    supabase,
    employee,
    inserted.id,
    branchId,
    "created",
    {},
    {
      buy_price: parsed.buyPrice,
      sell_price: parsed.sellPrice,
      margin_percent: parsed.marginPercent,
      pricing_method: parsed.pricingMethod,
      max_discount_percent: parsed.maxDiscountPercent,
    },
    null
  );

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Product created",
    module: "Products",
    record_reference: parsed.sku,
    new_value: JSON.stringify({ name: parsed.name, buy_price: parsed.buyPrice, sell_price: parsed.sellPrice }),
    branch_id: branchId,
  });

  // Best-effort — a failed embedding never blocks the product record itself.
  after(() =>
    upsertEmbeddingBestEffort(
      "products",
      inserted.id,
      buildProductDocument({
        name: parsed.name,
        generic_name: parsed.genericName,
        sku: parsed.sku,
        strength: parsed.strength,
        form: parsed.form,
        unit: parsed.unit,
        status: parsed.status,
      }),
      { name: parsed.name, sku: parsed.sku },
      branchId
    )
  );

  revalidateProductPaths();
  return { ok: true };
}

export async function updateProduct(_prevState: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "edit_products");
  if (denied) return denied;

  const productId = String(formData.get("product_id") ?? "");
  if (!productId) return { ok: false, error: "Select a product to edit." };

  const parsed = readProductForm(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("products")
    .select(
      "id, branch_id, sku, buy_price, sell_price, pricing_method, margin_percent, max_discount_percent"
    )
    .eq("id", productId)
    .maybeSingle();

  if (!existing) return { ok: false, error: "Product not found." };

  const reason = String(formData.get("reason") ?? "").trim() || null;

  const { error } = await supabase
    .from("products")
    .update({
      sku: parsed.sku,
      name: parsed.name,
      generic_name: parsed.genericName,
      strength: parsed.strength,
      form: parsed.form,
      manufacturer: parsed.manufacturer,
      barcode: parsed.barcode,
      category_id: parsed.categoryId,
      supplier_id: parsed.supplierId,
      unit: parsed.unit,
      image_url: parsed.imageUrl,
      buy_price: parsed.buyPrice,
      sell_price: parsed.sellPrice,
      pricing_method: parsed.pricingMethod,
      margin_percent: parsed.marginPercent,
      max_discount_percent: parsed.maxDiscountPercent,
      reorder_level: parsed.reorderLevel,
      restock_target: parsed.restockTarget,
      status: parsed.status,
    })
    .eq("id", productId);

  if (error) {
    return {
      ok: false,
      error: error.message.includes("duplicate")
        ? "That SKU already exists in this entity."
        : error.message,
    };
  }

  await recordPriceHistory(
    supabase,
    employee,
    productId,
    existing.branch_id,
    "edited",
    {
      buy_price: existing.buy_price,
      sell_price: existing.sell_price,
      margin_percent: existing.margin_percent,
      pricing_method: existing.pricing_method,
      max_discount_percent: existing.max_discount_percent,
    },
    {
      buy_price: parsed.buyPrice,
      sell_price: parsed.sellPrice,
      margin_percent: parsed.marginPercent,
      pricing_method: parsed.pricingMethod,
      max_discount_percent: parsed.maxDiscountPercent,
    },
    reason
  );

  await supabase.from("audit_logs").insert({
    employee_id: employee.id,
    action: "Product edited",
    module: "Products",
    record_reference: parsed.sku,
    previous_value: JSON.stringify({
      buy_price: existing.buy_price,
      sell_price: existing.sell_price,
    }),
    new_value: JSON.stringify({ buy_price: parsed.buyPrice, sell_price: parsed.sellPrice }),
    reason,
    branch_id: existing.branch_id,
  });

  after(() =>
    upsertEmbeddingBestEffort(
      "products",
      productId,
      buildProductDocument({
        name: parsed.name,
        generic_name: parsed.genericName,
        sku: parsed.sku,
        strength: parsed.strength,
        form: parsed.form,
        unit: parsed.unit,
        status: parsed.status,
      }),
      { name: parsed.name, sku: parsed.sku },
      existing.branch_id
    )
  );

  revalidateProductPaths();
  return { ok: true };
}

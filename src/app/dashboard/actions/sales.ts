"use server";

import { revalidatePath } from "next/cache";
import { permissionError, requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export type CartItem = {
  productId: string;
  batchId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
};

export type CompleteSalePayload = {
  items: CartItem[];
  customerId: string | null;
  paymentMethod: string;
  discount: number;
  /**
   * Idempotency key minted by the POS when the cart is created. A retry — a
   * double click, a flaky network, a resubmitted form — carries the same key
   * and returns the original sale instead of ringing it up twice.
   */
  requestKey?: string;
};

function revalidateSalesPaths() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/sales");
  revalidatePath("/dashboard/sales-history");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/customers");
}

// Postgres exceptions arrive as raw error messages; they are already written
// for end users in the erp_* functions, so pass them through as-is.
function rpcError(message: string | undefined, fallback: string): string {
  return message?.trim() || fallback;
}

export async function completeSale(
  payload: CompleteSalePayload
): Promise<ActionResult & { invoiceNumber?: string; duplicate?: boolean }> {
  const employee = await requireUser();
  const denied = permissionError(employee, "create_sales");
  if (denied) return denied;

  if (!payload.items || payload.items.length === 0) {
    return { ok: false, error: "Cart is empty." };
  }

  const supabase = await createClient();
  // Single transactional RPC: locks batches, validates stock, entity access,
  // discount limits (per user and per product), prices from the database,
  // writes sale + items + ledger, or rolls everything back.
  const { data, error } = await supabase.rpc("erp_complete_sale", {
    p: {
      customer_id: payload.customerId,
      payment_method: payload.paymentMethod,
      discount: payload.discount,
      request_key: payload.requestKey ?? null,
      items: payload.items.map((item) => ({
        product_id: item.productId,
        batch_id: item.batchId,
        quantity: item.quantity,
        discount: item.discount,
      })),
    },
  });

  if (error) {
    return { ok: false, error: rpcError(error.message, "Could not complete the sale.") };
  }

  revalidateSalesPaths();
  const result = data as { invoice_number?: string; duplicate?: boolean } | null;
  return { ok: true, invoiceNumber: result?.invoice_number, duplicate: result?.duplicate };
}

export async function reverseSale(saleId: string, reason?: string): Promise<ActionResult> {
  const employee = await requireUser();
  const denied = permissionError(employee, "cancel_sales");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("erp_reverse_sale", {
    p_sale_id: saleId,
    p_reason: reason ?? null,
  });

  if (error) {
    return { ok: false, error: rpcError(error.message, "Could not reverse the sale.") };
  }

  revalidateSalesPaths();
  return { ok: true };
}

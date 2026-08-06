import { createServiceClient } from "@/lib/supabase/service";
import { EMBEDDING_MODEL, getOpenAI } from "./openai";
import type { Customer, Product, Supplier } from "@/lib/types";
import { log } from "@/lib/logger";

export type SourceTable = "products" | "customers" | "suppliers";

export function buildProductDocument(
  product: Pick<Product, "name" | "generic_name" | "sku" | "strength" | "form" | "unit" | "status">,
  categoryName?: string | null,
  supplierName?: string | null
): string {
  return [
    `Product: ${product.name}`,
    product.generic_name && `Generic name: ${product.generic_name}`,
    `SKU: ${product.sku}`,
    product.strength && `Strength: ${product.strength}`,
    product.form && `Form: ${product.form}`,
    categoryName && `Category: ${categoryName}`,
    supplierName && `Supplier: ${supplierName}`,
    `Unit: ${product.unit ?? "—"}`,
    `Status: ${product.status}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// loyalty_points/credit_balance are deliberately omitted — those go stale in
// embedded text; retrieve.ts's hydrateExactFacts() re-fetches them live instead.
export function buildCustomerDocument(customer: Pick<Customer, "name" | "phone" | "address" | "segment">): string {
  return [
    `Customer: ${customer.name}`,
    customer.phone && `Phone: ${customer.phone}`,
    customer.address && `Address: ${customer.address}`,
    customer.segment && `Segment: ${customer.segment}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSupplierDocument(
  supplier: Pick<Supplier, "name" | "contact_name" | "phone" | "payment_terms" | "lead_time_days">
): string {
  return [
    `Supplier: ${supplier.name}`,
    supplier.contact_name && `Contact: ${supplier.contact_name}`,
    supplier.phone && `Phone: ${supplier.phone}`,
    supplier.payment_terms && `Payment terms: ${supplier.payment_terms}`,
    supplier.lead_time_days != null && `Lead time: ${supplier.lead_time_days} days`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { data } = await getOpenAI().embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  return data.map((d) => d.embedding);
}

export async function upsertEmbedding(
  sourceTable: SourceTable,
  sourceId: string,
  content: string,
  metadata: Record<string, unknown> = {},
  branchId: string | null = null
): Promise<void> {
  const [embedding] = await embedTexts([content]);
  // Cast needed: this project has no generated Database types, so the
  // untyped client resolves document_embeddings' row type to `never`.
  const { error } = await createServiceClient()
    .from("document_embeddings")
    .upsert(
      {
        source_table: sourceTable,
        source_id: sourceId,
        content,
        embedding,
        metadata,
        embedding_model: EMBEDDING_MODEL,
        branch_id: branchId,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "source_table,source_id" }
    );

  if (error) throw new Error(`upsertEmbedding failed (${sourceTable}/${sourceId}): ${error.message}`);
}

export async function upsertEmbeddingBestEffort(
  sourceTable: SourceTable,
  sourceId: string,
  content: string,
  metadata: Record<string, unknown> = {},
  branchId: string | null = null
): Promise<void> {
  try {
    await upsertEmbedding(sourceTable, sourceId, content, metadata, branchId);
  } catch (err) {
    log.error("ai.embedding_upsert_failed", err, { sourceTable, sourceId });
  }
}

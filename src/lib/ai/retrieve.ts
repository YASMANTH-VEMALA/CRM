import { createClient } from "@/lib/supabase/server";
import { buildCustomerDocument, buildProductDocument, buildSupplierDocument, embedTexts } from "./embed";
import type { SourceTable } from "./embed";
import type { Customer, Product, Supplier } from "@/lib/types";

export type RetrievedChunk = {
  id: string;
  sourceTable: SourceTable;
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

// The untyped Supabase client (no generated Database types in this project)
// resolves query results to `never`/mistyped shapes, same as every src/lib/data/*.ts
// loader — casting to the known runtime shape is this codebase's convention.
type MatchDocumentsRow = {
  id: string;
  source_table: SourceTable;
  source_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

type ProductRecordRow = {
  id: string;
  sku: string;
  name: string;
  generic_name: string | null;
  strength: string | null;
  form: string | null;
  unit: string | null;
  status: Product["status"];
  sell_price: number;
  reorder_level: number;
  categories: { name: string } | null;
  suppliers: { name: string } | null;
  product_batches: { quantity_available: number }[];
};

export async function semanticSearch(
  query: string,
  opts: { sourceTables?: SourceTable[]; matchCount?: number; matchThreshold?: number } = {}
): Promise<RetrievedChunk[]> {
  const [queryEmbedding] = await embedTexts([query]);
  if (!queryEmbedding) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_source_tables: opts.sourceTables ?? null,
    match_count: opts.matchCount ?? 8,
    match_threshold: opts.matchThreshold ?? 0.3,
  });

  if (error) throw new Error(`semanticSearch failed: ${error.message}`);

  const rows = (data ?? []) as unknown as MatchDocumentsRow[];
  return rows.map((row) => ({
    id: row.id,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    content: row.content,
    metadata: row.metadata ?? {},
    similarity: row.similarity,
  }));
}

// Deterministic DB re-fetch of the exact rows semantic search returned — no
// LLM/tool-call involved. Embedded text can be stale; these numbers can't be.
export async function hydrateExactFacts(chunks: RetrievedChunk[]): Promise<Map<string, Record<string, unknown>>> {
  const facts = new Map<string, Record<string, unknown>>();
  if (chunks.length === 0) return facts;

  const supabase = await createClient();
  const idsFor = (table: SourceTable) => chunks.filter((c) => c.sourceTable === table).map((c) => c.sourceId);

  const productIds = idsFor("products");
  if (productIds.length) {
    const { data } = await supabase
      .from("products")
      .select("id, sell_price, status, reorder_level, product_batches(quantity_available)")
      .in("id", productIds);
    for (const p of data ?? []) {
      const available = (p.product_batches ?? []).reduce(
        (sum: number, batch: { quantity_available: number }) => sum + batch.quantity_available,
        0
      );
      facts.set(`products:${p.id}`, {
        sell_price: p.sell_price,
        status: p.status,
        reorder_level: p.reorder_level,
        available_stock: available,
      });
    }
  }

  const customerIds = idsFor("customers");
  if (customerIds.length) {
    const { data } = await supabase.from("customers").select("id, loyalty_points, credit_balance").in("id", customerIds);
    for (const c of data ?? []) {
      facts.set(`customers:${c.id}`, { loyalty_points: c.loyalty_points, credit_balance: c.credit_balance });
    }
  }

  const supplierIds = idsFor("suppliers");
  if (supplierIds.length) {
    const { data } = await supabase.from("suppliers").select("id, is_active, lead_time_days").in("id", supplierIds);
    for (const s of data ?? []) {
      facts.set(`suppliers:${s.id}`, { is_active: s.is_active, lead_time_days: s.lead_time_days });
    }
  }

  return facts;
}

// For a record the user picked directly (a dropdown, not free text) — fetches
// live data and builds its context deterministically. No vector search
// involved, since a semantic query built from an instruction sentence
// ("summarize this record") would not reliably match the chosen record.
export async function fetchRecordContext(
  sourceTable: SourceTable,
  sourceId: string
): Promise<{ content: string; facts: Record<string, unknown> } | null> {
  const supabase = await createClient();

  if (sourceTable === "products") {
    const { data } = await supabase
      .from("products")
      .select(
        "id, sku, name, generic_name, strength, form, unit, status, sell_price, reorder_level, categories(name), suppliers(name), product_batches(quantity_available)"
      )
      .eq("id", sourceId)
      .maybeSingle();
    const product = data as unknown as ProductRecordRow | null;
    if (!product) return null;
    const available = (product.product_batches ?? []).reduce((sum, batch) => sum + batch.quantity_available, 0);
    return {
      content: buildProductDocument(product, product.categories?.name, product.suppliers?.name),
      facts: {
        sell_price: product.sell_price,
        status: product.status,
        reorder_level: product.reorder_level,
        available_stock: available,
      },
    };
  }

  if (sourceTable === "customers") {
    const { data } = await supabase.from("customers").select("*").eq("id", sourceId).maybeSingle();
    const customer = data as unknown as Customer | null;
    if (!customer) return null;
    return {
      content: buildCustomerDocument(customer),
      facts: { loyalty_points: customer.loyalty_points, credit_balance: customer.credit_balance },
    };
  }

  const { data } = await supabase.from("suppliers").select("*").eq("id", sourceId).maybeSingle();
  const supplier = data as unknown as Supplier | null;
  if (!supplier) return null;
  return {
    content: buildSupplierDocument(supplier),
    facts: { is_active: supplier.is_active, lead_time_days: supplier.lead_time_days },
  };
}

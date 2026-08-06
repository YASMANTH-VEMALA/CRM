// One-off maintenance script — embeds every existing product/customer/supplier
// row. The write-time hooks in the Server Actions only cover new/future
// writes, so this fills in whatever existed before the AI feature shipped.
// Run: npm run backfill:embeddings
process.loadEnvFile(".env.local");

import { createServiceClient } from "../src/lib/supabase/service";
import { buildCustomerDocument, buildProductDocument, buildSupplierDocument, upsertEmbedding } from "../src/lib/ai/embed";
import type { Customer, Product, Supplier } from "../src/lib/types";

// This project has no generated Database types, so the untyped Supabase
// client resolves query results to `never`/mistyped shapes — casting to the
// known runtime shape matches the convention used throughout src/lib/data/*.ts.
type ProductWithRelations = Pick<Product, "id" | "sku" | "name" | "generic_name" | "strength" | "form" | "unit" | "status"> & {
  categories: { name: string } | null;
  suppliers: { name: string } | null;
};

async function main() {
  const supabase = createServiceClient();

  const { data: productsData, error: productsError } = await supabase
    .from("products")
    .select("id, sku, name, generic_name, strength, form, unit, status, categories(name), suppliers(name)");
  if (productsError) throw new Error(`Failed to load products: ${productsError.message}`);
  const products = (productsData ?? []) as unknown as ProductWithRelations[];
  for (const product of products) {
    await upsertEmbedding(
      "products",
      product.id,
      buildProductDocument(product, product.categories?.name, product.suppliers?.name),
      { name: product.name, sku: product.sku, status: product.status }
    );
    console.log(`Embedded product ${product.sku} — ${product.name}`);
  }

  const { data: customersData, error: customersError } = await supabase.from("customers").select("*");
  if (customersError) throw new Error(`Failed to load customers: ${customersError.message}`);
  const customers = (customersData ?? []) as unknown as Customer[];
  for (const customer of customers) {
    await upsertEmbedding("customers", customer.id, buildCustomerDocument(customer), {
      name: customer.name,
      phone: customer.phone,
    });
    console.log(`Embedded customer ${customer.name}`);
  }

  const { data: suppliersData, error: suppliersError } = await supabase.from("suppliers").select("*");
  if (suppliersError) throw new Error(`Failed to load suppliers: ${suppliersError.message}`);
  const suppliers = (suppliersData ?? []) as unknown as Supplier[];
  for (const supplier of suppliers) {
    await upsertEmbedding("suppliers", supplier.id, buildSupplierDocument(supplier), { name: supplier.name });
    console.log(`Embedded supplier ${supplier.name}`);
  }

  console.log(`Backfill complete: ${products.length} products, ${customers.length} customers, ${suppliers.length} suppliers.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

# Pending migrations

Migrations in this folder are **written and reviewed but not applied**, and are
deliberately excluded from `npm run db:bundle` so that
`supabase/migrations/run_all.sql` always reflects the live schema.

To promote one: move it into `supabase/migrations/`, complete the application
changes it requires, run `npm run db:bundle`, then apply it.

---

## 0015_cost_column_privileges.sql — HIGH-1, purchase-cost concealment

**What it fixes.** Purchase cost is currently hidden only in the application
layer. The loaders correctly null `buy_price` / `unit_cost` for users without
`view_purchase_cost`, but the browser holds the anon key and the user's JWT, so
a sales user can read the real figures straight from PostgREST:

```
GET /rest/v1/products?select=buy_price          -> 1234
GET /rest/v1/product_batches?select=unit_cost   -> 1234
```

Both were confirmed against a live signed-in sales user during the audit.

**Why it is not applied yet.** It revokes `SELECT` on those two columns from
the `authenticated` role. Column privileges are role-wide — every signed-in
user is `authenticated` — so the revoke takes the columns away from *everyone*,
including entity admins who legitimately need them. Cost then has to come back
through the two gated views the migration creates (`product_costs`,
`batch_costs`), which means every query that currently reads those columns has
to be repointed first. Applying the migration without that refactor breaks the
app immediately.

**Required application changes before promoting.**

Both `products` and `product_batches` are queried with `select("*")` in places,
so those must become explicit column lists that exclude the cost column.

| File | Change |
|---|---|
| `src/lib/data/products.ts` | `select("*")` → explicit columns; cost from `product_costs` |
| `src/lib/data/inventory.ts` | `select("*")` on batches → explicit; cost from `batch_costs`; `:258` product cost |
| `src/lib/data/dashboard.ts` | `:101`, `:314` batch cost; `:146`, `:319` embedded `products(buy_price)` |
| `src/lib/data/branches.ts` | `:23` batch cost |
| `src/lib/data/categories.ts` | `:17` batch cost |
| `src/lib/data/entities.ts` | `:46` batch cost |
| `src/lib/data/analytics.ts` | `:35` embedded `products(buy_price)` |
| `src/lib/data/purchaseOrders.ts` | `:32` product cost |
| `src/lib/data/stockDocuments.ts` | `:76` product cost |
| `src/lib/reports/run.ts` | `:182`, `:520`, `:944`, `:1209` |
| `src/lib/ai/retrieve.ts` | `:85`, `:135` — drop `buy_price` from AI context entirely |

The five **embedded** selects (`products(... buy_price)` nested under
`sale_items`) are the awkward ones: PostgREST cannot embed a view, because
views carry no foreign keys. Those must fetch costs separately from
`product_costs` and merge by `product_id` in TypeScript.

Suggested shape — one helper, used everywhere:

```ts
// src/lib/data/costs.ts
export async function productCostMap(supabase, entityId): Promise<Map<string, number>>
export async function batchCostMap(supabase, entityId): Promise<Map<string, number>>
```

Both return an **empty map** for a user without `view_purchase_cost`, because
the view returns zero rows rather than a nulled column — there is nothing to
unmask. Call sites keep their existing `scope.canViewCost` checks; those become
a UI nicety rather than the security boundary.

**Not covered by this migration, and deliberately so.** `stock_inward_items`,
`opening_stock_items`, `purchase_order_items` and `received_order_items` also
carry `unit_cost`, but their RLS policies already require `view_inventory` plus
`create_stock_inward` / `view_purchase_cost` at the *row* level — a sales user
gets zero rows from all four (verified during the audit). `draft_products`
requires `import_products` or `create_products`. Only `products` and
`product_batches` are readable by a sales user, so only those two need
column-level treatment.

**Also included.** The migration tightens `price_history_select` so that
`product_price_history` rows recording a `buy_price` change need
`view_purchase_cost` — otherwise price history is a second route to the same
figure.

**Regression tests to add when promoting.** A `tests/db/cost-concealment.test.ts`
covering, with real signed-in users:

- a sales user selecting `buy_price` from `products` gets an error, not a value
- a sales user selecting `unit_cost` from `product_batches` gets an error
- a sales user reading `product_costs` / `batch_costs` gets zero rows
- an entity admin reads both views and gets the true figures
- an entity admin still sees only their own entity in both views
- a sales user cannot read `buy_price` history rows from `product_price_history`
- product create and edit still write `buy_price` correctly (writes are not revoked)

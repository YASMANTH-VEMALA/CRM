# Mars Pharmacy ERP — Database Schema & Security Model

**Platform:** Next.js 16 (App Router) + Supabase / PostgreSQL 15
**Schema:** `public` · 36 tables · 2 views · 97 RLS policies · 9 transactional RPCs
**Generated from the live database.** Regenerate the DDL with `npm run db:bundle`.

---

## Contents

1. [Core concepts](#1-core-concepts)
2. [Entity & access control](#2-entity--access-control)
3. [Product master](#3-product-master)
4. [Stock entry — opening stock, inward, purchasing](#4-stock-entry)
5. [Stock exit — sales and stock-out](#5-stock-exit)
6. [The inventory ledger](#6-the-inventory-ledger)
7. [Imports](#7-imports)
8. [Supporting tables](#8-supporting-tables)
9. [Enumerations](#9-enumerations)
10. [Security model](#10-security-model)
11. [Transactional RPCs](#11-transactional-rpcs)
12. [Migration order](#12-migration-order)

---

## 1. Core concepts

**Entity = pharmacy.** One row in `branches` is one independently operated pharmacy. The UI calls it an *Entity*; the column is `branch_id` everywhere. Every entity-owned table carries `branch_id NOT NULL`.

**Batch = physical lot.** Stock lives in `product_batches`, never on `products`. A batch carries its own cost, expiry and quantity, and links back to the document that created it via `source_type` / `source_id`.

**Ledger = truth.** Every stock change writes a row to `stock_movements` with `balance_after`. The ledger sums exactly to `product_batches.quantity_available`; that invariant is asserted in the test suite.

**Documents are draft → confirmed.** Stock entry documents are editable while `status = 'draft'`. Confirmation is an RPC that creates batches, writes the ledger and locks the document. Nothing moves stock before confirmation.

```
                    ┌──────────────┐
                    │   branches   │  (entity)
                    └──────┬───────┘
                           │ branch_id on everything below
      ┌────────────────────┼────────────────────┐
      │                    │                    │
 ┌────▼─────┐      ┌───────▼────────┐    ┌──────▼──────┐
 │ products │◀─────│ product_batches│───▶│  suppliers  │
 └────┬─────┘      └───────┬────────┘    └─────────────┘
      │                    │
      │            ┌───────▼─────────┐
      │            │ stock_movements │  append-only ledger
      │            └───────▲─────────┘
      │                    │
   ┌──┴────────────────────┴───────────────────────────┐
   │  opening_stock_entries · stock_inwards · sales    │
   │  returns · received_orders · stock_transfers      │
   └───────────────────────────────────────────────────┘
```

---

## 2. Entity & access control

### `branches` — the entity
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `code` | text NOT NULL | **UNIQUE** — e.g. `ENT-001` |
| `name` | text NOT NULL | |
| `registered_name`, `phone`, `email`, `address`, `location`, `manager_name` | text | |
| `currency` | text NOT NULL | default `TZS` |
| `timezone` | text NOT NULL | default `Africa/Dar_es_Salaam` |
| `is_active` | bool NOT NULL | default `true` |
| `created_at` | timestamptz NOT NULL | |

### `employees`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `auth_user_id` | uuid → `auth.users` | **UNIQUE (partial)** — one login ↔ one employee |
| `full_name` | text NOT NULL | |
| `username`, `email` | text | UNIQUE |
| `role` | text NOT NULL | `master_admin` \| `entity_admin` \| `inventory_user` \| `sales_user` |
| `branch_id` | uuid → `branches` | NULL only for master admins |
| `permission_overrides` | jsonb NOT NULL | `{"<permission>": true\|false}`, default `{}` |
| `max_discount_percent` | numeric NOT NULL | per-user discount ceiling |
| `approval_limit` | numeric | |
| `status` | text NOT NULL | `active` \| `disabled` |
| `last_login_at`, `created_at` | timestamptz | |

> Protected by two triggers — see [§10.4](#104-triggers).

### `role_permissions` — role templates
`role` + `permission`, composite PK. 53 rows = 4 roles × their permissions.

### `permission_catalog` — which permissions may be overridden
| Column | Type | Notes |
|---|---|---|
| `permission` | text PK | all 21 permissions |
| `overridable` | bool NOT NULL | `false` for `manage_users`, `manage_entities`, `access_multiple_entities` |

### `employee_entities` — extra entity access
`employee_id` + `branch_id`, composite PK. Grants access beyond the home branch. Master admins need no rows here.

### Permission vocabulary (21)

| Group | Permissions |
|---|---|
| Products | `view_products` `create_products` `edit_products` `import_products` |
| Inventory | `view_inventory` `adjust_inventory` `create_stock_inward` `create_stock_outward` `approve_stock_outward` |
| Purchasing | `view_purchase_cost` `manage_suppliers` |
| Sales | `create_sales` `apply_discount` `cancel_sales` |
| Management | `view_profit` `view_management_reports` `generate_exports` |
| Administration | `manage_users`* `manage_entities`* `manage_settings` `access_multiple_entities`* |

\* Master-tier — role-only, never grantable as an override.

### Role matrix

| Permission | master_admin | entity_admin | inventory_user | sales_user |
|---|:--:|:--:|:--:|:--:|
| view_products | ✅ | ✅ | ✅ | ✅ |
| create/edit/import products | ✅ | ✅ | ✅ | — |
| view_inventory | ✅ | ✅ | ✅ | ✅ |
| adjust_inventory | ✅ | ✅ | — | — |
| create_stock_inward | ✅ | ✅ | ✅ | — |
| create_stock_outward | ✅ | ✅ | ✅ | — |
| approve_stock_outward | ✅ | ✅ | — | — |
| **view_purchase_cost** | ✅ | ✅ | ✅ | **—** |
| manage_suppliers | ✅ | ✅ | ✅ | — |
| create_sales | ✅ | ✅ | — | ✅ |
| apply_discount | ✅ | ✅ | — | ✅ |
| cancel_sales | ✅ | ✅ | — | — |
| **view_profit** | ✅ | ✅ | — | **—** |
| view_management_reports | ✅ | ✅ | — | — |
| manage_users | ✅ | ✅ | — | — |
| manage_entities | ✅ | — | — | — |
| manage_settings | ✅ | ✅ | — | — |
| access_multiple_entities | ✅ | — | — | — |
| generate_exports | ✅ | ✅ | — | — |

---

## 3. Product master

### `products`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `branch_id` | uuid NOT NULL → `branches` | |
| `sku` | text NOT NULL | **UNIQUE (branch_id, sku)** — per entity, not global |
| `name` | text NOT NULL | |
| `generic_name`, `strength`, `form`, `unit`, `barcode`, `manufacturer`, `image_url` | text | |
| `category_id` → `categories`, `supplier_id` → `suppliers` | uuid | |
| `buy_price` | numeric NOT NULL | 🔒 **SELECT revoked from `authenticated`** |
| `sell_price` | numeric NOT NULL | |
| `pricing_method` | text NOT NULL | `fixed` \| `cost_plus_margin` |
| `margin_percent` | numeric NOT NULL | used when `cost_plus_margin` |
| `max_discount_percent` | numeric NOT NULL | per-product discount ceiling |
| `reorder_level` | int NOT NULL | minimum stock |
| `restock_target` | int NOT NULL | reorder-to level |
| `status` | text NOT NULL | `active` \| `discontinued` \| `quarantined` |

### `product_batches` — physical stock
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `product_id` | uuid NOT NULL → `products` | |
| `branch_id` | uuid NOT NULL → `branches` | |
| `batch_number` | text NOT NULL | |
| `supplier_id` | uuid → `suppliers` | |
| `quantity_received` | int NOT NULL | |
| `quantity_available` | int NOT NULL | 🔒 **UPDATE revoked** — ledger-derived |
| `unit_cost` | numeric NOT NULL | 🔒 **SELECT revoked from `authenticated`** |
| `expiry_date` | date | |
| `storage_location` | text | |
| `status` | text NOT NULL | `active` \| `quarantined` \| `damaged` \| `expired` \| `negative` |
| `source_type`, `source_id` | text, uuid | the document that created this batch |
| `received_at` | timestamptz NOT NULL | |

### `product_price_history`
`product_id`, `branch_id`, `field` (`buy_price` \| `sell_price` \| `margin_percent` \| `pricing_method` \| `max_discount_percent`), `previous_value`, `new_value`, `change_type`, `changed_by`, `reason`, `created_at`.

> Rows where `field = 'buy_price'` require `view_purchase_cost` to read.

### `suppliers`
`branch_id NOT NULL`, `name NOT NULL`, `supplier_type` (`parent` \| `external`), `contact_name`, `phone`, `email`, `address`, `tax_id`, `registration_number`, `payment_terms`, `lead_time_days`, `is_active`.

### `categories` / `expense_categories`
Shared reference data — **not** entity-scoped. `categories`: `code` UNIQUE, `name`, `type` (`medicine` \| `supplies`), `is_active`.

---

## 4. Stock entry

All three follow **draft → confirm**.

### `opening_stock_entries` → `opening_stock_items`

| `opening_stock_entries` | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `reference` | text NOT NULL | UNIQUE |
| `branch_id` | uuid NOT NULL | |
| `opening_date` | date NOT NULL | default today |
| `notes` | text | |
| `status` | text NOT NULL | `draft` \| `confirmed` \| `cancelled` |
| `created_by`, `confirmed_by` | uuid → `employees` | |
| `confirmed_at`, `created_at` | timestamptz | |

| `opening_stock_items` | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `entry_id` | uuid NOT NULL → `opening_stock_entries` | ON DELETE CASCADE |
| `product_id` | uuid NOT NULL → `products` | |
| `batch_number` | text NOT NULL | |
| `expiry_date` | date | |
| `quantity` | int NOT NULL | **CHECK > 0** |
| `unit_cost` | numeric NOT NULL | |
| `sell_price` | numeric | optional price set at opening |
| `batch_id` | uuid → `product_batches` | filled on confirmation |

**Confirm:** `erp_confirm_opening_stock(p_id)` → creates one batch per line, posts `opening_stock` movements, locks the entry.

### `stock_inwards` → `stock_inward_items`

| `stock_inwards` | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `reference` | text NOT NULL | UNIQUE |
| `branch_id` | uuid NOT NULL | |
| `supplier_id` | uuid → `suppliers` | must be same entity |
| `inward_type` | text NOT NULL | `purchase_from_parent` \| `purchase_from_external` \| `foc_or_sample` \| `replacement_in` |
| `invoice_number`, `invoice_date` | text, date | UNIQUE per (branch, supplier, invoice) while not cancelled |
| `supplier_return_id` | uuid → `returns` | links a replacement to its return |
| `document_url`, `notes` | text | |
| `status` | text NOT NULL | `draft` \| `confirmed` \| `cancelled` |
| `created_by`, `confirmed_by`, `confirmed_at`, `created_at` | | |

| `stock_inward_items` | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `inward_id` | uuid NOT NULL → `stock_inwards` | ON DELETE CASCADE |
| `product_id` | uuid NOT NULL → `products` | must be same entity |
| `batch_number` | text NOT NULL | |
| `expiry_date` | date | |
| `quantity` | int NOT NULL | CHECK ≥ 0 |
| `free_quantity` | int NOT NULL | CHECK ≥ 0 — FOC units on a paid line |
| `unit_cost` | numeric NOT NULL | |
| `batch_id` | uuid → `product_batches` | filled on confirmation |
| | | **CHECK (quantity + free_quantity > 0)** |

**Confirm:** `erp_confirm_stock_inward(p_id)`. Paid units post as `purchase` / `replacement_in`; free units always post as a **separate `foc` movement**, so free goods stay identifiable in the ledger.

### Purchasing: `purchase_orders` → `received_orders`

`purchase_orders`: `po_number` UNIQUE, `supplier_id`, `branch_id NOT NULL`, `status` (`draft` → `pending_approval` → `approved` → `partially_received` → `received` \| `cancelled`), `expected_date`, `total`.
`purchase_order_items`: `po_id`, `product_id`, `quantity`, `unit_cost`.

`received_orders` (GRN): `grn_number` UNIQUE, `po_id`, `branch_id NOT NULL`, `supplier_invoice_number`, `received_by`, `status` (`partial` \| `complete` \| `variance`).
`received_order_items`: `grn_id`, `product_id`, `batch_id`, `quantity_ordered`, `quantity_received`, `unit_cost`, `damaged_qty`.

**Receive:** `erp_receive_purchase_order(p_po_id, p_supplier_invoice, p_lines)`.

---

## 5. Stock exit

### `sales` → `sale_items`

| `sales` | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `invoice_number` | text NOT NULL | UNIQUE |
| `branch_id` | uuid NOT NULL | |
| `customer_id` | uuid → `customers` | must be same entity |
| `cashier_id` | uuid → `employees` | |
| `payment_method` | text NOT NULL | `Cash` \| `Bank` \| `M-Pesa` \| `Selcom` \| `Credit` |
| `subtotal`, `discount`, `tax`, `total` | numeric NOT NULL | prices always derived server-side |
| `status` | text NOT NULL | `completed` \| `returned` \| `reversed` |
| `sold_at` | timestamptz NOT NULL | |
| `reversed_by`, `reversed_at`, `reversal_reason` | | |
| `request_key` | text | **UNIQUE (branch_id, request_key)** — idempotency |

`sale_items`: `sale_id`, `product_id`, `batch_id`, `quantity`, `unit_price`, `discount`, `line_total`. No UPDATE/DELETE policy — immutable.

**Complete:** `erp_complete_sale(p jsonb)` · **Reverse:** `erp_reverse_sale(p_sale_id, p_reason)` — never deletes, posts `sale_reversal` movements.

### `returns` — every stock-out document

One table serves customer returns, supplier returns, write-offs and staff consumption.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `reference` | text NOT NULL | UNIQUE |
| `type` | text NOT NULL | `customer` \| `supplier` \| `damaged` \| `expired` \| `employee_consumption` |
| `branch_id` | uuid NOT NULL | |
| `product_id`, `batch_id` | uuid | must both be in `branch_id` |
| `quantity` | int NOT NULL | |
| `reason` | text | |
| `status` | text NOT NULL | `pending` \| `approved` \| `review` \| `rejected` \| `completed` |
| `resolution_type` | text | `credit` \| `refund` \| `replacement` |
| `consumed_by` | uuid → `employees` | for staff consumption |
| `evidence_url`, `expiry_date`, `refund_method` | | |
| `original_sale_id`, `original_po_id` | uuid | |
| `requested_by`, `approved_by`, `approved_at` | | |

**Approve:** `erp_approve_stock_out(p_return_id)` — `customer` adds stock back, every other type removes it.

### `stock_transfers`
`reference` UNIQUE, `product_id`, `batch_id`, `from_branch_id`, `to_branch_id`, `quantity`, `status`, `created_by`.
**Transfer:** `erp_transfer_stock(p_batch_id, p_to_branch, p_quantity)` — posts both `transfer_out` and `transfer_in` legs atomically.

---

## 6. The inventory ledger

### `stock_movements` — append-only
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `product_id`, `batch_id` | uuid | |
| `branch_id` | uuid NOT NULL | |
| `movement_type` | text NOT NULL | see below |
| `quantity_delta` | int NOT NULL | signed |
| `balance_after` | int | running balance for that batch |
| `reference_type`, `reference_id`, `reference_number` | | back-link to the source document |
| `reason` | text | |
| `created_by` | uuid → `employees` | |
| `created_at` | timestamptz NOT NULL | |

🔒 **SELECT only.** No INSERT/UPDATE/DELETE policy *and* the privileges are revoked from `authenticated`. The single writer is `fn_post_movement`, which is revoked from every client role and callable only from inside an `erp_*` RPC.

### The stock equation

```
closing stock = opening_stock
              + purchase + foc + replacement_in + transfer_in
              − sale − employee_consumption − expiry − damage
              − supplier_return − transfer_out
              + sale_reversal
              ± stock_correction
```

Verified by test: the ledger sums exactly to `product_batches.quantity_available`, and `balance_after` forms an unbroken chain.

**Movement types**

| Phase 1 vocabulary | Legacy (pre-existing rows) |
|---|---|
| `opening_stock` `purchase` `foc` `replacement_in` `sale` `employee_consumption` `expiry` `damage` `supplier_return` `sale_reversal` `stock_correction` `transfer_in` `transfer_out` | `purchase_receipt` `adjustment` `return` `disposal` `count_correction` |

---

## 7. Imports

### `product_imports`
`branch_id`, `filename`, `file_hash`, `kind` (`products` \| `opening_stock` \| `stock_inward`), `total_rows`, `valid_rows`, `invalid_rows`, `status`, `error_report jsonb`, `created_by`.
**UNIQUE (branch_id, kind, file_hash)** — the same file cannot be imported twice into one entity, regardless of filename.

### `draft_products`
Staging area. An import never creates sellable products directly: rows land here as `pending` and become real products only when a user with `create_products` confirms them. Carries the full product shape plus `import_id`, `duplicate_of`, `status` (`pending` \| `confirmed` \| `rejected`), `reviewed_by`, `reviewed_at`.

**Limits:** 5 MB file, 5 000 rows, `.xlsx` / `.csv` only. Rows are re-validated and sell price recomputed at commit, because the payload round-trips through the browser.
**Commit:** `erp_commit_product_import(...)` — import record + drafts + audit entry in one transaction.

---

## 8. Supporting tables

| Table | Purpose |
|---|---|
| `customers` | `branch_id NOT NULL`, `name`, `phone`, `address`, `segment`, `loyalty_points`, `credit_balance` |
| `expenses` | `reference` UNIQUE, `category_id`, `vendor`, `amount`, `payment_method`, `branch_id`, `status` |
| `audit_logs` | `employee_id`, `action`, `module`, `record_reference`, `previous_value`, `new_value`, `reason`, `branch_id` |
| `login_history` | `employee_id`, `device`, `ip_address`, `session_ref`, `status` |
| `notifications` | `type`, `title`, `message`, `is_read`, `branch_id` (NULL = global) |
| `settings` | `branch_id` (NULL = global), `key`, `value jsonb`, **UNIQUE (branch_id, key)** |
| `approval_tasks` | `type`, `reference_id`, `requested_by`, `branch_id`, `amount`, `status` |
| `stock_counts` / `stock_count_items` | Physical count sheets; `variance` is a generated column |
| `document_embeddings` | AI retrieval — `source_table`, `source_id`, `embedding vector`, `branch_id` |

### Document number sequences
`doc_seq_sale` `doc_seq_inward` `doc_seq_opening` `doc_seq_return` `doc_seq_correction` `doc_seq_import`, issued by `next_doc_number(prefix, seq)` → `INV-2026-000123`. Collision-proof under concurrency.

---

## 9. Enumerations

| Table.column | Allowed values |
|---|---|
| `employees.role` | `master_admin` `entity_admin` `inventory_user` `sales_user` |
| `employees.status` | `active` `disabled` |
| `products.status` | `active` `discontinued` `quarantined` |
| `products.pricing_method` | `fixed` `cost_plus_margin` |
| `product_batches.status` | `active` `quarantined` `damaged` `expired` `negative` |
| `suppliers.supplier_type` | `parent` `external` |
| `stock_inwards.inward_type` | `purchase_from_parent` `purchase_from_external` `foc_or_sample` `replacement_in` |
| `stock_inwards.status`, `opening_stock_entries.status` | `draft` `confirmed` `cancelled` |
| `returns.type` | `customer` `supplier` `damaged` `expired` `employee_consumption` |
| `returns.status` | `pending` `approved` `review` `rejected` `completed` |
| `returns.resolution_type` | `credit` `refund` `replacement` |
| `sales.status` | `completed` `returned` `reversed` |
| `sales.payment_method` | `Cash` `Bank` `M-Pesa` `Selcom` `Credit` |
| `purchase_orders.status` | `draft` `pending_approval` `approved` `partially_received` `received` `cancelled` |
| `received_orders.status` | `partial` `complete` `variance` |
| `draft_products.status` | `pending` `confirmed` `rejected` |
| `product_imports.kind` | `products` `opening_stock` `stock_inward` |
| `categories.type` | `medicine` `supplies` |

---

## 10. Security model

The browser holds both the anon key and the user's JWT, so **nothing in the client is a security control**. Every rule is enforced in Postgres.

```
Browser (hostile)  ──▶  Server Actions        ──┐
                   ──▶  Direct PostgREST      ──┤  ← the real threat model
                                                ▼
   LAYER 1  Column privileges   buy_price / unit_cost not selectable
   LAYER 2  RLS · 97 policies   has_entity_access() AND has_perm()
   LAYER 3  Permission resolution  role + overrides + catalogue
   LAYER 4  Transactional RPCs  permission → entity → consistency → lock
   TRIGGERS Fire on every path, service role included
```

### 10.1 Column privileges
`authenticated` has **no SELECT** on `products.buy_price` or `product_batches.unit_cost`, and **no UPDATE** on `product_batches.quantity_available`. Cost is reachable only through two views:

```sql
create view product_costs with (security_invoker = false) as
select p.id as product_id, p.branch_id, p.buy_price
from products p
where has_entity_access(p.branch_id)
  and has_perm('view_purchase_cost');
```

`batch_costs` is the same shape for `product_batches.unit_cost`. A user without the permission gets **zero rows**, not a nulled column.

> Column privileges are role-wide, so the pattern is *revoke table SELECT, then grant back the permitted columns*. `fn_grant_readable_columns(table, exclude[])` does this and should be re-run after adding a column to either table.

### 10.2 RLS
Enabled on **36/36** tables, 97 policies. Every policy is composed from `has_entity_access(branch_id)` and `has_perm('…')`.

Read-only by design: `stock_movements` (SELECT only) and `document_embeddings` (SELECT only).

### 10.3 Permission resolution

```sql
create function has_perm(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when e.permission_overrides ? p
       and coalesce((select pc.overridable from permission_catalog pc
                     where pc.permission = p), false)
      then (e.permission_overrides ->> p)::boolean
      else exists (select 1 from role_permissions rp
                   where rp.role = e.role and rp.permission = p)
    end
    from employees e
    where e.auth_user_id = auth.uid() and e.status = 'active'
    limit 1
  ), false)
$$;
```

`has_entity_access(uuid)` returns true for a master admin, or when the branch is the employee's own or granted via `employee_entities`. **`has_entity_access(NULL)` returns false** — null is not a wildcard.

Helper functions callable by `authenticated`: `has_perm`, `has_entity_access`, `is_master`, `auth_employee_id`, `next_doc_number`, `fn_path_entity`.
Revoked from all client roles: `fn_post_movement`, `fn_current_employee`, `fn_employees_guard`, `fn_protect_last_master`, `fn_grant_readable_columns`.

### 10.4 Triggers

**`employees_guard`** (BEFORE INSERT OR UPDATE) —
1. Rejects non-overridable and unknown `permission_overrides` keys, and non-boolean values, on **every** path including service role.
2. **Nobody may change privilege-bearing columns on their own row**, whatever permissions they hold (`role`, `permission_overrides`, `max_discount_percent`, `branch_id`, `approval_limit`, `status`).
3. Non-master privilege writes must satisfy `has_entity_access` on both the old and the new branch.
4. Only a master admin may grant `master_admin` or change `auth_user_id`.

**`employees_protect_last_master`** (BEFORE UPDATE) — the last active master admin cannot be disabled or demoted.

### 10.5 Storage
Buckets `product-images` and `stock-documents`: **private**, 10 MB cap, MIME allowlist (PNG/JPEG/WebP/GIF/PDF). Read, write and delete are confined to a `<branch_id>/…` path prefix the caller can access.

### 10.6 What is enforced where

| Rule | Enforced by |
|---|---|
| Entity A cannot read/write Entity B | RLS on every table |
| Sales user cannot see purchase cost | Column privileges + gated views |
| Ledger cannot be forged | INSERT revoked + RPC-only writes |
| Stock cannot go negative | `fn_post_movement` under row lock |
| Discounts within user and product ceilings | `erp_complete_sale` |
| No self-privilege escalation | `employees_guard` trigger |
| Master permissions not grantable by override | `permission_catalog` + trigger + `has_perm` |
| Documents cannot be confirmed twice | `SELECT … FOR UPDATE` + status check |
| Duplicate sale submission | `UNIQUE (branch_id, request_key)` |
| Duplicate file import | `UNIQUE (branch_id, kind, file_hash)` |

---

## 11. Transactional RPCs

All nine are `SECURITY DEFINER`, pinned `search_path`, granted to `authenticated` only, and either commit whole or roll back whole.

| Function | Signature | Does |
|---|---|---|
| `erp_complete_sale` | `(p jsonb)` | Locks batches, validates stock/entity/discount, prices from DB, writes sale + items + ledger. Idempotent via `request_key`. |
| `erp_reverse_sale` | `(p_sale_id, p_reason)` | Posts `sale_reversal` movements; never deletes. |
| `erp_confirm_opening_stock` | `(p_id)` | Creates batches + `opening_stock` movements, locks the entry. |
| `erp_confirm_stock_inward` | `(p_id)` | Creates batches, posts paid + FOC movements separately. |
| `erp_approve_stock_out` | `(p_return_id)` | Validates batch/product belong to the document's entity, posts the movement. |
| `erp_stock_correction` | `(p_batch_id, p_new_qty, p_reason)` | Privileged quantity fix; reason mandatory. |
| `erp_transfer_stock` | `(p_batch_id, p_to_branch, p_quantity)` | Both ledger legs atomically. |
| `erp_receive_purchase_order` | `(p_po_id, p_supplier_invoice, p_lines)` | GRN + batches + ledger, rolls the PO forward. |
| `erp_commit_product_import` | `(branch, filename, hash, …, drafts)` | Import record + drafts + audit in one transaction. |

**Common validation order:** permission → entity access → document status → branch consistency (batch/product/supplier all in the document's entity) → business rules → row locks → ledger → commit.

---

## 12. Migration order

Order is load-bearing — `0002` installs permissive bootstrap policies that `0007` replaces.

| # | File | Purpose |
|---|---|---|
| 0001 | `schema.sql` | Core tables |
| 0002 | `rls.sql` | Bootstrap RLS (superseded by 0007) |
| 0003 | `seed.sql` | Demo catalogue |
| 0004 | `seed_admin_employee.sql` | First admin ↔ employee link |
| 0005 | `ai_embeddings.sql` | Vector search |
| 0006 | `erp_foundation.sql` | Entities, roles, permissions, product master, stock documents |
| 0007 | `erp_rls.sql` | Per-entity + per-permission RLS |
| 0008 | `erp_stock_rpcs.sql` | Transactional stock RPCs |
| 0009 | `erp_function_grants.sql` | Revoke PUBLIC/anon EXECUTE |
| 0010 | `erp_import_rpc.sql` | Atomic import commit |
| 0011 | `permission_override_whitelist.sql` | `permission_catalog` |
| 0012 | `employee_privilege_guard.sql` | Anti-escalation trigger |
| 0013 | `rpc_branch_consistency.sql` | Branch consistency in every RPC |
| 0014 | `ledger_write_lockdown.sql` | Ledger INSERT revoked |
| 0015 | `cost_column_privileges.sql` | Cost views |
| 0016 | `cost_column_privileges_fix.sql` | Column privilege lockdown |
| 0017 | `med_hardening.sql` | Null-entity, audit attribution, idempotency, storage |

**Apply:** `supabase db push`. **Fresh empty database:** `npm run db:bundle` then paste `supabase/migrations/run_all.sql`.

---

## Verification

```
npx tsc --noEmit    exit 0
npm run lint        exit 0
npm test            45 unit tests
npm run test:db     103 tests against real RLS with real signed-in users
npm run build       exit 0
```

**148 tests**, ~74 of them adversarial security tests that sign in with the **anon key** and attack through PostgREST — the same path an attacker with devtools would use.

`npm run test:db` refuses to run against production unless `ALLOW_PROD_TEST_DB=1`.

### Known open items

| Item | Status |
|---|---|
| Credential rotation (service-role, `sb_secret`, anon, OpenAI, exposed admin password) | **Outstanding — highest risk** |
| Dedicated test Supabase project | Guard shipped; project not yet created |
| Browser QA (XSS/CSRF/session) | Not yet performed |
| Dependencies | 3 high, 2 moderate, 0 critical — not upgraded |

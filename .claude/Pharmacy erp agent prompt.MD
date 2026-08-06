# AGENT PROMPT — Multi-Entity Pharmacy Retail Management System (Phase 1)

You are building **Phase 1** of a production-grade, multi-entity pharmacy retail
management system for Focus Pharma Africa Ltd (Tanzania). Focus Pharma is the
parent entity. Multiple independent pharmacy shops (e.g., "Hitech Sai Pharmacy",
"KG Pharmacy") operate as separate legal entities, each with fully isolated data,
while the owner has one master dashboard with cross-entity access.

Do NOT build a generic CRM. Do NOT build customer management. This is an
inventory + billing + reporting system.

---

## 1. CORE DOMAIN MODEL

### Entities (tenants)
- `entities` table: id, name, status. Every business record (products, stock,
  sales, users, suppliers, expenses, assets) is scoped by `entity_id`.
- Strict data isolation: a user of Entity A must never query Entity B data.
- One special role (MASTER_ADMIN) bypasses isolation for read/write/reporting
  across all entities via a master dashboard.

### Masters (build these first, in this order)
1. **Product Master** (most important)
   - Fields: sku/code, name, category, unit/pack size, cost_price,
     pricing_mode (FIXED | MARGIN_PERCENT), fixed_selling_price,
     margin_percent, current_selling_price, previous_selling_price,
     min_stock_level, discount_tolerance_percent, image_url, status
     (DRAFT | ACTIVE | INACTIVE), entity_id.
   - **Bulk Excel upload**: parse an uploaded .xlsx, validate rows, insert as
     status=DRAFT. Admin reviews drafts, attaches product image, clicks
     Confirm → status=ACTIVE. Show a draft-review queue UI.
   - Bulk upload must be idempotent and report per-row errors (row number +
     reason) without failing the whole file.
   - Design note: products are added continuously (~15–20/month per entity,
     100–200 every 2–3 months in bulk) — upload flow must be fast and
     re-usable, not a one-time import script.
2. **Employee Master**: name, phone, role, entity_id, login credentials,
   active flag.
3. **Supplier Master**: name, contact, address, entity_id. Include a special
   built-in supplier "Focus Pharma" (parent) selectable in every entity.
4. **Expense Category Master**: category name, entity_id (categories only in
   Phase 1; expense transactions are Phase 2).
5. **Asset Master**: asset name, purchase date, cost, entity_id (simple
   register, no depreciation in Phase 1).

### Stock ledger — batch-aware from day 1
Even though batch/expiry UI is Phase 2, the schema MUST support it now:
- `stock_batches`: product_id, batch_no (nullable in Phase 1), expiry_date
  (nullable in Phase 1), qty_available, cost_price, source_type, entity_id.
- `stock_movements` (append-only ledger): id, entity_id, product_id,
  batch_id, direction (IN | OUT), movement_type, qty, unit_cost,
  reference_no, supplier_id (nullable), created_by, created_at, notes.
- Current stock per product = SUM of movements (or maintained qty on
  batches). Never store stock as a single mutable number without the ledger.

### Movement types
**IN (3):**
- PURCHASE (from Focus Pharma or any supplier; has cost)
- FOC_SAMPLE (free of cost goods / samples; cost recorded as 0 but flag
  the true notional cost for margin reports)
- REPLACEMENT_IN (free replacement of previously returned damaged goods)

**OUT (5):**
- SALE
- STAFF_CONSUMPTION
- EXPIRY
- DAMAGE
- SUPPLIER_RETURN

Every movement stores who did it, when, and for which entity.

---

## 2. STOCK INWARD MODULE
Two entry methods, both mandatory:
1. **Excel upload**: supplier provides an Excel (50–200 line items per
   order is normal). Parse, validate against Product Master (unmatched
   products → clear per-row error, option to send to Draft Products),
   preview screen, then commit as PURCHASE movements.
2. **Manual entry form**: for 1–2 items bought from third parties. Product
   search + qty + cost + supplier + inward type (PURCHASE / FOC / REPLACEMENT).

On PURCHASE inward with a new cost:
- If product pricing_mode = MARGIN_PERCENT, recalculate
  current_selling_price = new_cost × (1 + margin_percent/100), move the old
  value to previous_selling_price.
- If FIXED, selling price unchanged.

## 3. SALES / BILLING MODULE (dispensing counter)
- Sales-user screen: product search (name/sku), shows ONLY:
  current stock, selling price, previous selling price, allowed discount
  tolerance. **cost_price and profit must NEVER be present in the API
  response for sales-role users — enforce server-side, not just hidden in
  UI.**
- Cart → line items with qty, price, discount (validated against
  tolerance), total.
- On confirm: create SALE stock_movements (FIFO against batches),
  decrement stock, store bill with staff user id (needed for per-staff
  revenue reports).
- Simple printable/PDF bill.

## 4. REORDERING / REPLENISHMENT
- Every product has min_stock_level.
- **Stock Replacement Report**: all products where current stock <
  min_stock_level, showing product, current qty, min level, suggested
  reorder qty, last supplier, last cost. Exportable to Excel.
- This report is the trigger for shops to raise purchase requirements to
  Focus Pharma or other suppliers.

## 5. REPORTS (Phase 1)
All reports filterable by entity + date range; master admin can run
cross-entity consolidated versions.
1. Daily Sales Report — totals per entity, breakdown per staff member.
2. Daily Profit Report — sales minus cost (ADMIN/MASTER_ADMIN only).
3. Closing Stock Report — per product: opening, in, out (by type), closing.
4. Stock Replacement / Reorder Report (section 4).
All exportable to Excel.

## 6. ROLES & PERMISSIONS
- Roles: MASTER_ADMIN (owner, cross-entity), ENTITY_ADMIN (full rights in
  own entity, manages users), STAFF/SALES_USER (configurable rights).
- Granular permission flags per user (checkbox style), at minimum:
  can_purchase, can_view_cost, can_view_profit, can_manage_masters,
  can_do_stock_adjustments, can_view_reports.
- ENTITY_ADMIN assigns these; MASTER_ADMIN has everything.
- Enforce every permission at the API layer. Write middleware/guards, not
  per-page UI checks.

## 7. MASTER DASHBOARD (owner)
- Entity switcher: jump into any entity with full admin view.
- Consolidated tiles: today's sales per entity, profit per entity, low-stock
  counts, pending draft products.
- Cross-entity report runner.

---

## PHASE 2 — DO NOT BUILD NOW, BUT DO NOT BLOCK
Schema and architecture must not require rework for:
- Batch numbers + expiry dates on inward, and an "expiring within N months"
  report (fields already exist as nullable — just don't build the UI).
- Expense transactions + monthly budgeted expenses per category per entity,
  with budget-vs-actual P&L view.
- Explicitly EXCLUDED forever unless re-scoped: customer master / customer
  data (regulatory sensitivity in Tanzania pharma).

---

## NON-FUNCTIONAL REQUIREMENTS
- Multi-tenant data isolation enforced at query layer (entity_id on every
  query; tests proving cross-entity leakage is impossible).
- Append-only stock ledger; stock corrections are new adjustment movements,
  never edits/deletes of past movements.
- All money values stored as decimal, currency-safe (TZS).
- Audit trail: created_by / created_at on all transactional tables.
- Excel parsing must handle messy real-world files: extra blank rows,
  trailing spaces, duplicate SKUs in one file — report, don't crash.
- Seed script: 1 master admin, 2 entities, sample products/suppliers/users
  so the system is demo-able immediately.

## WORKING STYLE
- Build in this order and stop for review after each: (1) auth + entities +
  roles/permissions, (2) all masters incl. Excel product upload + draft
  flow, (3) stock inward, (4) sales/billing, (5) reports + reorder report,
  (6) master dashboard.
- Deliver complete, runnable code at each step — no pseudocode, no TODO
  stubs in critical paths.
- After each module, output: what was built, how to test it manually
  (step-by-step), and any assumptions made.
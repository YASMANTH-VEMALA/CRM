-- Audit finding HIGH-1: purchase cost was concealed only in the application
-- layer. The loaders correctly nulled buy_price / unit_cost for users without
-- view_purchase_cost, but the browser holds the anon key and the user's JWT,
-- so a sales user could read the real figures straight from PostgREST:
--
--   GET /rest/v1/products?select=buy_price          -> 1234
--   GET /rest/v1/product_batches?select=unit_cost   -> 1234
--
-- RLS cannot express column-level rules and column privileges are per-role
-- (every signed-in user is `authenticated`), so neither alone is sufficient.
--
-- Approach: take the cost columns away from `authenticated` entirely, and hand
-- them back through two views that are evaluated with the view owner's rights
-- and re-assert both guards in their WHERE clause:
--
--   * has_entity_access(branch_id) — identical predicate to the table's RLS
--     SELECT policy, because owner rights bypass RLS on the base table
--   * has_perm('view_purchase_cost') — the permission the app claims to check
--
-- A user without the permission gets zero rows rather than a nulled column,
-- so there is nothing to unmask. Writes are untouched: only SELECT on the two
-- columns is revoked, so creating and editing products still works.

revoke select (buy_price) on products from authenticated, anon;
revoke select (unit_cost) on product_batches from authenticated, anon;

-- security_invoker = false (the default) is deliberate and load-bearing here:
-- the view must read a column the caller may not read, so it runs as owner and
-- carries its own entity + permission guard instead.
create or replace view product_costs
  with (security_invoker = false) as
select
  p.id        as product_id,
  p.branch_id as branch_id,
  p.buy_price as buy_price
from products p
where has_entity_access(p.branch_id)
  and has_perm('view_purchase_cost');

create or replace view batch_costs
  with (security_invoker = false) as
select
  b.id        as batch_id,
  b.product_id,
  b.branch_id as branch_id,
  b.unit_cost as unit_cost
from product_batches b
where has_entity_access(b.branch_id)
  and has_perm('view_purchase_cost');

revoke all on product_costs from public, anon;
revoke all on batch_costs from public, anon;
grant select on product_costs to authenticated;
grant select on batch_costs to authenticated;

-- Price history records the old and new buy_price as text, so it is a second
-- route to the same figure. Cost rows now need the cost permission; everything
-- else (selling price, margin, discount ceiling) stays visible as before.
drop policy if exists "price_history_select" on product_price_history;
create policy "price_history_select" on product_price_history for select
  using (
    has_entity_access(branch_id)
    and (field <> 'buy_price' or has_perm('view_purchase_cost'))
  );

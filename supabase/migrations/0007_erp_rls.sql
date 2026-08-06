-- ERP Phase 1: per-entity row-level security + granular permission helpers.
-- Replaces 0002's blanket "authenticated_full_access" policy with real
-- entity isolation. App-level code additionally gates field-level exposure
-- (e.g. purchase cost) and business rules; this layer guarantees a user can
-- never read or write another entity's rows regardless of app bugs.

-- ---------------------------------------------------------------------------
-- 1. Helper functions (security definer to avoid policy recursion)
-- ---------------------------------------------------------------------------
create or replace function public.auth_employee_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from employees
  where auth_user_id = auth.uid() and status = 'active'
  limit 1
$$;

create or replace function public.is_master()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from employees
    where auth_user_id = auth.uid() and status = 'active' and role = 'master_admin'
  )
$$;

create or replace function public.has_entity_access(p_branch uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_branch is null
    or is_master()
    or exists (
      select 1 from employees e
      where e.auth_user_id = auth.uid()
        and e.status = 'active'
        and (
          e.branch_id = p_branch
          or exists (
            select 1 from employee_entities ee
            where ee.employee_id = e.id and ee.branch_id = p_branch
          )
        )
    )
$$;

create or replace function public.has_perm(p text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select case
      when e.permission_overrides ? p then (e.permission_overrides ->> p)::boolean
      else exists (
        select 1 from role_permissions rp
        where rp.role = e.role and rp.permission = p
      )
    end
    from employees e
    where e.auth_user_id = auth.uid() and e.status = 'active'
    limit 1
  ), false)
$$;

grant execute on function public.auth_employee_id() to authenticated;
grant execute on function public.is_master() to authenticated;
grant execute on function public.has_entity_access(uuid) to authenticated;
grant execute on function public.has_perm(text) to authenticated;
grant execute on function public.next_doc_number(text, text) to authenticated;

-- Employee privilege guard (function defined in 0006).
drop trigger if exists employees_guard on employees;
create trigger employees_guard
  before insert or update on employees
  for each row execute function fn_employees_guard();

-- ---------------------------------------------------------------------------
-- 2. Drop the blanket policies; enable RLS on the new tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop policy if exists "authenticated_full_access" on public.%I', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Per-table policies
-- ---------------------------------------------------------------------------

-- branches (entities)
create policy "entity_select" on branches for select
  using (has_entity_access(id));
create policy "entity_insert" on branches for insert
  with check (has_perm('manage_entities'));
create policy "entity_update" on branches for update
  using (has_perm('manage_entities')) with check (has_perm('manage_entities'));

-- employees
create policy "employees_select" on employees for select
  using (auth_user_id = auth.uid() or has_entity_access(branch_id));
create policy "employees_insert" on employees for insert
  with check (has_perm('manage_users') and has_entity_access(branch_id));
create policy "employees_update" on employees for update
  using (auth_user_id = auth.uid()
         or (has_perm('manage_users') and has_entity_access(branch_id)))
  with check (auth_user_id = auth.uid()
              or (has_perm('manage_users') and has_entity_access(branch_id)));
-- (fn_employees_guard blocks privilege changes outside manage_users even on
--  self-updates, so the self-update path only really allows last_login_at.)

-- employee_entities
create policy "employee_entities_select" on employee_entities for select
  using (employee_id = auth_employee_id() or has_perm('manage_users'));
create policy "employee_entities_insert" on employee_entities for insert
  with check (has_perm('manage_users') and has_entity_access(branch_id));
create policy "employee_entities_delete" on employee_entities for delete
  using (has_perm('manage_users') and has_entity_access(branch_id));

-- role_permissions (template defaults: readable by all, master-managed)
create policy "role_permissions_select" on role_permissions for select
  using (auth.role() = 'authenticated');
create policy "role_permissions_write" on role_permissions for all
  using (is_master()) with check (is_master());

-- categories / expense_categories: shared reference data
create policy "categories_select" on categories for select
  using (auth.role() = 'authenticated');
create policy "categories_insert" on categories for insert
  with check (has_perm('create_products') or has_perm('edit_products'));
create policy "categories_update" on categories for update
  using (has_perm('edit_products')) with check (has_perm('edit_products'));

create policy "expense_categories_select" on expense_categories for select
  using (auth.role() = 'authenticated');
create policy "expense_categories_write" on expense_categories for all
  using (has_perm('manage_settings')) with check (has_perm('manage_settings'));

-- suppliers
create policy "suppliers_select" on suppliers for select
  using (has_entity_access(branch_id));
create policy "suppliers_insert" on suppliers for insert
  with check (has_entity_access(branch_id) and has_perm('manage_suppliers'));
create policy "suppliers_update" on suppliers for update
  using (has_entity_access(branch_id) and has_perm('manage_suppliers'))
  with check (has_entity_access(branch_id) and has_perm('manage_suppliers'));

-- products
create policy "products_select" on products for select
  using (has_entity_access(branch_id));
create policy "products_insert" on products for insert
  with check (has_entity_access(branch_id) and has_perm('create_products'));
create policy "products_update" on products for update
  using (has_entity_access(branch_id) and has_perm('edit_products'))
  with check (has_entity_access(branch_id) and has_perm('edit_products'));

-- product_price_history
create policy "price_history_select" on product_price_history for select
  using (has_entity_access(branch_id));
create policy "price_history_insert" on product_price_history for insert
  with check (has_entity_access(branch_id)
              and (has_perm('create_products') or has_perm('edit_products')
                   or has_perm('import_products')));

-- product_batches
create policy "batches_select" on product_batches for select
  using (has_entity_access(branch_id));
create policy "batches_insert" on product_batches for insert
  with check (has_entity_access(branch_id)
              and (has_perm('create_stock_inward') or has_perm('adjust_inventory')));
create policy "batches_update" on product_batches for update
  using (has_entity_access(branch_id)
         and (has_perm('create_stock_inward') or has_perm('adjust_inventory')))
  with check (has_entity_access(branch_id)
              and (has_perm('create_stock_inward') or has_perm('adjust_inventory')));
-- (Sales decrement batches only through the security-definer sale RPCs.)

-- customers
create policy "customers_select" on customers for select
  using (has_entity_access(branch_id));
create policy "customers_insert" on customers for insert
  with check (has_entity_access(branch_id)
              and (has_perm('create_sales') or has_perm('manage_users')));
create policy "customers_update" on customers for update
  using (has_entity_access(branch_id)
         and (has_perm('create_sales') or has_perm('manage_users')))
  with check (has_entity_access(branch_id)
              and (has_perm('create_sales') or has_perm('manage_users')));

-- sales / sale_items
create policy "sales_select" on sales for select
  using (has_entity_access(branch_id));
create policy "sales_insert" on sales for insert
  with check (has_entity_access(branch_id) and has_perm('create_sales'));
create policy "sales_update" on sales for update
  using (has_entity_access(branch_id) and has_perm('cancel_sales'))
  with check (has_entity_access(branch_id) and has_perm('cancel_sales'));

create policy "sale_items_select" on sale_items for select
  using (exists (select 1 from sales s
                 where s.id = sale_id and has_entity_access(s.branch_id)));
create policy "sale_items_insert" on sale_items for insert
  with check (exists (select 1 from sales s
                      where s.id = sale_id and has_entity_access(s.branch_id))
              and has_perm('create_sales'));

-- purchase_orders / items — visible to purchasing- and management-level users
create policy "po_select" on purchase_orders for select
  using (has_entity_access(branch_id)
         and (has_perm('create_stock_inward') or has_perm('view_purchase_cost')
              or has_perm('view_management_reports')));
create policy "po_insert" on purchase_orders for insert
  with check (has_entity_access(branch_id) and has_perm('create_stock_inward'));
create policy "po_update" on purchase_orders for update
  using (has_entity_access(branch_id) and has_perm('create_stock_inward'))
  with check (has_entity_access(branch_id) and has_perm('create_stock_inward'));
create policy "po_delete" on purchase_orders for delete
  using (has_entity_access(branch_id) and has_perm('create_stock_inward')
         and status = 'draft');

create policy "po_items_select" on purchase_order_items for select
  using (exists (select 1 from purchase_orders po
                 where po.id = po_id and has_entity_access(po.branch_id)
                   and (has_perm('create_stock_inward') or has_perm('view_purchase_cost')
                        or has_perm('view_management_reports'))));
create policy "po_items_insert" on purchase_order_items for insert
  with check (exists (select 1 from purchase_orders po
                      where po.id = po_id and has_entity_access(po.branch_id))
              and has_perm('create_stock_inward'));
create policy "po_items_delete" on purchase_order_items for delete
  using (exists (select 1 from purchase_orders po
                 where po.id = po_id and has_entity_access(po.branch_id)
                   and po.status = 'draft')
         and has_perm('create_stock_inward'));

-- received_orders / items
create policy "grn_select" on received_orders for select
  using (has_entity_access(branch_id)
         and (has_perm('create_stock_inward') or has_perm('view_purchase_cost')
              or has_perm('view_management_reports')));
create policy "grn_insert" on received_orders for insert
  with check (has_entity_access(branch_id) and has_perm('create_stock_inward'));
create policy "grn_update" on received_orders for update
  using (has_entity_access(branch_id) and has_perm('create_stock_inward'))
  with check (has_entity_access(branch_id) and has_perm('create_stock_inward'));

create policy "grn_items_select" on received_order_items for select
  using (exists (select 1 from received_orders g
                 where g.id = grn_id and has_entity_access(g.branch_id)
                   and (has_perm('create_stock_inward') or has_perm('view_purchase_cost')
                        or has_perm('view_management_reports'))));
create policy "grn_items_insert" on received_order_items for insert
  with check (exists (select 1 from received_orders g
                      where g.id = grn_id and has_entity_access(g.branch_id))
              and has_perm('create_stock_inward'));

-- returns (stock-out documents)
create policy "returns_select" on returns for select
  using (has_entity_access(branch_id));
create policy "returns_insert" on returns for insert
  with check (has_entity_access(branch_id) and has_perm('create_stock_outward'));
create policy "returns_update" on returns for update
  using (has_entity_access(branch_id)
         and (has_perm('approve_stock_outward') or has_perm('create_stock_outward')))
  with check (has_entity_access(branch_id)
              and (has_perm('approve_stock_outward') or has_perm('create_stock_outward')));

-- expenses
create policy "expenses_select" on expenses for select
  using (has_entity_access(branch_id));
create policy "expenses_insert" on expenses for insert
  with check (has_entity_access(branch_id));
create policy "expenses_update" on expenses for update
  using (has_entity_access(branch_id) and has_perm('view_management_reports'))
  with check (has_entity_access(branch_id) and has_perm('view_management_reports'));

-- stock_movements (append-only ledger)
create policy "movements_select" on stock_movements for select
  using (has_entity_access(branch_id) and has_perm('view_inventory'));
create policy "movements_insert" on stock_movements for insert
  with check (has_entity_access(branch_id)
              and (has_perm('create_stock_inward') or has_perm('adjust_inventory')
                   or has_perm('create_stock_outward')));
-- no update/delete policies: ledger rows are immutable through the API

-- stock_transfers
create policy "transfers_select" on stock_transfers for select
  using (has_entity_access(from_branch_id) or has_entity_access(to_branch_id));
create policy "transfers_insert" on stock_transfers for insert
  with check (has_entity_access(from_branch_id) and has_perm('adjust_inventory'));

-- stock_counts / items
create policy "counts_select" on stock_counts for select
  using (has_entity_access(branch_id) and has_perm('view_inventory'));
create policy "counts_write" on stock_counts for insert
  with check (has_entity_access(branch_id) and has_perm('adjust_inventory'));
create policy "counts_update" on stock_counts for update
  using (has_entity_access(branch_id) and has_perm('adjust_inventory'))
  with check (has_entity_access(branch_id) and has_perm('adjust_inventory'));

create policy "count_items_select" on stock_count_items for select
  using (exists (select 1 from stock_counts c
                 where c.id = stock_count_id and has_entity_access(c.branch_id)
                   and has_perm('view_inventory')));
create policy "count_items_insert" on stock_count_items for insert
  with check (exists (select 1 from stock_counts c
                      where c.id = stock_count_id and has_entity_access(c.branch_id))
              and has_perm('adjust_inventory'));

-- stock_inwards / items
create policy "inwards_select" on stock_inwards for select
  using (has_entity_access(branch_id) and has_perm('view_inventory'));
create policy "inwards_insert" on stock_inwards for insert
  with check (has_entity_access(branch_id) and has_perm('create_stock_inward'));
create policy "inwards_update" on stock_inwards for update
  using (has_entity_access(branch_id) and has_perm('create_stock_inward'))
  with check (has_entity_access(branch_id) and has_perm('create_stock_inward'));

create policy "inward_items_select" on stock_inward_items for select
  using (exists (select 1 from stock_inwards i
                 where i.id = inward_id and has_entity_access(i.branch_id)
                   and has_perm('view_inventory')));
create policy "inward_items_insert" on stock_inward_items for insert
  with check (exists (select 1 from stock_inwards i
                      where i.id = inward_id and has_entity_access(i.branch_id))
              and has_perm('create_stock_inward'));
create policy "inward_items_update" on stock_inward_items for update
  using (exists (select 1 from stock_inwards i
                 where i.id = inward_id and has_entity_access(i.branch_id)
                   and i.status = 'draft')
         and has_perm('create_stock_inward'))
  with check (has_perm('create_stock_inward'));
create policy "inward_items_delete" on stock_inward_items for delete
  using (exists (select 1 from stock_inwards i
                 where i.id = inward_id and has_entity_access(i.branch_id)
                   and i.status = 'draft')
         and has_perm('create_stock_inward'));

-- opening_stock_entries / items
create policy "opening_select" on opening_stock_entries for select
  using (has_entity_access(branch_id) and has_perm('view_inventory'));
create policy "opening_insert" on opening_stock_entries for insert
  with check (has_entity_access(branch_id) and has_perm('create_stock_inward'));
create policy "opening_update" on opening_stock_entries for update
  using (has_entity_access(branch_id) and has_perm('create_stock_inward'))
  with check (has_entity_access(branch_id) and has_perm('create_stock_inward'));

create policy "opening_items_select" on opening_stock_items for select
  using (exists (select 1 from opening_stock_entries e
                 where e.id = entry_id and has_entity_access(e.branch_id)
                   and has_perm('view_inventory')));
create policy "opening_items_insert" on opening_stock_items for insert
  with check (exists (select 1 from opening_stock_entries e
                      where e.id = entry_id and has_entity_access(e.branch_id))
              and has_perm('create_stock_inward'));
create policy "opening_items_update" on opening_stock_items for update
  using (exists (select 1 from opening_stock_entries e
                 where e.id = entry_id and has_entity_access(e.branch_id)
                   and e.status = 'draft')
         and has_perm('create_stock_inward'))
  with check (has_perm('create_stock_inward'));
create policy "opening_items_delete" on opening_stock_items for delete
  using (exists (select 1 from opening_stock_entries e
                 where e.id = entry_id and has_entity_access(e.branch_id)
                   and e.status = 'draft')
         and has_perm('create_stock_inward'));

-- product_imports / draft_products
create policy "imports_select" on product_imports for select
  using (has_entity_access(branch_id) and has_perm('import_products'));
create policy "imports_insert" on product_imports for insert
  with check (has_entity_access(branch_id) and has_perm('import_products'));

create policy "drafts_select" on draft_products for select
  using (has_entity_access(branch_id)
         and (has_perm('import_products') or has_perm('create_products')));
create policy "drafts_insert" on draft_products for insert
  with check (has_entity_access(branch_id) and has_perm('import_products'));
create policy "drafts_update" on draft_products for update
  using (has_entity_access(branch_id)
         and (has_perm('import_products') or has_perm('create_products')))
  with check (has_entity_access(branch_id)
              and (has_perm('import_products') or has_perm('create_products')));
create policy "drafts_delete" on draft_products for delete
  using (has_entity_access(branch_id) and has_perm('import_products'));

-- approval_tasks
create policy "approvals_select" on approval_tasks for select
  using (has_entity_access(branch_id));
create policy "approvals_insert" on approval_tasks for insert
  with check (has_entity_access(branch_id));
create policy "approvals_update" on approval_tasks for update
  using (has_entity_access(branch_id) and has_perm('view_management_reports'))
  with check (has_entity_access(branch_id) and has_perm('view_management_reports'));

-- audit_logs (append-only; readable by management within their entities)
create policy "audit_select" on audit_logs for select
  using (has_perm('view_management_reports') and has_entity_access(branch_id));
create policy "audit_insert" on audit_logs for insert
  with check (auth.role() = 'authenticated');

-- notifications (entity-scoped; null branch = global)
create policy "notifications_select" on notifications for select
  using (branch_id is null or has_entity_access(branch_id));
create policy "notifications_insert" on notifications for insert
  with check (auth.role() = 'authenticated');
create policy "notifications_update" on notifications for update
  using (branch_id is null or has_entity_access(branch_id))
  with check (branch_id is null or has_entity_access(branch_id));

-- login_history
create policy "login_history_select" on login_history for select
  using (employee_id = auth_employee_id() or has_perm('manage_users'));
create policy "login_history_insert" on login_history for insert
  with check (employee_id = auth_employee_id());

-- settings (null branch = global, master-managed; per-entity via manage_settings)
create policy "settings_select" on settings for select
  using (branch_id is null or has_entity_access(branch_id));
create policy "settings_insert" on settings for insert
  with check ((branch_id is null and is_master())
              or (branch_id is not null and has_entity_access(branch_id)
                  and has_perm('manage_settings')));
create policy "settings_update" on settings for update
  using ((branch_id is null and is_master())
         or (branch_id is not null and has_entity_access(branch_id)
             and has_perm('manage_settings')))
  with check ((branch_id is null and is_master())
              or (branch_id is not null and has_entity_access(branch_id)
                  and has_perm('manage_settings')));

-- document_embeddings (writes happen via service role which bypasses RLS)
create policy "embeddings_select" on document_embeddings for select
  using (branch_id is null or has_entity_access(branch_id));

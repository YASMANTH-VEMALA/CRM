-- ERP Phase 1 foundation: multi-entity scoping, granular permissions,
-- product master upgrade, stock documents, ledger upgrade.
--
-- Conventions/assumptions:
-- * `branches` IS the entity table (one row = one independent pharmacy).
--   The UI relabels these as "Entities"; the column stays `branch_id`
--   everywhere to avoid a disruptive rename.
-- * Existing global rows (products, suppliers, customers, historic sales…)
--   are backfilled to the seed's operating branch, "Mars Pharmacy Store 3"
--   (fallback: oldest branch).
-- * `categories` and `expense_categories` remain shared reference data.

-- ---------------------------------------------------------------------------
-- 1. Entities (branches)
-- ---------------------------------------------------------------------------
alter table branches
  add column code text,
  add column registered_name text,
  add column phone text,
  add column email text,
  add column address text,
  add column currency text not null default 'TZS',
  add column timezone text not null default 'Africa/Dar_es_Salaam';

with numbered as (
  select id, row_number() over (order by created_at, name) as rn from branches
)
update branches b
set code = 'ENT-' || lpad(n.rn::text, 3, '0')
from numbered n
where n.id = b.id and b.code is null;

alter table branches alter column code set not null;
alter table branches add constraint branches_code_key unique (code);

-- ---------------------------------------------------------------------------
-- 2. Role templates + granular permissions
-- ---------------------------------------------------------------------------
alter table employees drop constraint employees_role_check;

update employees set role = case role
  when 'administrator'     then 'master_admin'
  when 'cashier'           then 'sales_user'
  when 'inventory_manager' then 'inventory_user'
  when 'purchase_manager'  then 'inventory_user'
  when 'accountant'        then 'inventory_user'
  else role
end;

alter table employees add constraint employees_role_check
  check (role in ('master_admin','entity_admin','inventory_user','sales_user'));

alter table employees
  add column permission_overrides jsonb not null default '{}'::jsonb,
  add column max_discount_percent numeric not null default 0;

-- Admin templates start with an explicit 100% discount ceiling; everyone else
-- starts at 0 (no discount allowed until an admin raises their limit).
update employees set max_discount_percent = 100 where role = 'master_admin';

-- Role template defaults. Single source of truth for both SQL (has_perm) and
-- the app (which reads this table). Per-employee overrides live in
-- employees.permission_overrides as {"<permission>": true|false}.
create table role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission)
);

insert into role_permissions (role, permission)
select 'master_admin', p from unnest(array[
  'view_products','create_products','edit_products','import_products',
  'view_inventory','adjust_inventory','create_stock_inward','create_stock_outward','approve_stock_outward',
  'view_purchase_cost','manage_suppliers',
  'create_sales','apply_discount','cancel_sales',
  'view_profit','view_management_reports',
  'manage_users','manage_entities','manage_settings','access_multiple_entities','generate_exports'
]) as p
union all
select 'entity_admin', p from unnest(array[
  'view_products','create_products','edit_products','import_products',
  'view_inventory','adjust_inventory','create_stock_inward','create_stock_outward','approve_stock_outward',
  'view_purchase_cost','manage_suppliers',
  'create_sales','apply_discount','cancel_sales',
  'view_profit','view_management_reports',
  'manage_users','manage_settings','generate_exports'
]) as p
union all
select 'inventory_user', p from unnest(array[
  'view_products','create_products','edit_products','import_products',
  'view_inventory','create_stock_inward','create_stock_outward',
  'view_purchase_cost','manage_suppliers'
]) as p
union all
select 'sales_user', p from unnest(array[
  'view_products','view_inventory','create_sales','apply_discount'
]) as p;

-- Extra entities a user may access beyond their home branch (master admins
-- implicitly access every entity and need no rows here).
create table employee_entities (
  employee_id uuid not null references employees(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, branch_id)
);

-- ---------------------------------------------------------------------------
-- 3. Entity scoping: add missing branch_id columns, backfill, tighten
-- ---------------------------------------------------------------------------
alter table products add column branch_id uuid references branches(id);
alter table suppliers add column branch_id uuid references branches(id);
alter table customers add column branch_id uuid references branches(id);
alter table received_orders add column branch_id uuid references branches(id);
alter table returns add column branch_id uuid references branches(id);
alter table notifications add column branch_id uuid references branches(id);
alter table document_embeddings add column branch_id uuid references branches(id);

do $$
declare op uuid;
begin
  select id into op from branches where name = 'Mars Pharmacy Store 3';
  if op is null then
    select id into op from branches order by created_at limit 1;
  end if;

  update products set branch_id = op where branch_id is null;
  update suppliers set branch_id = op where branch_id is null;
  update customers set branch_id = op where branch_id is null;
  update product_batches set branch_id = op where branch_id is null;
  update sales set branch_id = op where branch_id is null;
  update purchase_orders set branch_id = op where branch_id is null;
  update expenses set branch_id = op where branch_id is null;
  update returns set branch_id = op where branch_id is null;
  update stock_movements set branch_id = op where branch_id is null;
  update stock_transfers set from_branch_id = op where from_branch_id is null;
  update stock_counts set branch_id = op where branch_id is null;
  update received_orders ro
    set branch_id = coalesce((select po.branch_id from purchase_orders po where po.id = ro.po_id), op)
    where ro.branch_id is null;
  -- Non-master employees must belong to an entity.
  update employees set branch_id = op where branch_id is null and role <> 'master_admin';

  -- Entity-scope the AI embeddings back to their source rows.
  update document_embeddings de set branch_id = p.branch_id
    from products p where de.source_table = 'products' and de.source_id = p.id;
  update document_embeddings de set branch_id = c.branch_id
    from customers c where de.source_table = 'customers' and de.source_id = c.id;
  update document_embeddings de set branch_id = s.branch_id
    from suppliers s where de.source_table = 'suppliers' and de.source_id = s.id;
end $$;

alter table products alter column branch_id set not null;
alter table suppliers alter column branch_id set not null;
alter table customers alter column branch_id set not null;
alter table product_batches alter column branch_id set not null;
alter table sales alter column branch_id set not null;
alter table purchase_orders alter column branch_id set not null;
alter table received_orders alter column branch_id set not null;
alter table returns alter column branch_id set not null;
alter table stock_movements alter column branch_id set not null;

create index products_branch_idx on products(branch_id);
create index suppliers_branch_idx on suppliers(branch_id);
create index customers_branch_idx on customers(branch_id);
create index sales_branch_idx on sales(branch_id);
create index returns_branch_idx on returns(branch_id);
create index stock_movements_branch_idx on stock_movements(branch_id);

-- SKU is unique per entity, not globally.
alter table products drop constraint products_sku_key;
alter table products add constraint products_branch_sku_key unique (branch_id, sku);

-- ---------------------------------------------------------------------------
-- 4. Product master upgrade
-- ---------------------------------------------------------------------------
-- Existing columns reused: buy_price = purchase cost, sell_price = selling
-- price, unit = unit/pack size, reorder_level = minimum stock quantity,
-- supplier_id = default supplier.
alter table products
  add column manufacturer text,
  add column image_url text,
  add column pricing_method text not null default 'fixed'
    check (pricing_method in ('fixed','cost_plus_margin')),
  add column margin_percent numeric not null default 0,
  add column max_discount_percent numeric not null default 0,
  add column restock_target int not null default 0;

create table product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  branch_id uuid not null references branches(id),
  field text not null check (field in
    ('buy_price','sell_price','margin_percent','pricing_method','max_discount_percent')),
  previous_value text,
  new_value text,
  change_type text not null,
  changed_by uuid references employees(id),
  reason text,
  created_at timestamptz not null default now()
);
create index product_price_history_product_idx on product_price_history(product_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Supplier master upgrade
-- ---------------------------------------------------------------------------
alter table suppliers
  add column supplier_type text not null default 'external'
    check (supplier_type in ('parent','external')),
  add column email text,
  add column address text,
  add column tax_id text,
  add column registration_number text;

-- ---------------------------------------------------------------------------
-- 6. Batch source linkage
-- ---------------------------------------------------------------------------
alter table product_batches
  add column source_type text,
  add column source_id uuid;

-- ---------------------------------------------------------------------------
-- 7. Inventory ledger upgrade
-- ---------------------------------------------------------------------------
alter table stock_movements
  add column balance_after int,
  add column reference_number text,
  add column reason text;

alter table stock_movements drop constraint stock_movements_movement_type_check;
alter table stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in (
    -- required Phase 1 vocabulary
    'opening_stock','purchase','foc','replacement_in','sale',
    'employee_consumption','expiry','damage','supplier_return',
    'sale_reversal','stock_correction',
    -- legacy values kept for pre-existing rows and transfer/count flows
    'purchase_receipt','adjustment','transfer_out','transfer_in','return',
    'disposal','count_correction'
  ));

-- ---------------------------------------------------------------------------
-- 8. Sales reversal metadata
-- ---------------------------------------------------------------------------
alter table sales
  add column reversed_by uuid references employees(id),
  add column reversed_at timestamptz,
  add column reversal_reason text;

-- ---------------------------------------------------------------------------
-- 9. Stock-out workflow fields on returns
--    (returns doubles as the stock-out document: supplier returns, expiry
--    write-offs, damage write-offs, employee consumption; customer returns
--    keep their existing behaviour.)
-- ---------------------------------------------------------------------------
alter table returns
  add column consumed_by uuid references employees(id),
  add column resolution_type text
    check (resolution_type in ('credit','refund','replacement')),
  add column evidence_url text,
  add column expiry_date date,
  add column approved_by uuid references employees(id),
  add column approved_at timestamptz;

alter table returns drop constraint returns_type_check;
alter table returns add constraint returns_type_check
  check (type in ('customer','supplier','damaged','expired','employee_consumption'));

alter table returns drop constraint returns_status_check;
alter table returns add constraint returns_status_check
  check (status in ('pending','approved','review','rejected','completed'));

-- ---------------------------------------------------------------------------
-- 10. Stock inward documents (draft -> confirmed; stock moves on confirm)
-- ---------------------------------------------------------------------------
create table stock_inwards (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  branch_id uuid not null references branches(id),
  supplier_id uuid references suppliers(id),
  inward_type text not null check (inward_type in
    ('purchase_from_parent','purchase_from_external','foc_or_sample','replacement_in')),
  invoice_number text,
  invoice_date date,
  supplier_return_id uuid references returns(id),
  document_url text,
  notes text,
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  created_by uuid references employees(id),
  confirmed_by uuid references employees(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index stock_inwards_branch_idx on stock_inwards(branch_id, status);
-- The same supplier invoice can only be captured once per entity (cancelled
-- documents release the number).
create unique index stock_inwards_invoice_unique
  on stock_inwards(branch_id, supplier_id, invoice_number)
  where invoice_number is not null and status <> 'cancelled';

create table stock_inward_items (
  id uuid primary key default gen_random_uuid(),
  inward_id uuid not null references stock_inwards(id) on delete cascade,
  product_id uuid not null references products(id),
  batch_number text not null,
  expiry_date date,
  quantity int not null default 0 check (quantity >= 0),
  free_quantity int not null default 0 check (free_quantity >= 0),
  unit_cost numeric not null default 0,
  batch_id uuid references product_batches(id),
  check (quantity + free_quantity > 0)
);
create index stock_inward_items_inward_idx on stock_inward_items(inward_id);

-- ---------------------------------------------------------------------------
-- 11. Opening stock (draft -> confirmed; locked after confirmation)
-- ---------------------------------------------------------------------------
create table opening_stock_entries (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  branch_id uuid not null references branches(id),
  opening_date date not null default current_date,
  notes text,
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  created_by uuid references employees(id),
  confirmed_by uuid references employees(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index opening_stock_entries_branch_idx on opening_stock_entries(branch_id, status);

create table opening_stock_items (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references opening_stock_entries(id) on delete cascade,
  product_id uuid not null references products(id),
  batch_number text not null,
  expiry_date date,
  quantity int not null check (quantity > 0),
  unit_cost numeric not null default 0,
  sell_price numeric,
  batch_id uuid references product_batches(id)
);
create index opening_stock_items_entry_idx on opening_stock_items(entry_id);

-- ---------------------------------------------------------------------------
-- 12. Import history + draft products
-- ---------------------------------------------------------------------------
create table product_imports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  filename text not null,
  file_hash text not null,
  kind text not null default 'products' check (kind in ('products','opening_stock','stock_inward')),
  total_rows int not null default 0,
  valid_rows int not null default 0,
  invalid_rows int not null default 0,
  status text not null default 'committed' check (status in ('committed','failed')),
  error_report jsonb not null default '[]'::jsonb,
  created_by uuid references employees(id),
  created_at timestamptz not null default now(),
  -- The identical file cannot be imported twice into the same entity.
  unique (branch_id, kind, file_hash)
);

create table draft_products (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  import_id uuid references product_imports(id) on delete set null,
  name text not null,
  sku text,
  barcode text,
  category_name text,
  manufacturer text,
  unit text,
  supplier_name text,
  buy_price numeric not null default 0,
  pricing_method text not null default 'fixed'
    check (pricing_method in ('fixed','cost_plus_margin')),
  margin_percent numeric not null default 0,
  sell_price numeric not null default 0,
  max_discount_percent numeric not null default 0,
  reorder_level int not null default 0,
  restock_target int not null default 0,
  image_url text,
  duplicate_of uuid references products(id),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  reviewed_by uuid references employees(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index draft_products_branch_idx on draft_products(branch_id, status);

-- ---------------------------------------------------------------------------
-- 13. Document number sequences (collision-proof references)
-- ---------------------------------------------------------------------------
create sequence if not exists doc_seq_sale;
create sequence if not exists doc_seq_inward;
create sequence if not exists doc_seq_opening;
create sequence if not exists doc_seq_return;
create sequence if not exists doc_seq_correction;
create sequence if not exists doc_seq_import;

create or replace function next_doc_number(p_prefix text, p_seq text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  if p_seq not in ('doc_seq_sale','doc_seq_inward','doc_seq_opening',
                   'doc_seq_return','doc_seq_correction','doc_seq_import') then
    raise exception 'Unknown document sequence %', p_seq;
  end if;
  execute format('select nextval(%L)', p_seq) into n;
  return p_prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 6, '0');
end $$;

-- ---------------------------------------------------------------------------
-- 14. Employee privilege guard
--     Blocks privilege self-escalation through ANY write path (PostgREST
--     included), while leaving migrations/service-role jobs (no JWT) alone.
-- ---------------------------------------------------------------------------
create or replace function fn_employees_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- migrations, seeds, service-role jobs
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'master_admin' and not is_master() then
      raise exception 'Only a master admin can create a master admin.';
    end if;
    return new;
  end if;

  -- UPDATE: privilege-bearing columns need manage_users; granting master
  -- requires being master.
  if new.role is distinct from old.role
     or new.permission_overrides is distinct from old.permission_overrides
     or new.max_discount_percent is distinct from old.max_discount_percent
     or new.branch_id is distinct from old.branch_id
     or new.approval_limit is distinct from old.approval_limit
     or new.status is distinct from old.status then
    if not has_perm('manage_users') then
      raise exception 'You are not allowed to change employee privileges.';
    end if;
    if new.role = 'master_admin' and old.role is distinct from 'master_admin' and not is_master() then
      raise exception 'Only a master admin can grant the master admin role.';
    end if;
  end if;
  return new;
end $$;

-- (Trigger is created in 0007 after is_master()/has_perm() exist.)

-- ---------------------------------------------------------------------------
-- 15. Storage buckets for product images and stock documents
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true),
       ('stock-documents', 'stock-documents', true)
on conflict (id) do nothing;

drop policy if exists "erp_upload_files" on storage.objects;
create policy "erp_upload_files" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('product-images','stock-documents'));

drop policy if exists "erp_read_files" on storage.objects;
create policy "erp_read_files" on storage.objects
  for select
  using (bucket_id in ('product-images','stock-documents'));

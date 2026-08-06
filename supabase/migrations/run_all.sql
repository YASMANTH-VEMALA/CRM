-- =====================================================================
-- Mars Pharmacy ERP — full schema bootstrap
--
-- GENERATED FILE. Do not edit by hand.
-- Regenerate with: npm run db:bundle
--
-- Concatenation of every numbered migration, in order. Use this ONLY to
-- bootstrap a brand-new, empty database in one paste (for example the
-- Supabase SQL editor on a fresh project). For an existing database use
-- the migrations themselves via `supabase db push`, so the migration
-- history table stays accurate.
--
-- Order matters: 0002 installs permissive bootstrap policies that 0007
-- replaces with the real per-entity policies, and 0011-0013 harden the
-- permission and stock layers on top of that.
-- =====================================================================

-- ===== 0001_schema.sql =====
-- Mars Pharmacy CRM — core schema
create extension if not exists pgcrypto;

create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  manager_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  username text unique,
  email text unique,
  role text not null default 'cashier'
    check (role in ('administrator','cashier','inventory_manager','purchase_manager','accountant')),
  branch_id uuid references branches(id) on delete set null,
  approval_limit numeric,
  status text not null default 'active' check (status in ('active','disabled')),
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  type text not null default 'medicine' check (type in ('medicine','supplies')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  payment_terms text,
  lead_time_days int,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  name text not null,
  generic_name text,
  strength text,
  form text,
  category_id uuid references categories(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  buy_price numeric not null default 0,
  sell_price numeric not null default 0,
  unit text,
  barcode text,
  status text not null default 'active' check (status in ('active','discontinued','quarantined')),
  reorder_level int not null default 0,
  created_at timestamptz not null default now()
);
create index products_category_idx on products(category_id);
create index products_supplier_idx on products(supplier_id);

create table product_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  batch_number text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  quantity_received int not null default 0,
  quantity_available int not null default 0,
  unit_cost numeric not null default 0,
  expiry_date date,
  storage_location text,
  status text not null default 'active'
    check (status in ('active','quarantined','damaged','expired','negative')),
  received_at timestamptz not null default now()
);
create index product_batches_product_idx on product_batches(product_id);
create index product_batches_branch_idx on product_batches(branch_id);
create index product_batches_expiry_idx on product_batches(expiry_date);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  segment text,
  loyalty_points int not null default 0,
  credit_balance numeric not null default 0,
  created_at timestamptz not null default now()
);

create table sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,
  customer_id uuid references customers(id) on delete set null,
  cashier_id uuid references employees(id) on delete set null,
  branch_id uuid references branches(id) on delete set null,
  payment_method text not null check (payment_method in ('Cash','Bank','M-Pesa','Selcom','Credit')),
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'completed' check (status in ('completed','returned','reversed')),
  sold_at timestamptz not null default now()
);
create index sales_sold_at_idx on sales(sold_at);
create index sales_customer_idx on sales(customer_id);

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  batch_id uuid references product_batches(id),
  quantity int not null,
  unit_price numeric not null,
  discount numeric not null default 0,
  line_total numeric not null
);
create index sale_items_sale_idx on sale_items(sale_id);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text unique not null,
  supplier_id uuid references suppliers(id),
  created_by uuid references employees(id),
  branch_id uuid references branches(id),
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','partially_received','received','cancelled')),
  expected_date date,
  total numeric not null default 0,
  created_at timestamptz not null default now()
);

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity int not null,
  unit_cost numeric not null
);

create table received_orders (
  id uuid primary key default gen_random_uuid(),
  grn_number text unique not null,
  po_id uuid references purchase_orders(id),
  supplier_invoice_number text,
  received_by uuid references employees(id),
  status text not null default 'partial' check (status in ('partial','complete','variance')),
  created_at timestamptz not null default now()
);

create table received_order_items (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references received_orders(id) on delete cascade,
  product_id uuid not null references products(id),
  batch_id uuid references product_batches(id),
  quantity_ordered int not null default 0,
  quantity_received int not null default 0,
  unit_cost numeric not null default 0,
  damaged_qty int not null default 0
);

create table returns (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  type text not null check (type in ('customer','supplier','damaged','expired')),
  original_sale_id uuid references sales(id),
  original_po_id uuid references purchase_orders(id),
  product_id uuid references products(id),
  batch_id uuid references product_batches(id),
  quantity int not null default 0,
  reason text,
  refund_method text,
  requested_by uuid references employees(id),
  status text not null default 'pending' check (status in ('pending','approved','review')),
  created_at timestamptz not null default now()
);

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  description text,
  category_id uuid references expense_categories(id),
  vendor text,
  amount numeric not null default 0,
  payment_method text,
  branch_id uuid references branches(id),
  created_by uuid references employees(id),
  status text not null default 'pending' check (status in ('pending','approved')),
  is_recurring boolean not null default false,
  created_at timestamptz not null default now()
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id),
  batch_id uuid references product_batches(id),
  branch_id uuid references branches(id),
  movement_type text not null
    check (movement_type in ('sale','purchase_receipt','adjustment','transfer_out','transfer_in','return','disposal','count_correction')),
  quantity_delta int not null,
  reference_type text,
  reference_id uuid,
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);
create index stock_movements_product_idx on stock_movements(product_id);
create index stock_movements_batch_idx on stock_movements(batch_id);

create table stock_transfers (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  product_id uuid references products(id),
  batch_id uuid references product_batches(id),
  from_branch_id uuid references branches(id),
  to_branch_id uuid references branches(id),
  quantity int not null,
  status text not null default 'pending' check (status in ('pending','completed')),
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  branch_id uuid references branches(id),
  status text not null default 'open' check (status in ('open','completed')),
  created_by uuid references employees(id),
  created_at timestamptz not null default now()
);

create table stock_count_items (
  id uuid primary key default gen_random_uuid(),
  stock_count_id uuid not null references stock_counts(id) on delete cascade,
  product_id uuid references products(id),
  batch_id uuid references product_batches(id),
  expected_qty int not null default 0,
  counted_qty int,
  variance int generated always as (coalesce(counted_qty,0) - expected_qty) stored
);

create table approval_tasks (
  id uuid primary key default gen_random_uuid(),
  type text not null
    check (type in ('purchase_order','discount','price_change','stock_adjustment','refund','supplier_return','disposal')),
  reference_id uuid,
  requested_by uuid references employees(id),
  branch_id uuid references branches(id),
  amount numeric,
  description text,
  status text not null default 'pending' check (status in ('pending','review','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  action text not null,
  module text,
  record_reference text,
  previous_value text,
  new_value text,
  reason text,
  branch_id uuid references branches(id),
  session_ref text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on audit_logs(created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  title text not null,
  message text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table login_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  device text,
  ip_address text,
  session_ref text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table settings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id),
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(branch_id, key)
);

-- ===== 0002_rls.sql =====
-- Enable RLS on every public table with a single "any authenticated user" policy.
-- Matches the app's current auth model (one real admin account, no per-role
-- restriction yet). Blocks anonymous/public access; tighten per-table later
-- if per-role or per-branch scoping is introduced.
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "authenticated_full_access" on public.%I for all using (auth.role() = %L) with check (auth.role() = %L)',
      t, 'authenticated', 'authenticated'
    );
  end loop;
end $$;

-- ===== 0003_seed.sql =====
-- Seed data migrated from the former mock-data.ts, so the app looks the same
-- on first load while every row is now a real, editable record. The admin
-- auth user/employee row is created separately (needs a real auth.users id).

-- Branches
insert into branches (name, location, manager_name, is_active) values
  ('Mars Pharmacy Store 1', 'Kariakoo, Dar es Salaam', 'Anna Mrema', true),
  ('Mars Pharmacy Store 2', 'Mikocheni, Dar es Salaam', 'Joseph Paul', true),
  ('Mars Pharmacy Store 3', 'Masaki, Dar es Salaam', 'Admin Mars', true),
  ('Mars Pharmacy Store 4', 'Mbezi Beach, Dar es Salaam', 'Rehema John', true);

-- Categories
insert into categories (code, name, type, is_active) values
  ('CAT-01', 'Antibiotics', 'medicine', true),
  ('CAT-02', 'Cardiovascular', 'medicine', true),
  ('CAT-03', 'Pain relief', 'medicine', true),
  ('CAT-04', 'Diabetes', 'medicine', true),
  ('CAT-05', 'Respiratory', 'medicine', true),
  ('CAT-06', 'Supplements', 'medicine', true),
  ('CAT-07', 'Gastrointestinal', 'medicine', true),
  ('CAT-08', 'Allergy', 'medicine', true),
  ('CAT-09', 'Dermatology', 'medicine', true),
  ('CAT-16', 'Medical supplies', 'supplies', true);

-- Suppliers
insert into suppliers (name, contact_name, phone, payment_terms, lead_time_days, is_active) values
  ('Phillips Pharma', 'David M.', '+255 754 220 184', '30 days', 3, true),
  ('Bahari Pharmacy', 'Rehema S.', '+255 713 440 216', '21 days', 2, true),
  ('Salama Medical', 'John K.', '+255 782 095 731', '30 days', 4, true),
  ('Afya Supplies', 'Zainab A.', '+255 655 371 882', 'Cash', 5, true);

-- Expense categories
insert into expense_categories (name, is_active) values
  ('Utilities', true), ('Transport', true), ('Supplies', true), ('Compliance', true);

-- Branches (Store 3 is the operating branch for this seed's activity)
-- Products
insert into products (sku, name, generic_name, strength, form, category_id, supplier_id, buy_price, sell_price, unit, barcode, status, reorder_level) values
  ('MED-00041', 'Paracetamol', 'Paracetamol', '500mg', 'Tablet', (select id from categories where code='CAT-03'), (select id from suppliers where name='Phillips Pharma'), 2500, 5000, 'Pack of 100', '6201100184812', 'active', 50),
  ('MED-00128', 'Metformin', 'Metformin HCl', '500mg', 'Tablet', (select id from categories where code='CAT-04'), (select id from suppliers where name='Bahari Pharmacy'), 9500, 14000, 'Pack of 100', null, 'active', 30),
  ('MED-00214', 'Augmentin', 'Co-amoxiclav', '625mg', 'Tablet', (select id from categories where code='CAT-01'), (select id from suppliers where name='Phillips Pharma'), 24000, 35000, 'Pack of 20', null, 'active', 20),
  ('MED-00215', 'Amoxicillin', 'Amoxicillin', '500mg', 'Tablet', (select id from categories where code='CAT-01'), (select id from suppliers where name='Bahari Pharmacy'), 7900, 14000, 'Pack of 20', null, 'active', 25),
  ('MED-00397', 'Losartan', 'Losartan K', '50mg', 'Tablet', (select id from categories where code='CAT-02'), (select id from suppliers where name='Phillips Pharma'), 7200, 12000, 'Pack of 30', null, 'active', 20),
  ('MED-00442', 'Hydrocortisone Cream', 'Hydrocortisone', '1%', 'Cream', (select id from categories where code='CAT-09'), (select id from suppliers where name='Afya Supplies'), 3200, 6500, 'Tube', null, 'active', 10),
  ('MED-00581', 'Ventolin', 'Salbutamol', '100mcg', 'Inhaler', (select id from categories where code='CAT-05'), (select id from suppliers where name='Phillips Pharma'), 18000, 26000, 'Inhaler', null, 'active', 15),
  ('MED-00729', 'Amoxil', 'Amoxicillin', '250mg', 'Suspension', (select id from categories where code='CAT-01'), (select id from suppliers where name='Bahari Pharmacy'), 8800, 14500, 'Bottle', null, 'quarantined', 15),
  ('MED-00845', 'Vitamin C', 'Ascorbic acid', '1000mg', 'Tablet', (select id from categories where code='CAT-06'), (select id from suppliers where name='Salama Medical'), 6400, 14000, 'Pack of 20', null, 'active', 20),
  ('MED-00846', 'Cefixime', 'Cefixime', '200mg', 'Tablet', (select id from categories where code='CAT-01'), (select id from suppliers where name='Salama Medical'), 18200, 24500, 'Pack of 10', null, 'active', 15),
  ('MED-00847', 'Omeprazole', 'Omeprazole', '20mg', 'Capsule', (select id from categories where code='CAT-07'), (select id from suppliers where name='Salama Medical'), 7000, 14000, 'Pack of 30', null, 'active', 20),
  ('MED-00848', 'Cetirizine', 'Cetirizine', '10mg', 'Tablet', (select id from categories where code='CAT-08'), (select id from suppliers where name='Afya Supplies'), 4500, 9000, 'Pack of 30', null, 'active', 20),
  ('SUP-00214', 'Insulin Syringe', 'Insulin Syringe', '1ml', 'Syringe', (select id from categories where code='CAT-16'), (select id from suppliers where name='Afya Supplies'), 350, 700, 'Box of 100', null, 'active', 20);

-- Product batches (Store 3)
insert into product_batches (product_id, batch_number, supplier_id, branch_id, quantity_received, quantity_available, unit_cost, expiry_date, storage_location, status) values
  ((select id from products where sku='MED-00041'), 'PCM-24081', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 100, 84, 2500, '2026-12-18', 'A-01-01', 'active'),
  ((select id from products where sku='MED-00041'), 'PCM-25012', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 150, 142, 2600, '2027-06-24', 'A-01-02', 'active'),
  ((select id from products where sku='MED-00041'), 'PCM-25038', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 100, 100, 2720, '2028-02-11', 'A-01-03', 'active'),
  ((select id from products where sku='MED-00128'), 'MTF-2409', (select id from suppliers where name='Bahari Pharmacy'), (select id from branches where name='Mars Pharmacy Store 3'), 120, 8, 9500, '2027-09-18', 'A-04-02', 'active'),
  ((select id from products where sku='MED-00215'), 'AMX-5500', (select id from suppliers where name='Bahari Pharmacy'), (select id from branches where name='Mars Pharmacy Store 3'), 300, 140, 8000, '2027-11-01', 'A-02-01', 'active'),
  ((select id from products where sku='MED-00397'), 'LOS-5543', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 90, 11, 7200, '2028-04-11', 'C-01-03', 'active'),
  ((select id from products where sku='MED-00442'), 'HDC-1124', (select id from suppliers where name='Afya Supplies'), (select id from branches where name='Mars Pharmacy Store 3'), 20, 6, 3200, '2026-07-28', 'D-01-01', 'expired'),
  ((select id from products where sku='MED-00581'), 'BN-24062', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 40, 0, 18000, null, 'B-01-01', 'active'),
  ((select id from products where sku='MED-00729'), 'AMX-7231', (select id from suppliers where name='Bahari Pharmacy'), (select id from branches where name='Mars Pharmacy Store 3'), 60, 18, 8800, '2027-01-16', 'Quarantine', 'quarantined'),
  ((select id from products where sku='MED-00845'), 'VTC-2604', (select id from suppliers where name='Salama Medical'), (select id from branches where name='Mars Pharmacy Store 3'), 200, 120, 6400, '2027-05-01', 'A-05-01', 'active'),
  ((select id from products where sku='MED-00846'), 'CFX-3108', (select id from suppliers where name='Salama Medical'), (select id from branches where name='Mars Pharmacy Store 3'), 100, 42, 18200, '2026-08-22', 'B-02-01', 'active'),
  ((select id from products where sku='MED-00847'), 'OMP-3301', (select id from suppliers where name='Salama Medical'), (select id from branches where name='Mars Pharmacy Store 3'), 200, 150, 7000, '2027-07-01', 'A-05-02', 'active'),
  ((select id from products where sku='MED-00848'), 'CTZ-0281', (select id from suppliers where name='Afya Supplies'), (select id from branches where name='Mars Pharmacy Store 3'), 200, 160, 4500, '2027-09-01', 'A-05-03', 'active'),
  ((select id from products where sku='SUP-00214'), 'ISR-5011', (select id from suppliers where name='Afya Supplies'), (select id from branches where name='Mars Pharmacy Store 3'), 20, -2, 350, null, 'E-01-01', 'negative');

-- Customers
insert into customers (name, phone, segment, loyalty_points, credit_balance) values
  ('Amina Hassan', '+255 754 118 290', 'Loyalty', 1240, 0),
  ('Juma Rashid', '+255 713 820 114', 'Credit', 640, 84000),
  ('Grace Mushi', '+255 782 441 905', 'Loyalty', 1860, 0),
  ('Salma Omar', '+255 655 392 840', 'Credit', 420, 25000);

-- Employees (staff, no login access yet; the admin account is linked to a real
-- auth.users row by a separate migration once that user exists)
insert into employees (full_name, username, email, role, branch_id, approval_limit, status) values
  ('Neema Joseph', 'neema.j', 'neema.j@marspharmacy.com', 'cashier', (select id from branches where name='Mars Pharmacy Store 3'), 25000, 'active'),
  ('Moses Daniel', 'moses.d', 'moses.d@marspharmacy.com', 'inventory_manager', (select id from branches where name='Mars Pharmacy Store 3'), 500, 'active'),
  ('Peter Michael', 'peter.m', 'peter.m@marspharmacy.com', 'purchase_manager', (select id from branches where name='Mars Pharmacy Store 2'), 10000000, 'active'),
  ('Grace Paulo', 'grace.p', 'grace.p@marspharmacy.com', 'accountant', null, 2000000, 'active'),
  ('Alice Ngowi', 'alice.n', 'alice.n@marspharmacy.com', 'inventory_manager', (select id from branches where name='Mars Pharmacy Store 3'), 500, 'active'),
  ('Sarah Komba', 'sarah.k', 'sarah.k@marspharmacy.com', 'cashier', (select id from branches where name='Mars Pharmacy Store 3'), 25000, 'active'),
  ('Kelvin Macha', 'kelvin.m', 'kelvin.m@marspharmacy.com', 'cashier', (select id from branches where name='Mars Pharmacy Store 3'), 25000, 'active');

-- Sales + sale items
insert into sales (invoice_number, customer_id, cashier_id, branch_id, payment_method, subtotal, discount, tax, total, status, sold_at) values
  ('INV-2026-08042', null, (select id from employees where username='kelvin.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'M-Pesa', 28000, 0, 0, 28000, 'completed', '2026-07-20 11:10:00+03'),
  ('INV-2026-08171', null, (select id from employees where username='sarah.k'), (select id from branches where name='Mars Pharmacy Store 3'), 'Cash', 18500, 0, 0, 18500, 'returned', '2026-08-03 12:16:00+03'),
  ('INV-2026-08172', (select id from customers where name='Grace Mushi'), (select id from employees where username='kelvin.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'Bank', 112000, 0, 0, 112000, 'completed', '2026-08-03 12:24:00+03'),
  ('INV-2026-08173', (select id from customers where name='Juma Rashid'), (select id from employees where username='neema.j'), (select id from branches where name='Mars Pharmacy Store 3'), 'Selcom', 84200, 0, 0, 84200, 'completed', '2026-08-03 12:31:00+03'),
  ('INV-2026-08174', (select id from customers where name='Amina Hassan'), (select id from employees where username='kelvin.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'Cash', 26000, 0, 0, 26000, 'completed', '2026-08-03 12:38:00+03'),
  ('INV-2026-08175', null, (select id from employees where username='neema.j'), (select id from branches where name='Mars Pharmacy Store 3'), 'M-Pesa', 48500, 0, 0, 48500, 'completed', '2026-08-03 12:42:00+03');

insert into sale_items (sale_id, product_id, batch_id, quantity, unit_price, discount, line_total) values
  ((select id from sales where invoice_number='INV-2026-08042'), (select id from products where sku='MED-00845'), (select id from product_batches where batch_number='VTC-2604'), 2, 14000, 0, 28000),
  ((select id from sales where invoice_number='INV-2026-08171'), (select id from products where sku='MED-00848'), (select id from product_batches where batch_number='CTZ-0281'), 1, 9000, 0, 9000),
  ((select id from sales where invoice_number='INV-2026-08171'), (select id from products where sku='MED-00041'), (select id from product_batches where batch_number='PCM-24081'), 2, 4750, 0, 9500),
  ((select id from sales where invoice_number='INV-2026-08172'), (select id from products where sku='MED-00214'), null, 3, 35000, 8000, 97000),
  ((select id from sales where invoice_number='INV-2026-08172'), (select id from products where sku='MED-00041'), (select id from product_batches where batch_number='PCM-24081'), 3, 5000, 0, 15000),
  ((select id from sales where invoice_number='INV-2026-08173'), (select id from products where sku='MED-00215'), (select id from product_batches where batch_number='AMX-5500'), 6, 14000, 0, 84000),
  ((select id from sales where invoice_number='INV-2026-08174'), (select id from products where sku='MED-00845'), (select id from product_batches where batch_number='VTC-2604'), 1, 14000, 0, 14000),
  ((select id from sales where invoice_number='INV-2026-08174'), (select id from products where sku='MED-00847'), (select id from product_batches where batch_number='OMP-3301'), 1, 14000, 2000, 12000),
  ((select id from sales where invoice_number='INV-2026-08175'), (select id from products where sku='MED-00041'), (select id from product_batches where batch_number='PCM-24081'), 2, 5000, 0, 10000),
  ((select id from sales where invoice_number='INV-2026-08175'), (select id from products where sku='MED-00845'), (select id from product_batches where batch_number='VTC-2604'), 2, 14000, 500, 27500);

-- Purchase orders + items
insert into purchase_orders (po_number, supplier_id, created_by, branch_id, status, expected_date, total) values
  ('PO-2026-0078', (select id from suppliers where name='Afya Supplies'), (select id from employees where username='alice.n'), (select id from branches where name='Mars Pharmacy Store 3'), 'approved', '2026-08-01', 6104000),
  ('PO-2026-0079', (select id from suppliers where name='Salama Medical'), (select id from employees where username='peter.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'partially_received', '2026-08-03', 3715000),
  ('PO-2026-0080', (select id from suppliers where name='Bahari Pharmacy'), (select id from employees where username='alice.n'), (select id from branches where name='Mars Pharmacy Store 3'), 'approved', '2026-08-05', 4280500),
  ('PO-2026-0081', (select id from suppliers where name='Phillips Pharma'), (select id from employees where username='peter.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'pending_approval', '2026-08-06', 8460000);

insert into purchase_order_items (po_id, product_id, quantity, unit_cost) values
  ((select id from purchase_orders where po_number='PO-2026-0078'), (select id from products where sku='SUP-00214'), 500, 350),
  ((select id from purchase_orders where po_number='PO-2026-0078'), (select id from products where sku='MED-00442'), 130, 3200),
  ((select id from purchase_orders where po_number='PO-2026-0079'), (select id from products where sku='MED-00846'), 100, 18200),
  ((select id from purchase_orders where po_number='PO-2026-0079'), (select id from products where sku='MED-00847'), 85, 7000),
  ((select id from purchase_orders where po_number='PO-2026-0080'), (select id from products where sku='MED-00128'), 120, 9500),
  ((select id from purchase_orders where po_number='PO-2026-0080'), (select id from products where sku='MED-00729'), 140, 8800),
  ((select id from purchase_orders where po_number='PO-2026-0081'), (select id from products where sku='MED-00214'), 200, 24000),
  ((select id from purchase_orders where po_number='PO-2026-0081'), (select id from products where sku='MED-00397'), 220, 7200);

-- Received orders + items
insert into received_orders (grn_number, po_id, supplier_invoice_number, received_by, status) values
  ('GRN-0042', (select id from purchase_orders where po_number='PO-2026-0078'), 'AF-45610', (select id from employees where username='alice.n'), 'variance'),
  ('GRN-0043', (select id from purchase_orders where po_number='PO-2026-0081'), 'PP-11290', (select id from employees where username='moses.d'), 'complete'),
  ('GRN-0044', (select id from purchase_orders where po_number='PO-2026-0080'), 'BP-31058', (select id from employees where username='alice.n'), 'complete'),
  ('GRN-0045', (select id from purchase_orders where po_number='PO-2026-0079'), 'SM-88214', (select id from employees where username='moses.d'), 'partial');

insert into received_order_items (grn_id, product_id, batch_id, quantity_ordered, quantity_received, unit_cost, damaged_qty) values
  ((select id from received_orders where grn_number='GRN-0042'), (select id from products where sku='SUP-00214'), (select id from product_batches where batch_number='ISR-5011'), 500, 205, 350, 3),
  ((select id from received_orders where grn_number='GRN-0043'), (select id from products where sku='MED-00214'), null, 200, 204, 24000, 0),
  ((select id from received_orders where grn_number='GRN-0044'), (select id from products where sku='MED-00128'), (select id from product_batches where batch_number='MTF-2409'), 120, 120, 9500, 0),
  ((select id from received_orders where grn_number='GRN-0045'), (select id from products where sku='MED-00846'), (select id from product_batches where batch_number='CFX-3108'), 100, 146, 18200, 0);

-- Returns
insert into returns (reference, type, original_sale_id, original_po_id, product_id, batch_id, quantity, reason, refund_method, requested_by, status) values
  ('RET-2026-0179', 'supplier', null, (select id from purchase_orders where po_number='PO-2026-0079'), (select id from products where sku='MED-00846'), (select id from product_batches where batch_number='CFX-3108'), 12, 'Near expiry', 'Supplier return', (select id from employees where username='peter.m'), 'approved'),
  ('RET-2026-0180', 'customer', (select id from sales where invoice_number='INV-2026-08042'), null, (select id from products where sku='MED-00845'), (select id from product_batches where batch_number='VTC-2604'), 2, 'Customer request', 'M-Pesa', (select id from employees where username='kelvin.m'), 'review'),
  ('RET-2026-0181', 'supplier', null, (select id from purchase_orders where po_number='PO-2026-0078'), (select id from products where sku='SUP-00214'), (select id from product_batches where batch_number='ISR-5011'), 3, 'Damaged delivery', 'Supplier credit', (select id from employees where username='moses.d'), 'pending'),
  ('RET-2026-0182', 'customer', (select id from sales where invoice_number='INV-2026-08171'), null, (select id from products where sku='MED-00848'), (select id from product_batches where batch_number='CTZ-0281'), 1, 'Incorrect item', 'Cash', (select id from employees where username='sarah.k'), 'approved');

-- Expenses
insert into expenses (reference, description, category_id, vendor, amount, payment_method, branch_id, created_by, status, is_recurring, created_at) values
  ('EXP-0415', 'Pharmacy licence renewal', (select id from expense_categories where name='Compliance'), 'Municipal Council', 350000, 'Bank', (select id from branches where name='Mars Pharmacy Store 3'), (select id from employees where username='grace.p'), 'pending', false, '2026-07-30 09:00:00+03'),
  ('EXP-0416', 'Receipt paper', (select id from expense_categories where name='Supplies'), 'Office Mart', 9000, 'Cash', (select id from branches where name='Mars Pharmacy Store 3'), (select id from employees where username='neema.j'), 'approved', false, '2026-08-02 10:00:00+03'),
  ('EXP-0417', 'Local delivery', (select id from expense_categories where name='Transport'), 'Kasi Courier', 12500, 'M-Pesa', (select id from branches where name='Mars Pharmacy Store 3'), (select id from employees where username='grace.p'), 'approved', false, '2026-08-03 08:30:00+03'),
  ('EXP-0418', 'Generator fuel', (select id from expense_categories where name='Utilities'), 'Total Energies', 30000, 'Cash', (select id from branches where name='Mars Pharmacy Store 3'), (select id from employees where username='grace.p'), 'approved', true, '2026-08-03 07:45:00+03');

-- Notifications
insert into notifications (type, title, message, is_read, created_at) values
  ('Inventory', 'Ventolin Inhaler is out of stock', 'Create an urgent purchase order for Store 3.', false, now() - interval '2 minutes'),
  ('Expiry', '8 batches expire within 30 days', 'Estimated exposure is TZS 642,000.', false, now() - interval '18 minutes'),
  ('Approval', 'PO-2026-0081 awaits approval', 'Peter M. requested TZS 8,460,000.', false, now() - interval '1 hour'),
  ('Supplier order', 'PO-2026-0078 is delayed', 'Afya Supplies missed the expected delivery date.', true, now() - interval '2 hours'),
  ('Security', 'New administrator session', 'Signed in from Chrome on Windows at Store 3.', true, now() - interval '4 hours'),
  ('System', 'Daily backup completed', 'Frontend demo event—no real backup was performed.', true, now() - interval '7 hours');

-- Approval tasks
insert into approval_tasks (type, reference_id, requested_by, branch_id, amount, description, status, created_at) values
  ('purchase_order', (select id from purchase_orders where po_number='PO-2026-0081'), (select id from employees where username='peter.m'), (select id from branches where name='Mars Pharmacy Store 3'), 8460000, 'Purchase order approval', 'pending', '2026-08-03 11:30:00+03'),
  ('discount', null, (select id from employees where username='neema.j'), (select id from branches where name='Mars Pharmacy Store 3'), 18500, 'Discount approval', 'pending', '2026-08-03 10:58:00+03'),
  ('price_change', null, (select id from employees where username='alice.n'), (select id from branches where name='Mars Pharmacy Store 3'), null, '12 products', 'review', '2026-08-03 10:15:00+03'),
  ('stock_adjustment', null, (select id from employees where username='moses.d'), (select id from branches where name='Mars Pharmacy Store 3'), null, '-14 units', 'pending', '2026-08-03 09:42:00+03'),
  ('refund', (select id from sales where invoice_number='INV-2026-08171'), (select id from employees where username='kelvin.m'), (select id from branches where name='Mars Pharmacy Store 3'), 36500, 'Customer refund', 'pending', '2026-08-03 09:20:00+03'),
  ('supplier_return', (select id from returns where reference='RET-2026-0181'), (select id from employees where username='peter.m'), (select id from branches where name='Mars Pharmacy Store 3'), null, '28 units', 'review', '2026-08-02 16:40:00+03'),
  ('disposal', null, (select id from employees where username='moses.d'), (select id from branches where name='Mars Pharmacy Store 3'), 214000, 'Expiry disposal', 'pending', '2026-08-02 15:26:00+03');

-- Audit logs
insert into audit_logs (employee_id, action, module, record_reference, reason, branch_id, session_ref, created_at) values
  ((select id from employees where username='neema.j'), 'Sale created', 'Sales', 'INV-2026-08175', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-9F2A', '2026-08-03 12:42:00+03'),
  ((select id from employees where username='alice.n'), 'Product added', 'Products', 'MED-01487', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-9F2A', '2026-08-03 12:20:00+03'),
  (null, 'Price changed', 'Products', 'MED-00214', 'Supplier price update', (select id from branches where name='Mars Pharmacy Store 3'), 'S-9F2A', '2026-08-03 11:58:00+03'),
  ((select id from employees where username='moses.d'), 'Stock received', 'Inventory', 'GRN-2026-0045', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-4C81', '2026-08-03 11:32:00+03'),
  (null, 'Purchase order approved', 'Purchasing', 'PO-2026-0080', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-6A32', '2026-08-03 11:05:00+03'),
  ((select id from employees where username='grace.p'), 'Expense added', 'Expenses', 'EXP-2026-0418', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-2B71', '2026-08-03 10:44:00+03'),
  ((select id from employees where username='kelvin.m'), 'Transaction reversed', 'Sales', 'INV-2026-08143', 'Duplicate charge', (select id from branches where name='Mars Pharmacy Store 3'), 'S-8D10', '2026-08-03 10:16:00+03'),
  ((select id from employees where username='moses.d'), 'Stock transferred', 'Inventory', 'TRF-2026-0094', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-4C81', '2026-08-03 09:52:00+03'),
  ((select id from employees where username='sarah.k'), 'Customer created', 'Customers', 'CUS-00248', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-1A55', '2026-08-03 09:17:00+03');

-- Settings (global, branch_id null)
insert into settings (branch_id, key, value) values
  (null, 'pharmacy_profile', '{"name":"Mars Pharmacy","email":"admin@marspharmacy.com","phone":"+255 754 000 318","address":"Masaki, Dar es Salaam, Tanzania","currency":"TZS","tax_mode":"Inclusive"}'),
  (null, 'toggles', '{"prevent_expired_sales":true,"use_fefo":true,"require_reversal_approval":true,"send_low_stock_alerts":true,"detailed_audit_history":true,"auto_backup_schedule":true}');

-- ===== 0004_seed_admin_employee.sql =====
-- Links the real Supabase Auth admin user (created via the Auth Admin API)
-- to its employees record. branch_id null = all-branch access; approval_limit
-- null = unlimited, matching "Administrator" in the former mock data.
insert into employees (auth_user_id, full_name, username, email, role, branch_id, approval_limit, status)
values (
  'c1ab760c-e4dd-4bb3-a240-2ce92f5467cc',
  'Admin Mars',
  'admin',
  'admin@marspharmacy.com',
  'administrator',
  null,
  null,
  'active'
);

-- ===== 0005_ai_embeddings.sql =====
-- AI features: semantic search / RAG store for products, customers, suppliers.
-- Installed into `extensions`, matching this project's existing convention
-- for pgcrypto/uuid-ossp/pg_stat_statements (not `public`). Everything below
-- schema-qualifies the vector type/operator/opclass explicitly rather than
-- relying on search_path, since a bare `SET search_path` does not reliably
-- carry over between statements when migrations run through some tooling.
create extension if not exists vector with schema extensions;

create table document_embeddings (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in ('products', 'customers', 'suppliers')),
  source_id uuid not null,
  content text not null,
  embedding extensions.vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding_model text not null default 'text-embedding-3-small',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_id)
);

create index document_embeddings_source_idx on document_embeddings (source_table, source_id);

-- HNSW over IVFFlat: rows arrive one at a time via best-effort re-embeds on
-- every insert (not a bulk load), and HNSW needs no upfront "lists" training
-- step and degrades gracefully as the table grows.
create index document_embeddings_embedding_hnsw_idx
  on document_embeddings using hnsw (embedding extensions.vector_cosine_ops);

alter table document_embeddings enable row level security;
create policy "authenticated_full_access" on document_embeddings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- 0002_rls.sql's table loop already ran and won't retroactively cover this
-- new table, so the same blanket-authenticated convention is replicated here.

create or replace function match_documents(
  query_embedding extensions.vector(1536),
  match_source_tables text[] default null,
  match_count int default 8,
  match_threshold float default 0.3
)
returns table (
  id uuid,
  source_table text,
  source_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
set search_path = 'public, extensions'
as $$
  select
    de.id, de.source_table, de.source_id, de.content, de.metadata,
    1 - (de.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.document_embeddings de
  where (match_source_tables is null or de.source_table = any(match_source_tables))
    and 1 - (de.embedding OPERATOR(extensions.<=>) query_embedding) >= match_threshold
  order by de.embedding OPERATOR(extensions.<=>) query_embedding
  limit match_count;
$$;

-- ===== 0006_erp_foundation.sql =====
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

-- ===== 0007_erp_rls.sql =====
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

-- ===== 0008_erp_stock_rpcs.sql =====
-- ERP Phase 1: transactional stock operations.
-- Every stock-changing operation is a single Postgres function: it locks the
-- batch rows it touches, validates permissions/entity access/business rules,
-- writes the ledger with balance-after, and either fully commits or fully
-- rolls back. App code must never write quantity_available directly for
-- sales/confirmation flows.

-- ---------------------------------------------------------------------------
-- Internal: post one ledger movement against a locked batch.
-- Not callable by clients (execute revoked below).
-- ---------------------------------------------------------------------------
create or replace function fn_post_movement(
  p_batch_id uuid,
  p_delta int,
  p_type text,
  p_ref_type text,
  p_ref_id uuid,
  p_ref_number text,
  p_reason text,
  p_employee uuid,
  p_allow_negative boolean default false
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  new_qty int;
begin
  select * into b from product_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Batch not found.';
  end if;

  new_qty := b.quantity_available + p_delta;
  if new_qty < 0 and not p_allow_negative then
    raise exception 'Insufficient stock in batch %: % available, % requested.',
      b.batch_number, b.quantity_available, -p_delta;
  end if;

  update product_batches set quantity_available = new_qty where id = p_batch_id;

  insert into stock_movements (
    product_id, batch_id, branch_id, movement_type, quantity_delta,
    balance_after, reference_type, reference_id, reference_number, reason, created_by
  ) values (
    b.product_id, p_batch_id, b.branch_id, p_type, p_delta,
    new_qty, p_ref_type, p_ref_id, p_ref_number, p_reason, p_employee
  );

  return new_qty;
end $$;

revoke execute on function fn_post_movement(uuid,int,text,text,uuid,text,text,uuid,boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal: current employee row, or raise.
-- ---------------------------------------------------------------------------
create or replace function fn_current_employee()
returns employees
language plpgsql
stable
security definer
set search_path = public
as $$
declare e employees;
begin
  select * into e from employees
  where auth_user_id = auth.uid() and status = 'active'
  limit 1;
  if e.id is null then
    raise exception 'No active employee account for this login.';
  end if;
  return e;
end $$;

revoke execute on function fn_current_employee() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Complete a sale atomically.
-- payload: {
--   customer_id: uuid|null, payment_method: text, discount: numeric,
--   items: [{product_id, batch_id, quantity, discount}]
-- }
-- Prices always come from the product record (never from the client).
-- ---------------------------------------------------------------------------
create or replace function erp_complete_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees;
  v_item jsonb;
  v_batch record;
  v_product record;
  v_branch uuid;
  v_customer uuid;
  v_prevent_expired boolean;
  v_subtotal numeric := 0;
  v_item_discounts numeric := 0;
  v_cart_discount numeric := coalesce((p->>'discount')::numeric, 0);
  v_total_discount numeric;
  v_total numeric;
  v_sale_id uuid;
  v_invoice text;
  v_qty int;
  v_line_disc numeric;
  v_line_amount numeric;
  v_points int;
begin
  v_emp := fn_current_employee();
  if not has_perm('create_sales') then
    raise exception 'You do not have permission to create sales.';
  end if;

  if p->'items' is null or jsonb_array_length(p->'items') = 0 then
    raise exception 'Cart is empty.';
  end if;
  if v_cart_discount < 0 then
    raise exception 'Discount cannot be negative.';
  end if;

  -- First pass: validate and lock every batch, derive totals from DB prices.
  for v_item in select * from jsonb_array_elements(p->'items')
  loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    v_line_disc := coalesce((v_item->>'discount')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Quantities must be positive.';
    end if;
    if v_line_disc < 0 then
      raise exception 'Discount cannot be negative.';
    end if;

    select * into v_batch from product_batches
      where id = (v_item->>'batch_id')::uuid for update;
    if not found then
      raise exception 'Batch not found.';
    end if;
    if v_batch.product_id <> (v_item->>'product_id')::uuid then
      raise exception 'Batch does not belong to the selected product.';
    end if;
    if v_batch.status <> 'active' then
      raise exception 'Batch % is not sellable (status %).', v_batch.batch_number, v_batch.status;
    end if;
    if not has_entity_access(v_batch.branch_id) then
      raise exception 'You cannot sell stock that belongs to another entity.';
    end if;

    if v_branch is null then
      v_branch := v_batch.branch_id;
    elsif v_branch <> v_batch.branch_id then
      raise exception 'All items in one sale must belong to the same entity.';
    end if;

    if v_batch.quantity_available < v_qty then
      raise exception 'Not enough stock in batch %: % available.',
        v_batch.batch_number, v_batch.quantity_available;
    end if;

    -- Optional expired-stock block (per-entity toggle falls back to global).
    select coalesce(
      (select (value->>'prevent_expired_sales')::boolean from settings
        where key = 'toggles' and branch_id = v_batch.branch_id),
      (select (value->>'prevent_expired_sales')::boolean from settings
        where key = 'toggles' and branch_id is null),
      false
    ) into v_prevent_expired;
    if v_prevent_expired and v_batch.expiry_date is not null
       and v_batch.expiry_date < current_date then
      raise exception 'Batch % expired on % and cannot be sold.',
        v_batch.batch_number, v_batch.expiry_date;
    end if;

    select * into v_product from products where id = v_batch.product_id;
    if v_product.status <> 'active' then
      raise exception 'Product % is not active.', v_product.name;
    end if;

    v_line_amount := v_product.sell_price * v_qty;
    if v_line_disc > 0 and v_product.max_discount_percent > 0
       and v_line_disc > v_line_amount * v_product.max_discount_percent / 100 then
      raise exception 'Discount on % exceeds the product limit of % percent.',
        v_product.name, v_product.max_discount_percent;
    end if;

    v_subtotal := v_subtotal + v_line_amount;
    v_item_discounts := v_item_discounts + v_line_disc;
  end loop;

  v_total_discount := v_item_discounts + v_cart_discount;
  if v_total_discount > 0 then
    if not has_perm('apply_discount') then
      raise exception 'You do not have permission to apply discounts.';
    end if;
    if v_subtotal <= 0 or v_total_discount > v_subtotal * v_emp.max_discount_percent / 100 then
      raise exception 'Discount exceeds your authorised limit of % percent.',
        v_emp.max_discount_percent;
    end if;
  end if;
  v_total := greatest(0, v_subtotal - v_total_discount);

  -- Customer must belong to the same entity.
  v_customer := nullif(p->>'customer_id', '')::uuid;
  if v_customer is not null then
    if not exists (select 1 from customers c
                   where c.id = v_customer and c.branch_id = v_branch) then
      raise exception 'Customer belongs to a different entity.';
    end if;
  end if;

  v_invoice := next_doc_number('INV', 'doc_seq_sale');

  insert into sales (invoice_number, customer_id, cashier_id, branch_id,
                     payment_method, subtotal, discount, tax, total, status)
  values (v_invoice, v_customer, v_emp.id, v_branch,
          p->>'payment_method', v_subtotal, v_total_discount, 0, v_total, 'completed')
  returning id into v_sale_id;

  -- Second pass: items + ledger (batches already locked above).
  for v_item in select * from jsonb_array_elements(p->'items')
  loop
    v_qty := (v_item->>'quantity')::int;
    v_line_disc := coalesce((v_item->>'discount')::numeric, 0);
    select p2.sell_price into v_line_amount
      from products p2 where p2.id = (v_item->>'product_id')::uuid;

    insert into sale_items (sale_id, product_id, batch_id, quantity,
                            unit_price, discount, line_total)
    values (v_sale_id, (v_item->>'product_id')::uuid, (v_item->>'batch_id')::uuid,
            v_qty, v_line_amount, v_line_disc, v_line_amount * v_qty - v_line_disc);

    perform fn_post_movement(
      (v_item->>'batch_id')::uuid, -v_qty, 'sale', 'sale', v_sale_id,
      v_invoice, null, v_emp.id);
  end loop;

  v_points := floor(v_total / 1000);
  if v_customer is not null and v_points > 0 then
    update customers set loyalty_points = loyalty_points + v_points
      where id = v_customer;
  end if;

  insert into audit_logs (employee_id, action, module, record_reference, branch_id)
  values (v_emp.id, 'Sale created', 'Sales', v_invoice, v_branch);

  return jsonb_build_object('sale_id', v_sale_id, 'invoice_number', v_invoice,
                            'total', v_total);
end $$;

-- ---------------------------------------------------------------------------
-- Reverse (cancel) a completed sale: reversal ledger movements, never deletes.
-- ---------------------------------------------------------------------------
create or replace function erp_reverse_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees;
  v_sale record;
  v_item record;
begin
  v_emp := fn_current_employee();
  if not has_perm('cancel_sales') then
    raise exception 'You do not have permission to cancel sales.';
  end if;

  select * into v_sale from sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found.';
  end if;
  if not has_entity_access(v_sale.branch_id) then
    raise exception 'This sale belongs to another entity.';
  end if;
  if v_sale.status <> 'completed' then
    raise exception 'Only completed sales can be reversed.';
  end if;

  for v_item in select * from sale_items where sale_id = p_sale_id
  loop
    if v_item.batch_id is not null then
      perform fn_post_movement(
        v_item.batch_id, v_item.quantity, 'sale_reversal', 'sale_reversal',
        p_sale_id, v_sale.invoice_number, p_reason, v_emp.id);
    end if;
  end loop;

  update sales
  set status = 'reversed', reversed_by = v_emp.id, reversed_at = now(),
      reversal_reason = nullif(trim(p_reason), '')
  where id = p_sale_id;

  insert into audit_logs (employee_id, action, module, record_reference,
                          reason, branch_id)
  values (v_emp.id, 'Sale reversed', 'Sales', v_sale.invoice_number,
          nullif(trim(p_reason), ''), v_sale.branch_id);

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Confirm a stock-inward document: creates batches + ledger, marks confirmed.
-- ---------------------------------------------------------------------------
create or replace function erp_confirm_stock_inward(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees;
  v_doc record;
  v_item record;
  v_batch_id uuid;
  v_paid_type text;
  v_batches int := 0;
begin
  v_emp := fn_current_employee();
  if not has_perm('create_stock_inward') then
    raise exception 'You do not have permission to confirm stock inward.';
  end if;

  select * into v_doc from stock_inwards where id = p_id for update;
  if not found then
    raise exception 'Stock inward document not found.';
  end if;
  if not has_entity_access(v_doc.branch_id) then
    raise exception 'This document belongs to another entity.';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'Only draft documents can be confirmed.';
  end if;
  if not exists (select 1 from stock_inward_items where inward_id = p_id) then
    raise exception 'Add at least one line item before confirming.';
  end if;

  v_paid_type := case v_doc.inward_type
    when 'purchase_from_parent' then 'purchase'
    when 'purchase_from_external' then 'purchase'
    when 'foc_or_sample' then 'foc'
    when 'replacement_in' then 'replacement_in'
  end;

  for v_item in select * from stock_inward_items where inward_id = p_id
  loop
    insert into product_batches (
      product_id, batch_number, supplier_id, branch_id,
      quantity_received, quantity_available, unit_cost, expiry_date,
      status, source_type, source_id
    ) values (
      v_item.product_id, v_item.batch_number, v_doc.supplier_id, v_doc.branch_id,
      v_item.quantity + v_item.free_quantity, 0, v_item.unit_cost, v_item.expiry_date,
      'active', 'stock_inward', v_doc.id
    ) returning id into v_batch_id;

    if v_item.quantity > 0 then
      perform fn_post_movement(v_batch_id, v_item.quantity, v_paid_type,
        'stock_inward', v_doc.id, v_doc.reference, null, v_emp.id);
    end if;
    -- Free goods stay identifiable in the ledger as FOC even on purchases.
    if v_item.free_quantity > 0 then
      perform fn_post_movement(v_batch_id, v_item.free_quantity, 'foc',
        'stock_inward', v_doc.id, v_doc.reference, null, v_emp.id);
    end if;

    update stock_inward_items set batch_id = v_batch_id where id = v_item.id;
    v_batches := v_batches + 1;
  end loop;

  update stock_inwards
  set status = 'confirmed', confirmed_by = v_emp.id, confirmed_at = now()
  where id = p_id;

  insert into audit_logs (employee_id, action, module, record_reference, branch_id)
  values (v_emp.id, 'Stock inward confirmed (' || v_doc.inward_type || ')',
          'Inventory', v_doc.reference, v_doc.branch_id);

  return jsonb_build_object('ok', true, 'reference', v_doc.reference,
                            'batches', v_batches);
end $$;

-- ---------------------------------------------------------------------------
-- Confirm an opening-stock entry: creates batches + ledger, locks the entry.
-- ---------------------------------------------------------------------------
create or replace function erp_confirm_opening_stock(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees;
  v_doc record;
  v_item record;
  v_batch_id uuid;
  v_batches int := 0;
begin
  v_emp := fn_current_employee();
  if not has_perm('create_stock_inward') then
    raise exception 'You do not have permission to confirm opening stock.';
  end if;

  select * into v_doc from opening_stock_entries where id = p_id for update;
  if not found then
    raise exception 'Opening stock entry not found.';
  end if;
  if not has_entity_access(v_doc.branch_id) then
    raise exception 'This entry belongs to another entity.';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'Only draft entries can be confirmed.';
  end if;
  if not exists (select 1 from opening_stock_items where entry_id = p_id) then
    raise exception 'Add at least one line item before confirming.';
  end if;

  for v_item in select * from opening_stock_items where entry_id = p_id
  loop
    insert into product_batches (
      product_id, batch_number, branch_id,
      quantity_received, quantity_available, unit_cost, expiry_date,
      status, source_type, source_id
    ) values (
      v_item.product_id, v_item.batch_number, v_doc.branch_id,
      v_item.quantity, 0, v_item.unit_cost, v_item.expiry_date,
      'active', 'opening_stock', v_doc.id
    ) returning id into v_batch_id;

    perform fn_post_movement(v_batch_id, v_item.quantity, 'opening_stock',
      'opening_stock', v_doc.id, v_doc.reference, null, v_emp.id);

    update opening_stock_items set batch_id = v_batch_id where id = v_item.id;
    v_batches := v_batches + 1;
  end loop;

  update opening_stock_entries
  set status = 'confirmed', confirmed_by = v_emp.id, confirmed_at = now()
  where id = p_id;

  insert into audit_logs (employee_id, action, module, record_reference, branch_id)
  values (v_emp.id, 'Opening stock confirmed', 'Inventory', v_doc.reference,
          v_doc.branch_id);

  return jsonb_build_object('ok', true, 'reference', v_doc.reference,
                            'batches', v_batches);
end $$;

-- ---------------------------------------------------------------------------
-- Approve a stock-out document (returns row): moves stock with approval.
-- customer returns add stock back; all other types remove stock.
-- ---------------------------------------------------------------------------
create or replace function erp_approve_stock_out(p_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees;
  v_doc record;
  v_type text;
  v_delta int;
  v_balance int;
begin
  v_emp := fn_current_employee();
  if not has_perm('approve_stock_outward') then
    raise exception 'You do not have permission to approve stock-out documents.';
  end if;

  select * into v_doc from returns where id = p_return_id for update;
  if not found then
    raise exception 'Record not found.';
  end if;
  if not has_entity_access(v_doc.branch_id) then
    raise exception 'This record belongs to another entity.';
  end if;
  if v_doc.status <> 'pending' then
    raise exception 'Only pending records can be approved.';
  end if;
  if v_doc.batch_id is null then
    raise exception 'Select a batch on this record before approving.';
  end if;
  if v_doc.quantity <= 0 then
    raise exception 'Quantity must be positive.';
  end if;

  v_type := case v_doc.type
    when 'customer' then 'return'
    when 'supplier' then 'supplier_return'
    when 'damaged' then 'damage'
    when 'expired' then 'expiry'
    when 'employee_consumption' then 'employee_consumption'
  end;
  v_delta := case when v_doc.type = 'customer' then v_doc.quantity
                  else -v_doc.quantity end;

  v_balance := fn_post_movement(v_doc.batch_id, v_delta, v_type,
    'return', v_doc.id, v_doc.reference, v_doc.reason, v_emp.id);

  update returns
  set status = 'approved', approved_by = v_emp.id, approved_at = now()
  where id = p_return_id;

  insert into audit_logs (employee_id, action, module, record_reference,
                          reason, branch_id)
  values (v_emp.id, 'Stock-out approved (' || v_doc.type || ')', 'Returns',
          v_doc.reference, v_doc.reason, v_doc.branch_id);

  return jsonb_build_object('ok', true, 'balance_after', v_balance);
end $$;

-- ---------------------------------------------------------------------------
-- Stock correction: privileged direct quantity fix with mandatory reason.
-- ---------------------------------------------------------------------------
create or replace function erp_stock_correction(
  p_batch_id uuid, p_new_qty int, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees;
  v_batch record;
  v_ref text;
  v_delta int;
begin
  v_emp := fn_current_employee();
  if not has_perm('adjust_inventory') then
    raise exception 'You do not have permission to correct stock.';
  end if;
  if p_new_qty < 0 then
    raise exception 'Stock cannot be corrected to a negative quantity.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required for stock corrections.';
  end if;

  select * into v_batch from product_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Batch not found.';
  end if;
  if not has_entity_access(v_batch.branch_id) then
    raise exception 'This batch belongs to another entity.';
  end if;

  v_delta := p_new_qty - v_batch.quantity_available;
  if v_delta = 0 then
    raise exception 'The new quantity equals the current quantity.';
  end if;

  v_ref := next_doc_number('COR', 'doc_seq_correction');
  perform fn_post_movement(p_batch_id, v_delta, 'stock_correction',
    'stock_correction', null, v_ref, trim(p_reason), v_emp.id);

  insert into audit_logs (employee_id, action, module, record_reference,
                          previous_value, new_value, reason, branch_id)
  values (v_emp.id, 'Stock correction', 'Inventory', v_ref,
          v_batch.quantity_available::text, p_new_qty::text, trim(p_reason),
          v_batch.branch_id);

  return jsonb_build_object('ok', true, 'reference', v_ref,
                            'balance_after', p_new_qty);
end $$;

grant execute on function erp_complete_sale(jsonb) to authenticated;
grant execute on function erp_reverse_sale(uuid, text) to authenticated;
grant execute on function erp_confirm_stock_inward(uuid) to authenticated;
grant execute on function erp_confirm_opening_stock(uuid) to authenticated;
grant execute on function erp_approve_stock_out(uuid) to authenticated;
grant execute on function erp_stock_correction(uuid, int, text) to authenticated;

-- ===== 0009_erp_function_grants.sql =====
-- Lock down function execution: Postgres grants EXECUTE on new functions to
-- PUBLIC by default, which exposes them to the anon role through PostgREST.
-- Every ERP function requires an authenticated employee anyway; this makes
-- that explicit at the privilege layer (flagged by Supabase security advisor).

revoke execute on function public.auth_employee_id() from public, anon;
revoke execute on function public.is_master() from public, anon;
revoke execute on function public.has_entity_access(uuid) from public, anon;
revoke execute on function public.has_perm(text) from public, anon;
revoke execute on function public.next_doc_number(text, text) from public, anon;

revoke execute on function public.erp_complete_sale(jsonb) from public, anon;
revoke execute on function public.erp_reverse_sale(uuid, text) from public, anon;
revoke execute on function public.erp_confirm_stock_inward(uuid) from public, anon;
revoke execute on function public.erp_confirm_opening_stock(uuid) from public, anon;
revoke execute on function public.erp_approve_stock_out(uuid) from public, anon;
revoke execute on function public.erp_stock_correction(uuid, int, text) from public, anon;

-- Trigger/internal functions need no caller at all.
revoke execute on function public.fn_employees_guard() from public, anon, authenticated;
revoke execute on function public.match_documents(extensions.vector, text[], int, float)
  from public, anon;
grant execute on function public.match_documents(extensions.vector, text[], int, float)
  to authenticated;

-- ===== 0010_erp_import_rpc.sql =====
-- Atomic product-import commit.
--
-- The import record and its draft rows must land together: if the drafts fail
-- after the import row is written, the (branch_id, kind, file_hash) unique
-- index would permanently block re-importing that file. Doing both in one
-- function makes the whole commit a single transaction, so there is no
-- compensating delete to get wrong (and no DELETE policy to widen).

create or replace function erp_commit_product_import(
  p_branch_id uuid,
  p_filename text,
  p_file_hash text,
  p_total_rows int,
  p_invalid_rows int,
  p_error_report jsonb,
  p_drafts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees;
  v_branch uuid := p_branch_id;
  v_import_id uuid;
  v_count int;
begin
  v_emp := fn_current_employee();
  if not has_perm('import_products') then
    raise exception 'You do not have permission to import products.';
  end if;

  if v_branch is null then
    raise exception 'Select a specific entity before importing.';
  end if;
  -- The caller supplies the active entity; confirm the user may write to it.
  if not has_entity_access(v_branch) then
    raise exception 'You do not have access to that entity.';
  end if;

  v_count := coalesce(jsonb_array_length(p_drafts), 0);
  if v_count = 0 then
    raise exception 'There are no valid rows to import.';
  end if;

  insert into product_imports (
    branch_id, filename, file_hash, kind, total_rows, valid_rows,
    invalid_rows, status, error_report, created_by
  ) values (
    v_branch, p_filename, p_file_hash, 'products', p_total_rows, v_count,
    p_invalid_rows, 'committed', coalesce(p_error_report, '[]'::jsonb), v_emp.id
  ) returning id into v_import_id;

  insert into draft_products (
    branch_id, import_id, name, sku, barcode, category_name, manufacturer,
    unit, supplier_name, buy_price, pricing_method, margin_percent, sell_price,
    max_discount_percent, reorder_level, restock_target, status
  )
  select
    v_branch,
    v_import_id,
    d->>'name',
    nullif(d->>'sku', ''),
    nullif(d->>'barcode', ''),
    nullif(d->>'categoryName', ''),
    nullif(d->>'manufacturer', ''),
    nullif(d->>'unit', ''),
    nullif(d->>'supplierName', ''),
    coalesce((d->>'buyPrice')::numeric, 0),
    coalesce(nullif(d->>'pricingMethod', ''), 'fixed'),
    coalesce((d->>'marginPercent')::numeric, 0),
    coalesce((d->>'sellPrice')::numeric, 0),
    coalesce((d->>'maxDiscountPercent')::numeric, 0),
    coalesce((d->>'reorderLevel')::int, 0),
    coalesce((d->>'restockTarget')::int, 0),
    'pending'
  from jsonb_array_elements(p_drafts) as d;

  insert into audit_logs (employee_id, action, module, record_reference, new_value, branch_id)
  values (
    v_emp.id, 'Product import confirmed', 'Products', p_filename,
    jsonb_build_object('total', p_total_rows, 'drafts', v_count, 'invalid', p_invalid_rows)::text,
    v_branch
  );

  return jsonb_build_object('import_id', v_import_id, 'drafts', v_count);
end $$;

revoke execute on function erp_commit_product_import(uuid, text, text, int, int, jsonb, jsonb)
  from public, anon;
grant execute on function erp_commit_product_import(uuid, text, text, int, int, jsonb, jsonb)
  to authenticated;

-- ===== 0011_permission_override_whitelist.sql =====
-- Audit finding CRIT-2: permission_overrides accepted any key, so anyone with
-- manage_users could grant master-tier permissions (manage_entities,
-- access_multiple_entities, manage_users) to themselves or to any user in
-- their entity. Overrides are now whitelisted by permission_catalog and the
-- whitelist is enforced twice: when an override is written (0012's trigger)
-- and again when it is read (has_perm, below), so a bad row can never take
-- effect even if it were planted by a backend job.

create table if not exists permission_catalog (
  permission  text primary key,
  overridable boolean not null default true
);

-- Master-tier permissions decide who may create entities, reach across
-- entities, or administer other users. They are role-only: to grant them,
-- change the role.
insert into permission_catalog (permission, overridable) values
  ('view_products', true),
  ('create_products', true),
  ('edit_products', true),
  ('import_products', true),
  ('view_inventory', true),
  ('adjust_inventory', true),
  ('create_stock_inward', true),
  ('create_stock_outward', true),
  ('approve_stock_outward', true),
  ('view_purchase_cost', true),
  ('manage_suppliers', true),
  ('create_sales', true),
  ('apply_discount', true),
  ('cancel_sales', true),
  ('view_profit', true),
  ('view_management_reports', true),
  ('manage_settings', true),
  ('generate_exports', true),
  ('manage_users', false),
  ('manage_entities', false),
  ('access_multiple_entities', false)
on conflict (permission) do update set overridable = excluded.overridable;

alter table permission_catalog enable row level security;

drop policy if exists "permission_catalog_select" on permission_catalog;
create policy "permission_catalog_select" on permission_catalog for select
  using (auth.role() = 'authenticated');

drop policy if exists "permission_catalog_write" on permission_catalog;
create policy "permission_catalog_write" on permission_catalog for all
  using (is_master()) with check (is_master());

-- Strip any master-tier override already stored, so the persisted state
-- matches the effective state and permission audits are not misleading.
update employees
set permission_overrides = permission_overrides
  - 'manage_users'::text - 'manage_entities'::text - 'access_multiple_entities'::text
where permission_overrides ?| array['manage_users','manage_entities','access_multiple_entities'];

-- has_perm honours an override only for a permission the catalogue marks
-- overridable. Unknown and master-tier keys fall back to the role template.
create or replace function public.has_perm(p text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select case
      when e.permission_overrides ? p
       and coalesce((select pc.overridable from permission_catalog pc
                     where pc.permission = p), false)
      then (e.permission_overrides ->> p)::boolean
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

grant execute on function public.has_perm(text) to authenticated;
revoke execute on function public.has_perm(text) from public, anon;

-- ===== 0012_employee_privilege_guard.sql =====
-- Audit finding CRIT-1: a user holding manage_users (every entity_admin) could
-- rewrite their OWN branch_id and permission_overrides. The RLS policy
-- employees_update passes its WITH CHECK through the `auth_user_id = auth.uid()`
-- self-clause, and the old guard only asked for manage_users — so an entity
-- admin could move themselves into another entity and read everything in it.
--
-- Three changes:
--   1. Nobody may change privilege-bearing columns on their own row, whatever
--      permissions they hold. This is the check that closes the escape.
--   2. Non-master privilege writes are confined to entities the actor can
--      already reach, in both the old and the new value. has_entity_access(null)
--      returns true, so null branches are rejected explicitly.
--   3. Re-pointing an employee at a different auth login is master-only, and
--      one login maps to at most one employee — otherwise an admin could graft
--      their own auth user onto a more privileged employee row and
--      fn_current_employee's `limit 1` could resolve to it.

create unique index if not exists employees_auth_user_id_key
  on employees(auth_user_id) where auth_user_id is not null;

create or replace function fn_employees_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_auth      uuid := auth.uid();
  v_actor_employee  uuid;
  v_check_overrides boolean;
  v_rejected        text;
  v_privileged      boolean;
begin
  -- 1. Override shape is validated on EVERY path, service role included, so a
  --    seed or backend job cannot plant a master-tier override either.
  if tg_op = 'INSERT' then
    v_check_overrides := true;
  else
    v_check_overrides := new.permission_overrides is distinct from old.permission_overrides;
  end if;

  if v_check_overrides then
    select string_agg(key, ', ' order by key) into v_rejected
    from jsonb_object_keys(coalesce(new.permission_overrides, '{}'::jsonb)) as key
    where not exists (
      select 1 from permission_catalog pc
      where pc.permission = key and pc.overridable
    );
    if v_rejected is not null then
      raise exception
        'These permissions cannot be granted through an override: %. Change the role instead.',
        v_rejected;
    end if;

    if exists (
      select 1 from jsonb_each(coalesce(new.permission_overrides, '{}'::jsonb)) as entry
      where jsonb_typeof(entry.value) <> 'boolean'
    ) then
      raise exception 'Permission overrides must be true or false.';
    end if;
  end if;

  -- 2. Migrations, seeds and service-role jobs run without a JWT.
  if v_actor_auth is null then
    return new;
  end if;

  select id into v_actor_employee
  from employees
  where auth_user_id = v_actor_auth and status = 'active'
  limit 1;

  if tg_op = 'INSERT' then
    if new.role = 'master_admin' and not is_master() then
      raise exception 'Only a master admin can create a master admin.';
    end if;
    if not is_master() then
      if new.branch_id is null then
        raise exception 'Only a master admin can create an employee without an entity.';
      end if;
      if not has_entity_access(new.branch_id) then
        raise exception 'You can only create employees inside your own entity.';
      end if;
    end if;
    return new;
  end if;

  -- 3. Re-pointing an employee at a different login is identity grafting.
  if new.auth_user_id is distinct from old.auth_user_id and not is_master() then
    raise exception 'Only a master admin can change the login linked to an employee.';
  end if;

  v_privileged :=
       new.role                 is distinct from old.role
    or new.permission_overrides is distinct from old.permission_overrides
    or new.max_discount_percent is distinct from old.max_discount_percent
    or new.branch_id            is distinct from old.branch_id
    or new.approval_limit       is distinct from old.approval_limit
    or new.status               is distinct from old.status;

  if v_privileged then
    -- CRIT-1: no one edits their own privileges, whatever they hold.
    if v_actor_employee is not null and v_actor_employee = new.id then
      raise exception
        'You cannot change your own role, entity, status, discount limit or permissions.';
    end if;

    if not has_perm('manage_users') then
      raise exception 'You are not allowed to change employee privileges.';
    end if;

    if new.role = 'master_admin' and old.role is distinct from 'master_admin'
       and not is_master() then
      raise exception 'Only a master admin can grant the master admin role.';
    end if;

    -- CRIT-1: privilege writes stay inside entities the actor can reach, in
    -- both directions, so a user cannot be pushed into or pulled out of an
    -- entity the actor has no claim on.
    if not is_master() then
      if new.branch_id is null or old.branch_id is null then
        raise exception 'Only a master admin can manage an employee without an entity.';
      end if;
      if not has_entity_access(old.branch_id) or not has_entity_access(new.branch_id) then
        raise exception 'You can only manage employees inside your own entity.';
      end if;
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.fn_employees_guard() from public, anon, authenticated;

drop trigger if exists employees_guard on employees;
create trigger employees_guard
  before insert or update on employees
  for each row execute function fn_employees_guard();

-- ===== 0013_rpc_branch_consistency.sql =====
-- Audit finding CRIT-3: the stock RPCs validated the *document's* entity but
-- never checked that the batch, product or supplier the document pointed at
-- lived in the same entity. An Entity A stock-out document carrying an
-- Entity B batch_id destroyed Entity B's stock, because fn_post_movement
-- takes branch_id from the batch it was handed.
--
-- Every RPC that moves stock now enforces branch consistency between the
-- document and everything it references.

-- ---------------------------------------------------------------------------
-- Stock out: batch (and product, when named) must match the document's entity.
-- ---------------------------------------------------------------------------
create or replace function erp_approve_stock_out(p_return_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp     employees;
  v_doc     record;
  v_batch   record;
  v_type    text;
  v_delta   int;
  v_balance int;
begin
  v_emp := fn_current_employee();
  if not has_perm('approve_stock_outward') then
    raise exception 'You do not have permission to approve stock-out documents.';
  end if;

  select * into v_doc from returns where id = p_return_id for update;
  if not found then
    raise exception 'Record not found.';
  end if;
  if not has_entity_access(v_doc.branch_id) then
    raise exception 'This record belongs to another entity.';
  end if;
  if v_doc.status <> 'pending' then
    raise exception 'Only pending records can be approved.';
  end if;
  if v_doc.batch_id is null then
    raise exception 'Select a batch on this record before approving.';
  end if;
  if v_doc.quantity <= 0 then
    raise exception 'Quantity must be positive.';
  end if;

  select * into v_batch from product_batches where id = v_doc.batch_id;
  if not found then
    raise exception 'Batch not found.';
  end if;
  if v_batch.branch_id is distinct from v_doc.branch_id then
    raise exception 'The selected batch belongs to a different entity than this document.';
  end if;
  if v_doc.product_id is not null and v_batch.product_id is distinct from v_doc.product_id then
    raise exception 'The selected batch does not belong to the product on this document.';
  end if;

  v_type := case v_doc.type
    when 'customer' then 'return'
    when 'supplier' then 'supplier_return'
    when 'damaged' then 'damage'
    when 'expired' then 'expiry'
    when 'employee_consumption' then 'employee_consumption'
  end;
  v_delta := case when v_doc.type = 'customer' then v_doc.quantity
                  else -v_doc.quantity end;

  v_balance := fn_post_movement(v_doc.batch_id, v_delta, v_type,
    'return', v_doc.id, v_doc.reference, v_doc.reason, v_emp.id);

  update returns
  set status = 'approved', approved_by = v_emp.id, approved_at = now()
  where id = p_return_id;

  insert into audit_logs (employee_id, action, module, record_reference,
                          reason, branch_id)
  values (v_emp.id, 'Stock-out approved (' || v_doc.type || ')', 'Returns',
          v_doc.reference, v_doc.reason, v_doc.branch_id);

  return jsonb_build_object('ok', true, 'balance_after', v_balance);
end $$;

-- ---------------------------------------------------------------------------
-- Stock inward: every line's product, plus the supplier and any linked
-- supplier return, must belong to the document's entity.
-- ---------------------------------------------------------------------------
create or replace function erp_confirm_stock_inward(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp         employees;
  v_doc         record;
  v_item        record;
  v_batch_id    uuid;
  v_paid_type   text;
  v_prod_branch uuid;
  v_batches     int := 0;
begin
  v_emp := fn_current_employee();
  if not has_perm('create_stock_inward') then
    raise exception 'You do not have permission to confirm stock inward.';
  end if;

  select * into v_doc from stock_inwards where id = p_id for update;
  if not found then
    raise exception 'Stock inward document not found.';
  end if;
  if not has_entity_access(v_doc.branch_id) then
    raise exception 'This document belongs to another entity.';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'Only draft documents can be confirmed.';
  end if;
  if not exists (select 1 from stock_inward_items where inward_id = p_id) then
    raise exception 'Add at least one line item before confirming.';
  end if;

  if v_doc.supplier_id is not null
     and not exists (select 1 from suppliers s
                     where s.id = v_doc.supplier_id and s.branch_id = v_doc.branch_id) then
    raise exception 'The supplier on this document belongs to a different entity.';
  end if;

  if v_doc.supplier_return_id is not null
     and not exists (select 1 from returns r
                     where r.id = v_doc.supplier_return_id and r.branch_id = v_doc.branch_id) then
    raise exception 'The linked supplier return belongs to a different entity.';
  end if;

  v_paid_type := case v_doc.inward_type
    when 'purchase_from_parent' then 'purchase'
    when 'purchase_from_external' then 'purchase'
    when 'foc_or_sample' then 'foc'
    when 'replacement_in' then 'replacement_in'
  end;

  for v_item in select * from stock_inward_items where inward_id = p_id
  loop
    select branch_id into v_prod_branch from products where id = v_item.product_id;
    if v_prod_branch is distinct from v_doc.branch_id then
      raise exception 'A line item references a product from a different entity.';
    end if;

    insert into product_batches (
      product_id, batch_number, supplier_id, branch_id,
      quantity_received, quantity_available, unit_cost, expiry_date,
      status, source_type, source_id
    ) values (
      v_item.product_id, v_item.batch_number, v_doc.supplier_id, v_doc.branch_id,
      v_item.quantity + v_item.free_quantity, 0, v_item.unit_cost, v_item.expiry_date,
      'active', 'stock_inward', v_doc.id
    ) returning id into v_batch_id;

    if v_item.quantity > 0 then
      perform fn_post_movement(v_batch_id, v_item.quantity, v_paid_type,
        'stock_inward', v_doc.id, v_doc.reference, null, v_emp.id);
    end if;
    -- Free goods stay identifiable in the ledger as FOC even on purchases.
    if v_item.free_quantity > 0 then
      perform fn_post_movement(v_batch_id, v_item.free_quantity, 'foc',
        'stock_inward', v_doc.id, v_doc.reference, null, v_emp.id);
    end if;

    update stock_inward_items set batch_id = v_batch_id where id = v_item.id;
    v_batches := v_batches + 1;
  end loop;

  update stock_inwards
  set status = 'confirmed', confirmed_by = v_emp.id, confirmed_at = now()
  where id = p_id;

  insert into audit_logs (employee_id, action, module, record_reference, branch_id)
  values (v_emp.id, 'Stock inward confirmed (' || v_doc.inward_type || ')',
          'Inventory', v_doc.reference, v_doc.branch_id);

  return jsonb_build_object('ok', true, 'reference', v_doc.reference,
                            'batches', v_batches);
end $$;

-- ---------------------------------------------------------------------------
-- Opening stock: every line's product must belong to the entry's entity.
-- ---------------------------------------------------------------------------
create or replace function erp_confirm_opening_stock(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp         employees;
  v_doc         record;
  v_item        record;
  v_batch_id    uuid;
  v_prod_branch uuid;
  v_batches     int := 0;
begin
  v_emp := fn_current_employee();
  if not has_perm('create_stock_inward') then
    raise exception 'You do not have permission to confirm opening stock.';
  end if;

  select * into v_doc from opening_stock_entries where id = p_id for update;
  if not found then
    raise exception 'Opening stock entry not found.';
  end if;
  if not has_entity_access(v_doc.branch_id) then
    raise exception 'This entry belongs to another entity.';
  end if;
  if v_doc.status <> 'draft' then
    raise exception 'Only draft entries can be confirmed.';
  end if;
  if not exists (select 1 from opening_stock_items where entry_id = p_id) then
    raise exception 'Add at least one line item before confirming.';
  end if;

  for v_item in select * from opening_stock_items where entry_id = p_id
  loop
    select branch_id into v_prod_branch from products where id = v_item.product_id;
    if v_prod_branch is distinct from v_doc.branch_id then
      raise exception 'A line item references a product from a different entity.';
    end if;

    insert into product_batches (
      product_id, batch_number, branch_id,
      quantity_received, quantity_available, unit_cost, expiry_date,
      status, source_type, source_id
    ) values (
      v_item.product_id, v_item.batch_number, v_doc.branch_id,
      v_item.quantity, 0, v_item.unit_cost, v_item.expiry_date,
      'active', 'opening_stock', v_doc.id
    ) returning id into v_batch_id;

    perform fn_post_movement(v_batch_id, v_item.quantity, 'opening_stock',
      'opening_stock', v_doc.id, v_doc.reference, null, v_emp.id);

    update opening_stock_items set batch_id = v_batch_id where id = v_item.id;
    v_batches := v_batches + 1;
  end loop;

  update opening_stock_entries
  set status = 'confirmed', confirmed_by = v_emp.id, confirmed_at = now()
  where id = p_id;

  insert into audit_logs (employee_id, action, module, record_reference, branch_id)
  values (v_emp.id, 'Opening stock confirmed', 'Inventory', v_doc.reference,
          v_doc.branch_id);

  return jsonb_build_object('ok', true, 'reference', v_doc.reference,
                            'batches', v_batches);
end $$;

-- ---------------------------------------------------------------------------
-- Sales: the product must live in the same entity as the batch it sells from.
-- ---------------------------------------------------------------------------
create or replace function erp_complete_sale(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp employees;
  v_item jsonb;
  v_batch record;
  v_product record;
  v_branch uuid;
  v_customer uuid;
  v_prevent_expired boolean;
  v_subtotal numeric := 0;
  v_item_discounts numeric := 0;
  v_cart_discount numeric := coalesce((p->>'discount')::numeric, 0);
  v_total_discount numeric;
  v_total numeric;
  v_sale_id uuid;
  v_invoice text;
  v_qty int;
  v_line_disc numeric;
  v_line_amount numeric;
  v_points int;
begin
  v_emp := fn_current_employee();
  if not has_perm('create_sales') then
    raise exception 'You do not have permission to create sales.';
  end if;

  if p->'items' is null or jsonb_array_length(p->'items') = 0 then
    raise exception 'Cart is empty.';
  end if;
  if v_cart_discount < 0 then
    raise exception 'Discount cannot be negative.';
  end if;

  -- First pass: validate and lock every batch, derive totals from DB prices.
  for v_item in select * from jsonb_array_elements(p->'items')
  loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    v_line_disc := coalesce((v_item->>'discount')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Quantities must be positive.';
    end if;
    if v_line_disc < 0 then
      raise exception 'Discount cannot be negative.';
    end if;

    select * into v_batch from product_batches
      where id = (v_item->>'batch_id')::uuid for update;
    if not found then
      raise exception 'Batch not found.';
    end if;
    if v_batch.product_id <> (v_item->>'product_id')::uuid then
      raise exception 'Batch does not belong to the selected product.';
    end if;
    if v_batch.status <> 'active' then
      raise exception 'Batch % is not sellable (status %).', v_batch.batch_number, v_batch.status;
    end if;
    if not has_entity_access(v_batch.branch_id) then
      raise exception 'You cannot sell stock that belongs to another entity.';
    end if;

    if v_branch is null then
      v_branch := v_batch.branch_id;
    elsif v_branch <> v_batch.branch_id then
      raise exception 'All items in one sale must belong to the same entity.';
    end if;

    if v_batch.quantity_available < v_qty then
      raise exception 'Not enough stock in batch %: % available.',
        v_batch.batch_number, v_batch.quantity_available;
    end if;

    -- Optional expired-stock block (per-entity toggle falls back to global).
    select coalesce(
      (select (value->>'prevent_expired_sales')::boolean from settings
        where key = 'toggles' and branch_id = v_batch.branch_id),
      (select (value->>'prevent_expired_sales')::boolean from settings
        where key = 'toggles' and branch_id is null),
      false
    ) into v_prevent_expired;
    if v_prevent_expired and v_batch.expiry_date is not null
       and v_batch.expiry_date < current_date then
      raise exception 'Batch % expired on % and cannot be sold.',
        v_batch.batch_number, v_batch.expiry_date;
    end if;

    select * into v_product from products where id = v_batch.product_id;
    if v_product.status <> 'active' then
      raise exception 'Product % is not active.', v_product.name;
    end if;
    -- CRIT-3: product and batch must belong to the same entity.
    if v_product.branch_id is distinct from v_batch.branch_id then
      raise exception 'The product and the batch belong to different entities.';
    end if;

    v_line_amount := v_product.sell_price * v_qty;
    if v_line_disc > 0 and v_product.max_discount_percent > 0
       and v_line_disc > v_line_amount * v_product.max_discount_percent / 100 then
      raise exception 'Discount on % exceeds the product limit of % percent.',
        v_product.name, v_product.max_discount_percent;
    end if;

    v_subtotal := v_subtotal + v_line_amount;
    v_item_discounts := v_item_discounts + v_line_disc;
  end loop;

  v_total_discount := v_item_discounts + v_cart_discount;
  if v_total_discount > 0 then
    if not has_perm('apply_discount') then
      raise exception 'You do not have permission to apply discounts.';
    end if;
    if v_subtotal <= 0 or v_total_discount > v_subtotal * v_emp.max_discount_percent / 100 then
      raise exception 'Discount exceeds your authorised limit of % percent.',
        v_emp.max_discount_percent;
    end if;
  end if;
  v_total := greatest(0, v_subtotal - v_total_discount);

  -- Customer must belong to the same entity.
  v_customer := nullif(p->>'customer_id', '')::uuid;
  if v_customer is not null then
    if not exists (select 1 from customers c
                   where c.id = v_customer and c.branch_id = v_branch) then
      raise exception 'Customer belongs to a different entity.';
    end if;
  end if;

  v_invoice := next_doc_number('INV', 'doc_seq_sale');

  insert into sales (invoice_number, customer_id, cashier_id, branch_id,
                     payment_method, subtotal, discount, tax, total, status)
  values (v_invoice, v_customer, v_emp.id, v_branch,
          p->>'payment_method', v_subtotal, v_total_discount, 0, v_total, 'completed')
  returning id into v_sale_id;

  -- Second pass: items + ledger (batches already locked above).
  for v_item in select * from jsonb_array_elements(p->'items')
  loop
    v_qty := (v_item->>'quantity')::int;
    v_line_disc := coalesce((v_item->>'discount')::numeric, 0);
    select p2.sell_price into v_line_amount
      from products p2 where p2.id = (v_item->>'product_id')::uuid;

    insert into sale_items (sale_id, product_id, batch_id, quantity,
                            unit_price, discount, line_total)
    values (v_sale_id, (v_item->>'product_id')::uuid, (v_item->>'batch_id')::uuid,
            v_qty, v_line_amount, v_line_disc, v_line_amount * v_qty - v_line_disc);

    perform fn_post_movement(
      (v_item->>'batch_id')::uuid, -v_qty, 'sale', 'sale', v_sale_id,
      v_invoice, null, v_emp.id);
  end loop;

  v_points := floor(v_total / 1000);
  if v_customer is not null and v_points > 0 then
    update customers set loyalty_points = loyalty_points + v_points
      where id = v_customer;
  end if;

  insert into audit_logs (employee_id, action, module, record_reference, branch_id)
  values (v_emp.id, 'Sale created', 'Sales', v_invoice, v_branch);

  return jsonb_build_object('sale_id', v_sale_id, 'invoice_number', v_invoice,
                            'total', v_total);
end $$;

-- Re-assert grants: create or replace resets them to the default (PUBLIC).
revoke execute on function erp_complete_sale(jsonb) from public, anon;
revoke execute on function erp_confirm_stock_inward(uuid) from public, anon;
revoke execute on function erp_confirm_opening_stock(uuid) from public, anon;
revoke execute on function erp_approve_stock_out(uuid) from public, anon;
grant execute on function erp_complete_sale(jsonb) to authenticated;
grant execute on function erp_confirm_stock_inward(uuid) to authenticated;
grant execute on function erp_confirm_opening_stock(uuid) to authenticated;
grant execute on function erp_approve_stock_out(uuid) to authenticated;

-- ===== 0014_ledger_write_lockdown.sql =====
-- Audit finding HIGH-2: the ledger was append-only but not append-controlled.
-- movements_insert allowed any holder of create_stock_inward / adjust_inventory
-- / create_stock_outward to POST arbitrary rows to stock_movements, so an
-- inventory user could forge "+99999 purchase" entries. Quantities stayed
-- correct (they live on product_batches) but every ledger-derived report could
-- be poisoned, and the ledger is the audit record.
--
-- After this migration the ONLY way a row reaches stock_movements is
-- fn_post_movement, called from a SECURITY DEFINER erp_* RPC that has already
-- checked permission, entity and business rules.
--
-- Two legacy flows still wrote the ledger from application code — stock
-- transfers and purchase-order receipts. Both are converted to RPCs here;
-- both also used to update quantity_available directly and non-atomically,
-- so they gain transactional safety in the process.

-- ---------------------------------------------------------------------------
-- Stock transfer between entities, atomically.
-- ---------------------------------------------------------------------------
create or replace function erp_transfer_stock(
  p_batch_id uuid,
  p_to_branch uuid,
  p_quantity int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp        employees;
  v_batch      record;
  v_dest_batch uuid;
  v_reference  text;
begin
  v_emp := fn_current_employee();
  if not has_perm('adjust_inventory') then
    raise exception 'You do not have permission to transfer stock.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Transfer quantity must be positive.';
  end if;

  select * into v_batch from product_batches where id = p_batch_id for update;
  if not found then
    raise exception 'Batch not found.';
  end if;
  if not has_entity_access(v_batch.branch_id) then
    raise exception 'That batch belongs to another entity.';
  end if;
  if not has_entity_access(p_to_branch) then
    raise exception 'You do not have access to the destination entity.';
  end if;
  if v_batch.branch_id = p_to_branch then
    raise exception 'The source and destination entities are the same.';
  end if;
  if v_batch.quantity_available < p_quantity then
    raise exception 'Not enough stock in batch %: % available.',
      v_batch.batch_number, v_batch.quantity_available;
  end if;

  v_reference := next_doc_number('TRF', 'doc_seq_correction');

  insert into product_batches (
    product_id, batch_number, supplier_id, branch_id,
    quantity_received, quantity_available, unit_cost, expiry_date,
    storage_location, status, source_type, source_id
  ) values (
    v_batch.product_id, v_batch.batch_number, v_batch.supplier_id, p_to_branch,
    p_quantity, 0, v_batch.unit_cost, v_batch.expiry_date,
    v_batch.storage_location, 'active', 'stock_transfer', v_batch.id
  ) returning id into v_dest_batch;

  perform fn_post_movement(p_batch_id, -p_quantity, 'transfer_out',
    'stock_transfer', v_dest_batch, v_reference, null, v_emp.id);
  perform fn_post_movement(v_dest_batch, p_quantity, 'transfer_in',
    'stock_transfer', v_dest_batch, v_reference, null, v_emp.id);

  insert into stock_transfers (
    reference, product_id, batch_id, from_branch_id, to_branch_id,
    quantity, status, created_by
  ) values (
    v_reference, v_batch.product_id, p_batch_id, v_batch.branch_id, p_to_branch,
    p_quantity, 'completed', v_emp.id
  );

  insert into audit_logs (employee_id, action, module, record_reference, branch_id)
  values (v_emp.id, 'Stock transferred', 'Inventory', v_reference, v_batch.branch_id);

  return jsonb_build_object('ok', true, 'reference', v_reference,
                            'destination_batch', v_dest_batch);
end $$;

-- ---------------------------------------------------------------------------
-- Receive a purchase order (GRN), atomically.
-- p_lines: [{product_id, quantity_ordered, quantity_received, damaged_qty, unit_cost}]
-- ---------------------------------------------------------------------------
create or replace function erp_receive_purchase_order(
  p_po_id uuid,
  p_supplier_invoice text,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp            employees;
  v_po             record;
  v_line           jsonb;
  v_grn            uuid;
  v_batch          uuid;
  v_grn_number     text;
  v_prod_branch    uuid;
  v_received       int;
  v_damaged        int;
  v_ordered        int;
  v_usable         int;
  v_any            boolean := false;
  v_any_damaged    boolean := false;
  v_total_ordered  int := 0;
  v_total_received int := 0;
  v_status         text;
begin
  v_emp := fn_current_employee();
  if not has_perm('create_stock_inward') then
    raise exception 'You do not have permission to receive stock.';
  end if;

  select * into v_po from purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found.';
  end if;
  if not has_entity_access(v_po.branch_id) then
    raise exception 'This purchase order belongs to another entity.';
  end if;
  if v_po.status in ('draft', 'cancelled') then
    raise exception 'Only an approved purchase order can be received.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Enter a received quantity for at least one product.';
  end if;

  v_grn_number := next_doc_number('GRN', 'doc_seq_inward');

  insert into received_orders (
    grn_number, po_id, branch_id, supplier_invoice_number, received_by, status
  ) values (
    v_grn_number, p_po_id, v_po.branch_id, nullif(trim(p_supplier_invoice), ''),
    v_emp.id, 'partial'
  ) returning id into v_grn;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_received := coalesce((v_line->>'quantity_received')::int, 0);
    v_damaged  := coalesce((v_line->>'damaged_qty')::int, 0);
    v_ordered  := coalesce((v_line->>'quantity_ordered')::int, 0);
    if v_received <= 0 then
      continue;
    end if;
    if v_damaged < 0 or v_damaged > v_received then
      raise exception 'Damaged quantity must be between 0 and the received quantity.';
    end if;

    -- The line must belong to this purchase order and this entity.
    if not exists (
      select 1 from purchase_order_items poi
      where poi.po_id = p_po_id and poi.product_id = (v_line->>'product_id')::uuid
    ) then
      raise exception 'A line references a product that is not on this purchase order.';
    end if;
    select branch_id into v_prod_branch from products where id = (v_line->>'product_id')::uuid;
    if v_prod_branch is distinct from v_po.branch_id then
      raise exception 'A line references a product from a different entity.';
    end if;

    v_any := true;
    if v_damaged > 0 then v_any_damaged := true; end if;
    v_usable := v_received - v_damaged;
    v_total_ordered  := v_total_ordered + v_ordered;
    v_total_received := v_total_received + v_received;

    insert into product_batches (
      product_id, batch_number, supplier_id, branch_id,
      quantity_received, quantity_available, unit_cost,
      status, source_type, source_id
    ) values (
      (v_line->>'product_id')::uuid,
      'B-' || to_char(now(), 'YYYYMMDD') || '-' || substr(v_grn::text, 1, 8),
      v_po.supplier_id, v_po.branch_id,
      v_received, 0, coalesce((v_line->>'unit_cost')::numeric, 0),
      'active', 'received_order', v_grn
    ) returning id into v_batch;

    insert into received_order_items (
      grn_id, product_id, batch_id, quantity_ordered, quantity_received,
      unit_cost, damaged_qty
    ) values (
      v_grn, (v_line->>'product_id')::uuid, v_batch, v_ordered, v_received,
      coalesce((v_line->>'unit_cost')::numeric, 0), v_damaged
    );

    if v_usable > 0 then
      perform fn_post_movement(v_batch, v_usable, 'purchase',
        'received_order', v_grn, v_po.po_number, null, v_emp.id);
    end if;
  end loop;

  if not v_any then
    raise exception 'Enter a received quantity for at least one product.';
  end if;

  v_status := case
    when v_any_damaged then 'variance'
    when v_total_received >= v_total_ordered then 'complete'
    else 'partial'
  end;
  update received_orders set status = v_status where id = v_grn;

  -- Roll the purchase order forward on everything received so far.
  select coalesce(sum(poi.quantity), 0) into v_total_ordered
  from purchase_order_items poi where poi.po_id = p_po_id;
  select coalesce(sum(roi.quantity_received), 0) into v_total_received
  from received_order_items roi
  join received_orders ro on ro.id = roi.grn_id
  where ro.po_id = p_po_id;

  update purchase_orders
  set status = case when v_total_received >= v_total_ordered
                    then 'received' else 'partially_received' end
  where id = p_po_id;

  insert into audit_logs (employee_id, action, module, record_reference, branch_id)
  values (v_emp.id, 'Stock received', 'Purchasing', v_grn_number, v_po.branch_id);

  return jsonb_build_object('ok', true, 'grn_id', v_grn, 'grn_number', v_grn_number,
                            'status', v_status);
end $$;

revoke execute on function erp_transfer_stock(uuid, uuid, int) from public, anon;
revoke execute on function erp_receive_purchase_order(uuid, text, jsonb) from public, anon;
grant execute on function erp_transfer_stock(uuid, uuid, int) to authenticated;
grant execute on function erp_receive_purchase_order(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Close the direct write path. With no INSERT policy and no INSERT privilege,
-- PostgREST cannot write the ledger at all; fn_post_movement (SECURITY DEFINER,
-- owned by postgres) still can.
-- ---------------------------------------------------------------------------
drop policy if exists "movements_insert" on stock_movements;
revoke insert, update, delete on stock_movements from authenticated, anon;

-- Batch quantities are ledger-derived and must move with a movement row.
-- Direct UPDATE is what let a forged ledger row be made to "look" consistent.
drop policy if exists "batches_update" on product_batches;
create policy "batches_update" on product_batches for update
  using (has_entity_access(branch_id) and has_perm('adjust_inventory'))
  with check (has_entity_access(branch_id) and has_perm('adjust_inventory'));
revoke update (quantity_available) on product_batches from authenticated, anon;

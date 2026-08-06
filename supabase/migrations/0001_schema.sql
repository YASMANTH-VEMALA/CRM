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

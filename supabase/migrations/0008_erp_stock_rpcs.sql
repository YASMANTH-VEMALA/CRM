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

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

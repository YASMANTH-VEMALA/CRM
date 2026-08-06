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

-- Audit MED findings, database half.
--
-- MED-1  Sales had no idempotency: a double-submitted cart created two sales.
-- MED-2  Storage buckets were public, anon-listable, and any authenticated
--        user could upload anywhere in them.
-- MED-5  audit_logs INSERT was open to any authenticated user for any branch,
--        so the audit trail could be forged or spammed.
-- MED-6  has_entity_access(NULL) returned true, making null-branch rows
--        globally readable and writable.
-- MED-7  Last-master-admin protection existed only in the server action, so a
--        direct PostgREST update could still lock everyone out.

-- ---------------------------------------------------------------------------
-- MED-6: a null entity is not "every entity"
-- ---------------------------------------------------------------------------
-- Callers that legitimately mean "global" (settings and notifications with a
-- null branch_id) test `branch_id is null` in their own policy already, so they
-- keep working; this only stops null from being a skeleton key.
create or replace function public.has_entity_access(p_branch uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_branch is not null
    and (
      is_master()
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
    )
$$;

grant execute on function public.has_entity_access(uuid) to authenticated;
revoke execute on function public.has_entity_access(uuid) from public, anon;

-- Knock-on effects of the change above. Master admins legitimately have a null
-- branch_id, so every policy that reaches them needs an explicit clause now
-- that null is no longer a wildcard.

-- Previously every null-branch employee (i.e. every master admin) was visible
-- to everyone, because has_entity_access(null) was true.
drop policy if exists "employees_select" on employees;
create policy "employees_select" on employees for select
  using (
    auth_user_id = auth.uid()
    or has_entity_access(branch_id)
    or (branch_id is null and (is_master() or has_perm('manage_users')))
  );

-- Only a master admin may create or manage an entity-less employee. This
-- mirrors fn_employees_guard, which already refuses null branches for
-- non-masters; without it a master could no longer create another master.
drop policy if exists "employees_insert" on employees;
create policy "employees_insert" on employees for insert
  with check (
    has_perm('manage_users')
    and (has_entity_access(branch_id) or (branch_id is null and is_master()))
  );

drop policy if exists "employees_update" on employees;
create policy "employees_update" on employees for update
  using (
    auth_user_id = auth.uid()
    or (has_perm('manage_users')
        and (has_entity_access(branch_id) or (branch_id is null and is_master())))
  )
  with check (
    auth_user_id = auth.uid()
    or (has_perm('manage_users')
        and (has_entity_access(branch_id) or (branch_id is null and is_master())))
  );

-- Global audit entries (null branch) stay visible to master admins.
drop policy if exists "audit_select" on audit_logs;
create policy "audit_select" on audit_logs for select
  using (
    has_perm('view_management_reports')
    and (has_entity_access(branch_id) or (branch_id is null and is_master()))
  );

-- ---------------------------------------------------------------------------
-- MED-5: audit entries must be attributable to the actor
-- ---------------------------------------------------------------------------
drop policy if exists "audit_insert" on audit_logs;
create policy "audit_insert" on audit_logs for insert
  with check (
    employee_id = auth_employee_id()
    and (branch_id is null or has_entity_access(branch_id))
  );

-- ---------------------------------------------------------------------------
-- MED-7: the last active master admin cannot be disabled or demoted
-- ---------------------------------------------------------------------------
create or replace function fn_protect_last_master()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'master_admin' and old.status = 'active'
     and (new.role is distinct from 'master_admin' or new.status is distinct from 'active') then
    if (select count(*) from employees
        where role = 'master_admin' and status = 'active' and id <> old.id) = 0 then
      raise exception
        'This is the last active master administrator and cannot be disabled or demoted.';
    end if;
  end if;
  return new;
end $$;

revoke execute on function fn_protect_last_master() from public, anon, authenticated;

drop trigger if exists employees_protect_last_master on employees;
create trigger employees_protect_last_master
  before update on employees
  for each row execute function fn_protect_last_master();

-- ---------------------------------------------------------------------------
-- MED-1: sales idempotency
-- ---------------------------------------------------------------------------
-- The client sends a request key with the cart. A retry of the same key
-- returns the original sale instead of creating a second one. The unique index
-- is the real guard: two concurrent submissions race, one inserts, the other
-- gets a duplicate-key error and re-reads.
alter table sales add column if not exists request_key text;
create unique index if not exists sales_branch_request_key
  on sales(branch_id, request_key) where request_key is not null;

-- erp_complete_sale gains the key. Everything else is unchanged from 0013.
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
  v_request_key text := nullif(trim(p->>'request_key'), '');
  v_existing record;
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
      -- Idempotency: a retry of the same cart returns the original sale.
      if v_request_key is not null then
        select id, invoice_number, total into v_existing
        from sales where branch_id = v_branch and request_key = v_request_key;
        if found then
          return jsonb_build_object('sale_id', v_existing.id,
                                    'invoice_number', v_existing.invoice_number,
                                    'total', v_existing.total, 'duplicate', true);
        end if;
      end if;
    elsif v_branch <> v_batch.branch_id then
      raise exception 'All items in one sale must belong to the same entity.';
    end if;

    if v_batch.quantity_available < v_qty then
      raise exception 'Not enough stock in batch %: % available.',
        v_batch.batch_number, v_batch.quantity_available;
    end if;

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

  v_customer := nullif(p->>'customer_id', '')::uuid;
  if v_customer is not null then
    if not exists (select 1 from customers c
                   where c.id = v_customer and c.branch_id = v_branch) then
      raise exception 'Customer belongs to a different entity.';
    end if;
  end if;

  v_invoice := next_doc_number('INV', 'doc_seq_sale');

  begin
    insert into sales (invoice_number, customer_id, cashier_id, branch_id,
                       payment_method, subtotal, discount, tax, total, status,
                       request_key)
    values (v_invoice, v_customer, v_emp.id, v_branch,
            p->>'payment_method', v_subtotal, v_total_discount, 0, v_total,
            'completed', v_request_key)
    returning id into v_sale_id;
  exception when unique_violation then
    -- Two submissions of the same cart raced; the other one won.
    select id, invoice_number, total into v_existing
    from sales where branch_id = v_branch and request_key = v_request_key;
    return jsonb_build_object('sale_id', v_existing.id,
                              'invoice_number', v_existing.invoice_number,
                              'total', v_existing.total, 'duplicate', true);
  end;

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
                            'total', v_total, 'duplicate', false);
end $$;

revoke execute on function erp_complete_sale(jsonb) from public, anon;
grant execute on function erp_complete_sale(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- MED-2: storage lockdown
-- ---------------------------------------------------------------------------
-- Buckets become private; reads go through signed URLs. Uploads are limited to
-- the two buckets, capped in size, restricted to image/PDF types, and confined
-- to a per-entity path prefix (`<branch_id>/...`) the uploader can access.
update storage.buckets
set public = false,
    file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','application/pdf']
where id in ('product-images', 'stock-documents');

-- A plain `split_part(name,'/',1)::uuid` would raise on any object whose first
-- path segment is not a UUID, turning "denied" into a 500. Parse defensively.
create or replace function fn_path_entity(p_name text)
returns uuid
language sql immutable
set search_path = public
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
    else null
  end
$$;

grant execute on function fn_path_entity(text) to authenticated;

drop policy if exists "erp_upload_files" on storage.objects;
drop policy if exists "erp_read_files" on storage.objects;
drop policy if exists "erp_delete_files" on storage.objects;

create policy "erp_upload_files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('product-images', 'stock-documents')
    and has_entity_access(fn_path_entity(name))
  );

create policy "erp_read_files" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('product-images', 'stock-documents')
    and has_entity_access(fn_path_entity(name))
  );

create policy "erp_delete_files" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('product-images', 'stock-documents')
    and has_entity_access(fn_path_entity(name))
    and has_perm('edit_products')
  );

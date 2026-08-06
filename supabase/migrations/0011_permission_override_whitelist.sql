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

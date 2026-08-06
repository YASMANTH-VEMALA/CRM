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

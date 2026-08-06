-- Corrects migration 0015.
--
-- 0015 used `revoke select (buy_price) on products from authenticated`. That is
-- a no-op in Postgres when the role already holds table-level SELECT, which
-- `authenticated` does (Supabase grants it on every table in `public`).
-- Column privileges are additive: table-level SELECT already implies every
-- column, so revoking one column changes nothing. The audit test caught it —
-- a sales user could still read product_batches.unit_cost.
--
-- The working pattern is: revoke the table-level grant, then grant back exactly
-- the columns the role may read.
--
-- Trade-off, deliberately accepted: a column added to either table in future is
-- NOT readable by `authenticated` until it is granted. fn_grant_readable_columns
-- exists so that a later migration can simply re-run it after adding a column,
-- rather than maintaining a hand-written column list.

create or replace function fn_grant_readable_columns(
  p_table   text,
  p_exclude text[],
  p_roles   text[] default array['authenticated', 'anon']
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cols text;
  v_role text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = p_table
    and not (column_name = any (p_exclude));

  if v_cols is null then
    raise exception 'No grantable columns found on %', p_table;
  end if;

  foreach v_role in array p_roles loop
    execute format('revoke select on public.%I from %I', p_table, v_role);
    execute format('grant select (%s) on public.%I to %I', v_cols, p_table, v_role);
  end loop;
end $$;

revoke execute on function fn_grant_readable_columns(text, text[], text[])
  from public, anon, authenticated;

-- Purchase cost now genuinely leaves the wire. Both roles keep every other
-- column, so nothing else changes for the app or for RLS.
select fn_grant_readable_columns('products', array['buy_price']);
select fn_grant_readable_columns('product_batches', array['unit_cost']);

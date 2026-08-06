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

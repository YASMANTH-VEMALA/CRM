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

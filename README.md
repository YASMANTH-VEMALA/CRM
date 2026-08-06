# Mars Pharmacy ERP / CRM

Multi-entity pharmacy ERP built on Next.js 16 (App Router) and Supabase.
Each "entity" is an independently operated pharmacy; the database column is
`branch_id` throughout, and the UI labels it *Entity*.

## Requirements

- Node.js 20+
- A Supabase project (Postgres 15+, `pgcrypto` and `vector` extensions)
- Supabase CLI, if you want to run migrations with `supabase db push`

## Environment variables

Copy `.env.example` to `.env.local` and fill it in. **Never commit `.env.local`.**

| Variable | Required | Exposed to browser | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | **yes** | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | **yes** | Anon key; all user traffic goes through RLS with this |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | no — server only | Bypasses RLS. Used only by `src/lib/supabase/service.ts` for background jobs and by the DB test harness. Leaking this key compromises every entity's data. |
| `OPENAI_API_KEY` | only for AI features | no — server only | Embeddings and the Ask-AI assistant |

The AI assistant and `npm run backfill:embeddings` are the only consumers of
`OPENAI_API_KEY`; the rest of the app runs without it.

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev                    # http://localhost:3000
```

## Database setup

### Existing database (normal path)

Migrations are numbered and **must be applied in order**. Order is load-bearing:
`0002` installs permissive bootstrap policies that `0007` replaces with the real
per-entity policies, and `0011`–`0013` harden the permission and stock layers on
top of that. Applying them out of order leaves the database open.

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Brand-new, empty database (one-paste bootstrap)

```bash
npm run db:bundle              # regenerates supabase/migrations/run_all.sql
```

Then paste `supabase/migrations/run_all.sql` into the Supabase SQL editor.
Use this **only** on an empty project — it does not consult the migration
history table, so re-running it against a populated database will fail.

`run_all.sql` is a generated file. Run `npm run db:bundle` after adding any
migration and commit the result; a stale bundle previously shipped a schema
with no entity isolation.

### Migration map

| File | What it does |
|---|---|
| `0001_schema.sql` | Core tables |
| `0002_rls.sql` | Bootstrap RLS (permissive — superseded by 0007) |
| `0003_seed.sql` | Demo catalogue, branches, employees |
| `0004_seed_admin_employee.sql` | Links the first admin login to an employee row |
| `0005_ai_embeddings.sql` | `document_embeddings` + `match_documents` |
| `0006_erp_foundation.sql` | Entities, roles, permissions, product master, stock documents, ledger |
| `0007_erp_rls.sql` | Drops the blanket policies; per-entity + per-permission RLS |
| `0008_erp_stock_rpcs.sql` | Transactional stock RPCs |
| `0009_erp_function_grants.sql` | Revokes `PUBLIC`/`anon` execute on every function |
| `0010_erp_import_rpc.sql` | Atomic product-import commit |
| `0011_permission_override_whitelist.sql` | `permission_catalog`; master-tier permissions are role-only |
| `0012_employee_privilege_guard.sql` | No self-editing of privileges; entity-confined user administration |
| `0013_rpc_branch_consistency.sql` | Branch consistency between documents, batches, products and suppliers |

### Before migrating production

1. Take a database backup (Supabase → Database → Backups, or `pg_dump`).
2. Apply to a staging project first and run `npm run test:all` against it.
3. Apply to production during a quiet window.

**Rollback.** `0011`–`0013` are additive and restrictive: they add one table
(`permission_catalog`), one index, and replace function bodies. To roll back,
re-apply the previous definitions of `has_perm`, `fn_employees_guard`,
`erp_approve_stock_out`, `erp_confirm_stock_inward`, `erp_confirm_opening_stock`
and `erp_complete_sale` from `0007`/`0008`, then
`drop table permission_catalog;`. No data is destroyed by these migrations, so
a restore is only needed if an earlier migration fails.

## Storage buckets

`0006` creates `product-images` and `stock-documents`. No application code
uploads to them yet — product images are stored as pasted URLs — so review
their policies before enabling uploads.

## Tests

```bash
npm test          # 40 pure unit tests (pricing, permissions, import validation)
npm run test:db   # RLS + stock RPC tests against a real Supabase project
npm run test:all  # both
```

`npm run test:db` signs real users in with the anon key, so it exercises the
actual RLS layer rather than mocks. It **writes to whichever project
`.env.local` points at** — point it at a dedicated test project, never at
production.

## Other checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

-- AI features: semantic search / RAG store for products, customers, suppliers.
-- Installed into `extensions`, matching this project's existing convention
-- for pgcrypto/uuid-ossp/pg_stat_statements (not `public`). Everything below
-- schema-qualifies the vector type/operator/opclass explicitly rather than
-- relying on search_path, since a bare `SET search_path` does not reliably
-- carry over between statements when migrations run through some tooling.
create extension if not exists vector with schema extensions;

create table document_embeddings (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in ('products', 'customers', 'suppliers')),
  source_id uuid not null,
  content text not null,
  embedding extensions.vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding_model text not null default 'text-embedding-3-small',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_id)
);

create index document_embeddings_source_idx on document_embeddings (source_table, source_id);

-- HNSW over IVFFlat: rows arrive one at a time via best-effort re-embeds on
-- every insert (not a bulk load), and HNSW needs no upfront "lists" training
-- step and degrades gracefully as the table grows.
create index document_embeddings_embedding_hnsw_idx
  on document_embeddings using hnsw (embedding extensions.vector_cosine_ops);

alter table document_embeddings enable row level security;
create policy "authenticated_full_access" on document_embeddings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- 0002_rls.sql's table loop already ran and won't retroactively cover this
-- new table, so the same blanket-authenticated convention is replicated here.

create or replace function match_documents(
  query_embedding extensions.vector(1536),
  match_source_tables text[] default null,
  match_count int default 8,
  match_threshold float default 0.3
)
returns table (
  id uuid,
  source_table text,
  source_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
set search_path = 'public, extensions'
as $$
  select
    de.id, de.source_table, de.source_id, de.content, de.metadata,
    1 - (de.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.document_embeddings de
  where (match_source_tables is null or de.source_table = any(match_source_tables))
    and 1 - (de.embedding OPERATOR(extensions.<=>) query_embedding) >= match_threshold
  order by de.embedding OPERATOR(extensions.<=>) query_embedding
  limit match_count;
$$;

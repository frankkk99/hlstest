create table if not exists public.avdb_catalog_items (
  id uuid primary key default gen_random_uuid(),
  stage_item_id uuid not null unique references public.avdb_stage_items(id) on delete restrict,
  source text not null default 'avdbapi',
  external_id text,
  movie_code text,
  title text not null,
  original_title text,
  slug text,
  year text,
  quality text,
  duration text,
  description text,
  poster_url text,
  thumb_url text,
  player_page_url text not null,
  player_provider text,
  verified_media_url text,
  player_diagnostics jsonb not null default '{}'::jsonb,
  dedupe_key text,
  raw_data jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.avdb_catalog_items enable row level security;

alter table public.avdb_stage_items
  add column if not exists published_at timestamptz;

create unique index if not exists avdb_catalog_external_id_uq
  on public.avdb_catalog_items (external_id)
  where external_id is not null;

create index if not exists avdb_catalog_active_published_idx
  on public.avdb_catalog_items (published_at desc)
  where is_active = true;

create index if not exists avdb_catalog_movie_code_idx
  on public.avdb_catalog_items (movie_code);

create index if not exists avdb_stage_publish_ready_idx
  on public.avdb_stage_items (player_status, stage_status, updated_at desc)
  where player_status = 'ready' and stage_status = 'player_ready';

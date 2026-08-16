alter table public.avdb_stage_items
  add column if not exists verified_media_url text,
  add column if not exists player_checked_at timestamptz,
  add column if not exists player_failure_type text,
  add column if not exists player_diagnostics jsonb not null default '{}'::jsonb;

create index if not exists avdb_stage_items_player_queue_idx
  on public.avdb_stage_items(player_status, stage_status, updated_at desc);

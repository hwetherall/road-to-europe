create table if not exists public.weekly_roundups (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  season text not null,
  matchday integer not null,
  club_abbr text not null,
  status text not null default 'draft',
  generated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  data_hash text not null,
  markdown text not null,
  dossier_json jsonb not null,
  sections_json jsonb not null,
  sources_json jsonb not null default '[]'::jsonb,
  warnings_json jsonb not null default '[]'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  unique (season, matchday, club_abbr)
);

create index if not exists idx_weekly_roundups_generated
  on public.weekly_roundups (club_abbr, generated_at desc);

create or replace function public.touch_weekly_roundups_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_weekly_roundups_updated_at on public.weekly_roundups;

create trigger trg_weekly_roundups_updated_at
before update on public.weekly_roundups
for each row
execute function public.touch_weekly_roundups_updated_at();

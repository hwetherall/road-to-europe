create table if not exists public.weekly_roundup_audits (
  id uuid primary key default gen_random_uuid(),
  roundup_id uuid references public.weekly_roundups(id) on delete cascade,
  season text not null,
  matchday integer not null,
  club_abbr text not null,
  generated_at timestamptz not null default now(),
  reviewer_model text not null,
  status text not null check (status in ('passed', 'fixed', 'fallback')),
  issue_count integer not null default 0,
  high_count integer not null default 0,
  medium_count integer not null default 0,
  low_count integer not null default 0,
  issues_json jsonb not null default '[]'::jsonb,
  deterministic_issues_json jsonb not null default '[]'::jsonb,
  summary text not null default '',
  metadata_json jsonb not null default '{}'::jsonb
);

alter table public.weekly_roundup_audits enable row level security;

create index if not exists idx_weekly_roundup_audits_roundup
  on public.weekly_roundup_audits (roundup_id, generated_at desc);

create index if not exists idx_weekly_roundup_audits_matchday
  on public.weekly_roundup_audits (club_abbr, season, matchday, generated_at desc);

create index if not exists idx_weekly_roundup_audits_status
  on public.weekly_roundup_audits (status, generated_at desc);

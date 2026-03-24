create table if not exists public.deep_analysis_reports (
  scenario_key text primary key,
  target_team text not null,
  target_metric text not null,
  target_threshold integer not null,
  analysis jsonb not null,
  path_result jsonb not null,
  ai_warning text not null default '',
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_deep_analysis_reports_target
  on public.deep_analysis_reports (target_team, target_metric, target_threshold);

create or replace function public.touch_deep_analysis_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_deep_analysis_reports_updated_at on public.deep_analysis_reports;

create trigger trg_deep_analysis_reports_updated_at
before update on public.deep_analysis_reports
for each row
execute function public.touch_deep_analysis_reports_updated_at();

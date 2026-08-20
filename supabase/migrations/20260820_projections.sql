-- The Preseason Ledger.
--
-- Locked, timestamped projections published before a matchday is played, then
-- scored every week for the rest of the season. This is what turns Keepwatch
-- from a calculator into a track record.
--
-- IMMUTABILITY IS THE POINT. The unique constraint below means a projection for
-- a given season/matchday/model can be written exactly once. Do NOT add an
-- upsert path, an ON CONFLICT clause, or an update trigger: a track record you
-- can quietly revise is not a track record, and an unscored forecast has no
-- information content at all.

create table if not exists public.projections (
  id                    bigserial primary key,
  created_at            timestamptz not null default now(),
  season                text not null,
  matchday              int not null,     -- 0 = preseason
  model_version         text not null,    -- e.g. 'blend-v1-carryover'
  prior_source          text not null,    -- 'carryover_regressed' | 'market_fitted'
  team                  text not null,
  champion_pct          numeric,
  top4_pct              numeric,
  top7_pct              numeric,
  relegation_pct        numeric,
  avg_points            numeric,
  avg_position          numeric,
  position_distribution jsonb,            -- length-20 array
  unique (season, matchday, model_version, team)
);

create index if not exists idx_projections_lookup
  on public.projections (season, model_version, matchday);

create table if not exists public.projection_scores (
  id             bigserial primary key,
  scored_at      timestamptz not null default now(),
  season         text not null,
  matchday       int not null,
  model_version  text not null,
  metric         text not null,      -- 'top4' | 'top7' | 'relegation' | 'position'
  brier_score    numeric,
  log_loss       numeric,
  rps            numeric             -- ranked probability score, position only
);

create index if not exists idx_projection_scores_lookup
  on public.projection_scores (season, model_version, matchday);

-- Service-role only.
alter table public.projections enable row level security;
alter table public.projection_scores enable row level security;

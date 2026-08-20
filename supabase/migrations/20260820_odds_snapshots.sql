-- Odds snapshot time series.
--
-- Line movement is information that cannot be backfilled: every day this table
-- is not being written is a day of market history permanently lost. That is why
-- it ships before the features that consume it.
--
-- `raw` is stored unconditionally and never trimmed. Parsing logic will change;
-- the payloads will not. Being able to reprocess a whole season against a fixed
-- parser is worth the storage many times over.
--
-- A previous Keepwatch table already occupies this name with a different shape
-- (uuid id, `market`, `snapshot_at`, no `season`). CREATE TABLE IF NOT EXISTS
-- is a no-op against that table, and the indexes below then fail with 42703.
-- Move the old rows aside first; they are 2025-26 h2h snapshots and cannot be
-- reconstructed from the new schema.

do $$
begin
  if to_regclass('public.odds_snapshots') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'odds_snapshots'
         and column_name = 'snapshot_at'
     )
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'odds_snapshots'
         and column_name = 'season'
     )
  then
    alter table public.odds_snapshots rename to odds_snapshots_legacy;
    alter table public.odds_snapshots_legacy
      rename constraint odds_snapshots_pkey to odds_snapshots_legacy_pkey;
    alter index if exists public.idx_odds_snapshots_snapshot_at
      rename to idx_odds_snapshots_legacy_snapshot_at;
    alter index if exists public.idx_odds_snapshots_team_market
      rename to idx_odds_snapshots_legacy_team_market;
  end if;
end $$;

create table if not exists public.odds_snapshots (
  id             bigserial primary key,
  captured_at    timestamptz not null default now(),
  season         text not null,
  source         text not null,        -- 'the-odds-api' | 'kalshi' | 'polymarket'
  market_type    text not null,        -- 'h2h' | 'outright_winner' | 'outright_top4'
                                       -- | 'outright_relegation' | 'points_total'
  fixture_id     text,                 -- h2h only
  home_team      text,                 -- h2h only
  away_team      text,                 -- h2h only
  team           text,                 -- outrights only
  line           numeric,              -- points_total only
  commence_time  timestamptz,
  bookmaker      text,
  price_decimal  numeric,
  implied_prob   numeric,              -- raw 1/price
  devig_prob     numeric,              -- overround-stripped
  raw            jsonb                 -- full payload, for reprocessing
);

create index if not exists idx_odds_snapshots_season_market
  on public.odds_snapshots (season, market_type, captured_at desc);

create index if not exists idx_odds_snapshots_fixture
  on public.odds_snapshots (fixture_id, captured_at desc);

create index if not exists idx_odds_snapshots_team
  on public.odds_snapshots (team, market_type, captured_at desc);

-- Service-role only: the snapshot job writes, API routes read via the service key.
alter table public.odds_snapshots enable row level security;

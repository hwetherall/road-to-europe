-- Odds snapshot time series.
--
-- Line movement is information that cannot be backfilled: every day this table
-- is not being written is a day of market history permanently lost. That is why
-- it ships before the features that consume it.
--
-- `raw` is stored unconditionally and never trimmed. Parsing logic will change;
-- the payloads will not. Being able to reprocess a whole season against a fixed
-- parser is worth the storage many times over.

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

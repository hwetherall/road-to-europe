-- Odds snapshots: one row per team per market per snapshot
CREATE TABLE IF NOT EXISTS odds_snapshots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  market text NOT NULL,
  event_id text,
  team text NOT NULL,
  opponent text,
  bookmaker text NOT NULL DEFAULT 'average',
  odds_decimal numeric,
  implied_prob numeric NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  matchday integer
);

CREATE INDEX IF NOT EXISTS idx_odds_snapshots_team_market
  ON odds_snapshots(team, market, snapshot_at);

CREATE INDEX IF NOT EXISTS idx_odds_snapshots_snapshot_at
  ON odds_snapshots(snapshot_at DESC);

-- Enable RLS but allow service-role full access
ALTER TABLE odds_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on odds_snapshots"
  ON odds_snapshots FOR ALL
  USING (true)
  WITH CHECK (true);

-- Paper bets: tracks value bets identified by comparing model vs market
CREATE TABLE IF NOT EXISTS paper_bets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  team text NOT NULL,
  market text NOT NULL,
  model_prob numeric NOT NULL,
  bookmaker_odds numeric NOT NULL,
  bookmaker_implied_prob numeric NOT NULL,
  edge numeric NOT NULL,
  stake numeric NOT NULL DEFAULT 100,
  expected_value numeric NOT NULL,
  status text NOT NULL DEFAULT 'open',
  pnl numeric,
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  season text NOT NULL,
  matchday integer
);

CREATE INDEX IF NOT EXISTS idx_paper_bets_team
  ON paper_bets(team, market, season);

CREATE INDEX IF NOT EXISTS idx_paper_bets_status
  ON paper_bets(status, season);

-- Enable RLS but allow service-role full access
ALTER TABLE paper_bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on paper_bets"
  ON paper_bets FOR ALL
  USING (true)
  WITH CHECK (true);

-- Cache table for completed What-If analyses
CREATE TABLE IF NOT EXISTS what_if_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_abbr TEXT NOT NULL,
  target_metric TEXT NOT NULL,
  season TEXT NOT NULL DEFAULT '2025-26',
  gameweek INTEGER NOT NULL,
  scenario_key TEXT NOT NULL,
  analysis_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One analysis per team+metric+gameweek per season
  UNIQUE(team_abbr, target_metric, season, gameweek)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_what_if_team ON what_if_analyses(team_abbr, season);
CREATE INDEX IF NOT EXISTS idx_what_if_scenario_key ON what_if_analyses(scenario_key);

-- Auto-delete after 14 days
ALTER TABLE what_if_analyses ENABLE ROW LEVEL SECURITY;

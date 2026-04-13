-- Injury data scraped from premierinjuries.com
-- Upserted twice daily by the injury scraper cron

CREATE TABLE IF NOT EXISTS injuries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core fields from the scraper
  club TEXT NOT NULL,
  player TEXT NOT NULL,
  reason TEXT,
  return_date TEXT,            -- Free text from site, e.g. "Mid April 2026"
  status TEXT,                 -- e.g. "Out", "Doubtful", "Fit"

  -- Normalised club abbreviation for joining against your existing team data
  club_abbr TEXT,

  -- Metadata
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_url TEXT NOT NULL DEFAULT 'https://www.premierinjuries.com/injury-table.php',

  -- One row per player per club — upsert on scrape
  UNIQUE(club, player)
);

-- Fast lookups by club abbreviation (what your AI agents will query)
CREATE INDEX IF NOT EXISTS idx_injuries_club_abbr ON injuries(club_abbr);

-- Fast staleness check
CREATE INDEX IF NOT EXISTS idx_injuries_scraped_at ON injuries(scraped_at);

-- Optional: auto-cleanup of stale records older than 30 days
-- (Players who recovered and dropped off the site won't get re-upserted,
--  so they'll age out naturally)
-- CREATE POLICY ... or handle in application code.

-- RLS: service-role only (scraper writes, API routes read via service key)
ALTER TABLE injuries ENABLE ROW LEVEL SECURITY;
#!/usr/bin/env python3
"""
Premier League Injury Scraper → Supabase
Scrapes injury data from https://www.premierinjuries.com/injury-table.php
Upserts into the `injuries` table in Supabase.

Requirements:
  pip install selenium beautifulsoup4 pandas supabase python-dotenv

Environment variables (or .env file):
  SUPABASE_URL=https://xxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJ...
"""

import os
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
from bs4 import BeautifulSoup

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options
    from selenium.common.exceptions import TimeoutException
except ImportError:
    print("Selenium is required. Install with:  pip install selenium")
    sys.exit(1)

try:
    from supabase import create_client, Client as SupabaseClient
except ImportError:
    print("Supabase client required. Install with:  pip install supabase")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional — env vars can be set directly


# ---------------------------------------------------------------------------
# 0.  Club name → abbreviation mapping
#     Must match the abbreviations used in your Keepwatch codebase
# ---------------------------------------------------------------------------

CLUB_ABBR_MAP: dict[str, str] = {
    "Arsenal":              "ARS",
    "Aston Villa":          "AVL",
    "AFC Bournemouth":      "BOU",
    "Bournemouth":          "BOU",
    "Brentford":            "BRE",
    "Brighton & Hove Albion": "BRI",
    "Brighton":             "BRI",
    "Burnley":              "BUR",
    "Chelsea":              "CFC",
    "Crystal Palace":       "CRY",
    "Everton":              "EVE",
    "Fulham":               "FUL",
    "Leeds United":         "LEE",
    "Leeds":                "LEE",
    "Liverpool":            "LFC",
    "Manchester City":      "MCI",
    "Man City":             "MCI",
    "Manchester United":    "MUN",
    "Man Utd":              "MUN",
    "Man United":           "MUN",
    "Newcastle United":     "NEW",
    "Newcastle":            "NEW",
    "Nottingham Forest":    "NFO",
    "Nott'm Forest":        "NFO",
    "Sunderland":           "SUN",
    "Tottenham Hotspur":    "TOT",
    "Tottenham":            "TOT",
    "Spurs":                "TOT",
    "West Ham United":      "WHU",
    "West Ham":             "WHU",
    "Wolverhampton Wanderers": "WOL",
    "Wolves":               "WOL",
}


def resolve_club_abbr(club_name: str) -> str | None:
    """
    Try to match a scraped club name to our abbreviation system.
    Falls back to fuzzy prefix matching if exact match fails.
    """
    # Exact match first
    if club_name in CLUB_ABBR_MAP:
        return CLUB_ABBR_MAP[club_name]

    # Case-insensitive match
    lower = club_name.lower().strip()
    for key, abbr in CLUB_ABBR_MAP.items():
        if key.lower() == lower:
            return abbr

    # Prefix/contains fallback
    for key, abbr in CLUB_ABBR_MAP.items():
        if lower.startswith(key.lower()[:6]) or key.lower().startswith(lower[:6]):
            return abbr

    print(f"  WARNING: Could not map club '{club_name}' to an abbreviation.", file=sys.stderr)
    return None


# ---------------------------------------------------------------------------
# 1.  Fetch the fully-rendered page with Selenium
# ---------------------------------------------------------------------------

def _build_driver() -> webdriver.Chrome:
    """Create a headless Chrome WebDriver."""
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    )
    return webdriver.Chrome(options=opts)


def fetch_page(url: str = "https://www.premierinjuries.com/injury-table.php",
               wait_seconds: int = 8) -> str | None:
    """
    Load the injury-table page and return its fully-rendered HTML.
    Returns None on failure.
    """
    driver = _build_driver()
    try:
        driver.get(url)
        WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.TAG_NAME, "table"))
        )
        time.sleep(wait_seconds)
        return driver.page_source
    except TimeoutException:
        print("ERROR: Timed out waiting for the page to load.", file=sys.stderr)
        return None
    finally:
        driver.quit()


# ---------------------------------------------------------------------------
# 2.  Parse the HTML and extract injury records
# ---------------------------------------------------------------------------

def _clean_cell(cell) -> str:
    """Extract text from a cell, stripping mob-title labels and links."""
    # Work on a copy so we don't mutate the original tree
    from copy import copy
    cell = copy(cell)
    # Remove <div class="mob-title"> labels (e.g. "Player", "Reason")
    for div in cell.find_all("div", class_="mob-title"):
        div.decompose()
    # Remove <a> links (e.g. "See Player Page")
    for a in cell.find_all("a"):
        a.decompose()
    # Remove track-player divs (notification bell buttons)
    for div in cell.find_all("div", class_="track-player"):
        div.decompose()
    return cell.get_text(strip=True)


def parse_injury_table(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    if not tables:
        print("ERROR: No <table> elements found on the page.", file=sys.stderr)
        return []

    main_table = max(tables, key=lambda t: len(t.find_all("tr")))
    current_club: str | None = None
    records: list[dict] = []

    for row in main_table.find_all("tr"):
        row_classes = row.get("class", [])

        # Club header row (e.g. class="heading")
        if "heading" in row_classes:
            team_div = row.find("div", class_="injury-team")
            current_club = team_div.get_text(strip=True) if team_div else "Unknown"
            continue

        # Skip column-header rows (e.g. class="sub-head")
        if "sub-head" in row_classes:
            continue

        # Player rows (e.g. class="player-row")
        if "player-row" not in row_classes:
            continue

        cells = row.find_all(["td", "th"])
        # Columns: Player, Reason, Further Detail, Potential Return, Condition, Status, Track
        texts = [_clean_cell(c) for c in cells]

        player      = texts[0] if len(texts) > 0 else ""
        reason      = texts[1] if len(texts) > 1 else ""
        return_date = texts[3] if len(texts) > 3 else ""  # col 3 = Potential Return
        condition   = texts[4] if len(texts) > 4 else ""  # col 4 = Condition
        status      = texts[5] if len(texts) > 5 else ""  # col 5 = Status

        if not player:
            continue

        records.append({
            "Club":        current_club or "Unknown",
            "Player":      player,
            "Reason":      reason,
            "Return Date": return_date,
            "Status":      f"{condition} - {status}" if condition and status else condition or status,
        })

    return records


# ---------------------------------------------------------------------------
# 3.  Supabase upsert
# ---------------------------------------------------------------------------

def get_supabase_client() -> SupabaseClient:
    """Create a Supabase client using service-role key."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
        sys.exit(1)

    return create_client(url, key)


def upsert_injuries(client: SupabaseClient, records: list[dict]) -> dict:
    """
    Upsert injury records into Supabase.
    Returns a summary dict with counts.
    """
    now = datetime.now(timezone.utc).isoformat()
    rows = []

    for record in records:
        club = record["Club"].strip()
        player = record["Player"].strip()
        if not player:
            continue

        rows.append({
            "club":        club,
            "player":      player,
            "reason":      record.get("Reason", "").strip() or None,
            "return_date": record.get("Return Date", "").strip() or None,
            "status":      record.get("Status", "").strip() or None,
            "club_abbr":   resolve_club_abbr(club),
            "scraped_at":  now,
        })

    if not rows:
        return {"upserted": 0, "errors": 0}

    # Batch upsert — Supabase handles ON CONFLICT (club, player) DO UPDATE
    result = (
        client.table("injuries")
        .upsert(rows, on_conflict="club,player")
        .execute()
    )

    return {
        "upserted": len(result.data) if result.data else 0,
        "total_sent": len(rows),
    }


def cleanup_stale_records(client: SupabaseClient, max_age_days: int = 30) -> int:
    """
    Delete injury records that haven't been refreshed in `max_age_days`.
    These are players who recovered and dropped off the source site.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()

    result = (
        client.table("injuries")
        .delete()
        .lt("scraped_at", cutoff)
        .execute()
    )

    return len(result.data) if result.data else 0


# ---------------------------------------------------------------------------
# 4.  Health check — catches site layout changes
# ---------------------------------------------------------------------------

def health_check(df: pd.DataFrame) -> list[str]:
    """
    Return a list of warnings. Empty list = healthy.
    """
    warnings = []

    if len(df) < 20:
        warnings.append(f"Only {len(df)} injured players found — suspiciously low. Site layout may have changed.")

    club_count = df["Club"].nunique()
    if club_count < 10:
        warnings.append(f"Only {club_count} clubs found — expected ~20. Parsing may be broken.")

    # Any club with zero injuries is unusual mid-season
    # (Not a hard failure, but worth logging)
    clubs_with_data = set(df["Club"].unique())
    expected_clubs = set(CLUB_ABBR_MAP.keys())
    # This is a soft check — different naming might cause false positives

    return warnings


# ---------------------------------------------------------------------------
# 5.  Main entry point
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  Premier League Injury Scraper → Supabase")
    print(f"  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    # --- Scrape ---
    print("\n[1/4] Fetching page …")
    html = fetch_page()
    if html is None:
        print("FATAL: Failed to load the page.", file=sys.stderr)
        sys.exit(1)

    # --- Parse ---
    print("[2/4] Parsing injury table …")
    records = parse_injury_table(html)
    if not records:
        print("FATAL: No injury records found.", file=sys.stderr)
        sys.exit(1)

    df = pd.DataFrame(records, columns=["Club", "Player", "Reason", "Return Date", "Status"])
    df = df[df["Player"].str.strip() != ""]
    for col in df.columns:
        df[col] = df[col].str.strip()

    print(f"  Found {len(df)} injured players across {df['Club'].nunique()} clubs.")

    # --- Health check ---
    print("[3/4] Running health check …")
    warnings = health_check(df)
    if warnings:
        for w in warnings:
            print(f"  ⚠️  {w}")
        # Don't exit — still upsert what we have, but log the warnings
    else:
        print("  ✓ All checks passed.")

    # --- Upsert to Supabase ---
    print("[4/4] Upserting to Supabase …")
    client = get_supabase_client()
    result = upsert_injuries(client, records)
    print(f"  Upserted {result['upserted']}/{result['total_sent']} records.")

    # --- Cleanup stale ---
    stale_deleted = cleanup_stale_records(client)
    if stale_deleted:
        print(f"  Cleaned up {stale_deleted} stale records (>30 days old).")

    print("\nDone.\n")

    # Return the dataframe for local inspection if called as a module
    return df


if __name__ == "__main__":
    main()
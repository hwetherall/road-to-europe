import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ODDS_API_NAME_MAP } from '@/lib/constants';
import { OddsEntry } from '@/lib/live-data';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabaseAdmin(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// EPL outright markets (league winner, relegation) are NOT available
// on The Odds API for soccer_epl. The API returns HTTP 422 when
// requesting markets=outrights, and no soccer_epl_winner sport key exists.
// Outright-style analysis uses our Monte Carlo simulation output instead.

// ── Write snapshots to Supabase ──

interface SnapshotRow {
  market: string;
  event_id: string | null;
  team: string;
  opponent: string | null;
  bookmaker: string;
  odds_decimal: number | null;
  implied_prob: number;
  snapshot_at: string;
  matchday: number | null;
}

export async function writeOddsSnapshots(
  h2hOdds: OddsEntry[],
  currentMatchday?: number,
): Promise<{ inserted: number; error: string | null }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { inserted: 0, error: 'Supabase not configured' };

  const now = new Date().toISOString();
  const rows: SnapshotRow[] = [];

  for (const entry of h2hOdds) {
    const homeAbbr = ODDS_API_NAME_MAP[entry.homeTeam];
    const awayAbbr = ODDS_API_NAME_MAP[entry.awayTeam];
    if (!homeAbbr || !awayAbbr) continue;

    if (entry.homeWin > 0) {
      rows.push({
        market: 'h2h',
        event_id: null,
        team: homeAbbr,
        opponent: awayAbbr,
        bookmaker: 'average',
        odds_decimal: Math.round((1 / entry.homeWin) * 100) / 100,
        implied_prob: entry.homeWin,
        snapshot_at: now,
        matchday: currentMatchday ?? null,
      });
    }

    if (entry.awayWin > 0) {
      rows.push({
        market: 'h2h',
        event_id: null,
        team: awayAbbr,
        opponent: homeAbbr,
        bookmaker: 'average',
        odds_decimal: Math.round((1 / entry.awayWin) * 100) / 100,
        implied_prob: entry.awayWin,
        snapshot_at: now,
        matchday: currentMatchday ?? null,
      });
    }
  }

  if (rows.length === 0) return { inserted: 0, error: null };

  const { error } = await supabase.from('odds_snapshots').insert(rows);
  if (error) return { inserted: 0, error: error.message };
  return { inserted: rows.length, error: null };
}

// ── Read snapshots from Supabase ──

export interface OddsSnapshotRecord {
  id: string;
  market: string;
  event_id: string | null;
  team: string;
  opponent: string | null;
  bookmaker: string;
  odds_decimal: number | null;
  implied_prob: number;
  snapshot_at: string;
  matchday: number | null;
}

export async function getOddsHistory(params: {
  team?: string;
  market?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<OddsSnapshotRecord[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  let query = supabase
    .from('odds_snapshots')
    .select('*')
    .order('snapshot_at', { ascending: true });

  if (params.team) query = query.eq('team', params.team);
  if (params.market) query = query.eq('market', params.market);
  if (params.from) query = query.gte('snapshot_at', params.from);
  if (params.to) query = query.lte('snapshot_at', params.to);
  if (params.limit) query = query.limit(params.limit);

  const { data, error } = await query;
  if (error || !data) return [];
  return data as OddsSnapshotRecord[];
}

// Returns the most recent stored h2h implied prob for each team-opponent pair.
// Keyed as "HOME-AWAY" -> { homeWin, drawWin, awayWin, snapshotAt }
export interface StoredH2HOdds {
  homeWin: number;
  awayWin: number;
  snapshotAt: string;
}

export async function getLatestStoredH2H(): Promise<Map<string, StoredH2HOdds>> {
  const supabase = getSupabaseAdmin();
  const result = new Map<string, StoredH2HOdds>();
  if (!supabase) return result;

  // For each team-opponent pair in h2h, get the most recent snapshot row.
  // We use a single query fetching all h2h rows from the latest snapshot date.
  const { data: latestRow } = await supabase
    .from('odds_snapshots')
    .select('snapshot_at')
    .eq('market', 'h2h')
    .order('snapshot_at', { ascending: false })
    .limit(1);

  if (!latestRow || latestRow.length === 0) return result;

  const { data, error } = await supabase
    .from('odds_snapshots')
    .select('team, opponent, implied_prob, snapshot_at')
    .eq('market', 'h2h')
    .eq('snapshot_at', latestRow[0].snapshot_at);

  if (error || !data) return result;

  // Group by team-opponent. Each fixture creates two rows (one for each team).
  // Pair them up to reconstruct homeWin / awayWin.
  const byPair = new Map<string, { homeWin?: number; awayWin?: number; snapshotAt: string }>();

  for (const row of data as OddsSnapshotRecord[]) {
    if (!row.opponent) continue;
    const key = `${row.team}-${row.opponent}`;
    const reverseKey = `${row.opponent}-${row.team}`;

    // This row represents "team" prob of winning against "opponent"
    if (byPair.has(key)) {
      byPair.get(key)!.homeWin = row.implied_prob;
    } else if (byPair.has(reverseKey)) {
      byPair.get(reverseKey)!.awayWin = row.implied_prob;
    } else {
      byPair.set(key, { homeWin: row.implied_prob, snapshotAt: row.snapshot_at });
    }
  }

  for (const [key, val] of byPair) {
    if (val.homeWin !== undefined && val.awayWin !== undefined) {
      result.set(key, {
        homeWin: val.homeWin,
        awayWin: val.awayWin,
        snapshotAt: val.snapshotAt,
      });
    }
  }

  return result;
}


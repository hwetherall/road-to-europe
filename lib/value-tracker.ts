import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Fixture, SimulationResult } from '@/lib/types';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EDGE_THRESHOLD = 0.05;
const DEFAULT_STAKE = 100;

function getSupabaseAdmin(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface PaperBet {
  id: string;
  team: string;
  market: string;
  model_prob: number;
  bookmaker_odds: number;
  bookmaker_implied_prob: number;
  edge: number;
  stake: number;
  expected_value: number;
  status: string;
  pnl: number | null;
  placed_at: string;
  settled_at: string | null;
  season: string;
  matchday: number | null;
}

// Compare model match probabilities (from Elo/sim) against bookmaker h2h odds.
// For each fixture with odds_api source, check if any outcome (home/draw/away)
// has a model edge >= threshold.
export async function detectAndPlaceH2HValueBets(params: {
  fixtures: Fixture[];
  simResults: SimulationResult[];
  season: string;
  matchday?: number;
  edgeThreshold?: number;
  stake?: number;
}): Promise<{ placed: number; skipped: number; error: string | null }> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { placed: 0, skipped: 0, error: 'Supabase not configured' };

  const threshold = params.edgeThreshold ?? EDGE_THRESHOLD;
  const stake = params.stake ?? DEFAULT_STAKE;
  let placed = 0;
  let skipped = 0;

  const oddsFixtures = params.fixtures.filter(
    (f) => f.status === 'SCHEDULED' && f.probSource === 'odds_api' &&
    f.homeWinProb !== undefined && f.drawProb !== undefined && f.awayWinProb !== undefined
  );

  if (oddsFixtures.length === 0) return { placed: 0, skipped: 0, error: null };

  const { data: existingBets } = await supabase
    .from('paper_bets')
    .select('team, market, matchday')
    .eq('season', params.season)
    .eq('status', 'open');

  const existingKeys = new Set(
    (existingBets ?? []).map(
      (b: { team: string; market: string; matchday: number | null }) =>
        `${b.team}-${b.market}-${b.matchday}`
    )
  );

  const betsToInsert: Array<Record<string, unknown>> = [];

  for (const fixture of oddsFixtures) {
    // Bookmaker implied probs are already de-vigged and stored on the fixture
    const bookHome = fixture.homeWinProb!;
    const bookDraw = fixture.drawProb!;
    const bookAway = fixture.awayWinProb!;

    // Our model probs come from Monte Carlo sim results
    // We don't have per-match model probs separate from bookmaker here,
    // but we DO have Elo-based probs we can compare against.
    // For h2h value bets, we use the Elo model as our "model" and compare
    // against bookmaker implied probs. The fixture already has these merged,
    // so we need to look at the raw data differently.
    //
    // Since odds_api fixtures already have bookmaker probs, we check for
    // edge by comparing to what our simulation produces.
    // SimulationResult tracks seasonal outcomes, not per-match probs,
    // so for h2h we compare bookmaker prob vs bookmaker prob (no edge).
    //
    // The real value: flag when bookmaker odds shift significantly.
    // For now, just record all match odds as data points.

    const outcomes = [
      { team: fixture.homeTeam, market: `h2h_win`, prob: bookHome, label: 'home_win' },
      { team: fixture.awayTeam, market: `h2h_win`, prob: bookAway, label: 'away_win' },
    ];

    for (const outcome of outcomes) {
      // Use very generous odds as "model" baseline: if a team has >60% implied
      // prob from bookmakers but their season form suggests otherwise, flag it
      const teamSim = params.simResults.find((r) => r.team === outcome.team);
      if (!teamSim) continue;

      // Average expected points per match from the sim as a rough form indicator
      const gamesRemaining = oddsFixtures.filter(
        (f) => f.homeTeam === outcome.team || f.awayTeam === outcome.team
      ).length;
      if (gamesRemaining === 0) continue;

      // For h2h value, the bookmaker prob IS the market price.
      // We record it for tracking; edge detection requires an independent model.
      // For now: store all h2h odds as paper observations, not as bets.
      const bookmakerOdds = outcome.prob > 0 ? 1 / outcome.prob : 0;
      if (bookmakerOdds <= 1) continue;

      const dedupKey = `${outcome.team}-${outcome.market}-${fixture.matchday}`;
      if (existingKeys.has(dedupKey)) {
        skipped++;
        continue;
      }

      // Only place a bet if bookmaker is offering odds that our form analysis
      // suggests are too generous (implied prob < avg points ratio)
      const avgPtsPerGame = teamSim.avgPoints / 38;
      const formImpliedWinRate = avgPtsPerGame / 3; // rough: 3pts = win
      const edge = formImpliedWinRate - outcome.prob;

      if (edge < threshold) {
        skipped++;
        continue;
      }

      const expectedValue = Math.round(stake * (formImpliedWinRate * bookmakerOdds - 1) * 100) / 100;

      betsToInsert.push({
        team: outcome.team,
        market: outcome.market,
        model_prob: Math.round(formImpliedWinRate * 10000) / 10000,
        bookmaker_odds: Math.round(bookmakerOdds * 100) / 100,
        bookmaker_implied_prob: Math.round(outcome.prob * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        stake,
        expected_value: expectedValue,
        status: 'open',
        season: params.season,
        matchday: fixture.matchday ?? null,
      });

      existingKeys.add(dedupKey);
    }
  }

  if (betsToInsert.length === 0) {
    return { placed: 0, skipped, error: null };
  }

  const { error } = await supabase.from('paper_bets').insert(betsToInsert);
  if (error) return { placed: 0, skipped, error: error.message };

  placed = betsToInsert.length;
  return { placed, skipped, error: null };
}

// ── Read paper bets ──

export async function getPaperBets(params?: {
  season?: string;
  status?: string;
  team?: string;
  market?: string;
}): Promise<PaperBet[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];

  let query = supabase
    .from('paper_bets')
    .select('*')
    .order('placed_at', { ascending: false });

  if (params?.season) query = query.eq('season', params.season);
  if (params?.status) query = query.eq('status', params.status);
  if (params?.team) query = query.eq('team', params.team);
  if (params?.market) query = query.eq('market', params.market);

  const { data, error } = await query;
  if (error || !data) return [];
  return data as PaperBet[];
}

// ── P&L summary ──

export interface PaperBetSummary {
  totalBets: number;
  openBets: number;
  settledBets: number;
  totalStaked: number;
  totalPnl: number;
  openExpectedValue: number;
  roi: number;
  avgEdge: number;
}

export function computePaperBetSummary(bets: PaperBet[]): PaperBetSummary {
  const open = bets.filter((b) => b.status === 'open');
  const settled = bets.filter((b) => b.status === 'won' || b.status === 'lost');

  const totalStaked = settled.reduce((sum, b) => sum + b.stake, 0);
  const totalPnl = settled.reduce((sum, b) => sum + (b.pnl ?? 0), 0);
  const openEv = open.reduce((sum, b) => sum + b.expected_value, 0);
  const avgEdge = bets.length > 0
    ? bets.reduce((sum, b) => sum + b.edge, 0) / bets.length
    : 0;

  return {
    totalBets: bets.length,
    openBets: open.length,
    settledBets: settled.length,
    totalStaked,
    totalPnl: Math.round(totalPnl * 100) / 100,
    openExpectedValue: Math.round(openEv * 100) / 100,
    roi: totalStaked > 0 ? Math.round((totalPnl / totalStaked) * 10000) / 100 : 0,
    avgEdge: Math.round(avgEdge * 10000) / 100,
  };
}

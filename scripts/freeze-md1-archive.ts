/**
 * Freeze whatever pre-MD1 / post-MD1 engine state still exists, then try to
 * replay the published MD0 Ledger from reconstructed inputs.
 *
 * Read-only against Supabase except for the local JSON writes.
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLUBS, abbrFor } from '@/lib/clubs';
import { teamElo, eloProb } from '@/lib/elo';
import { getLiveSnapshot } from '@/lib/live-data';
import { simulate } from '@/lib/montecarlo';
import { averageBookmakerOdds } from '@/lib/odds-converter';
import { SENSITIVITY_SEED } from '@/lib/sensitivity';
import type { Fixture, Team } from '@/lib/types';

for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n')) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const k = trimmed.slice(0, eq);
  const v = trimmed.slice(eq + 1);
  if (process.env[k] === undefined) process.env[k] = v;
}

const DIR = join(process.cwd(), 'data', 'archives');
mkdirSync(DIR, { recursive: true });

async function main() {

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const fdKey = process.env.FOOTBALL_DATA_API_KEY;
if (!url || !key || !fdKey) {
  throw new Error('missing credentials');
}

const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PRE_MD1_CAPTURE = '2026-08-20T22:11:09.47+00:00';
const LEDGER_PUBLISHED = '2026-08-20T22:25:14.341667+00:00';
const MD1_FIRST_KICK = '2026-08-21T19:00:00Z';

function write(name: string, value: unknown) {
  const path = join(DIR, name);
  writeFileSync(path, JSON.stringify(value, null, 2));
  console.log(`wrote ${name}`);
}

function zeroedTeams(): Team[] {
  return CLUBS.map((club, index) => ({
    id: String(index + 1),
    name: club.name,
    abbr: club.abbr,
    points: 0,
    goalDifference: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
  }));
}

function summarizeSnapshot(label: string, teams: Team[], fixtures: Fixture[]) {
  const scheduled = fixtures.filter((f) => f.status === 'SCHEDULED');
  const newcastle = teams.find((t) => t.abbr === 'NEW');
  return {
    label,
    leaguePlayed: teams.reduce((s, t) => s + t.played, 0),
    newcastle: newcastle
      ? { played: newcastle.played, points: newcastle.points, gd: newcastle.goalDifference }
      : null,
    fixtures: fixtures.length,
    scheduled: scheduled.length,
    finished: fixtures.filter((f) => f.status === 'FINISHED').length,
    oddsPriced: scheduled.filter((f) => f.probSource === 'odds_api').length,
    eloPriced: scheduled.filter((f) => f.probSource === 'elo_estimated').length,
    unpriced: scheduled.filter((f) => f.homeWinProb == null).length,
  };
}

// --- 1. Dump every 2026-27 odds snapshot. PostgREST defaults to 1000 rows;
// without pagination this looks like two Aug 20 captures and nothing else.
{
  type OddsRow = {
    captured_at: string;
    source: string;
    market_type: string;
    home_team: string | null;
    away_team: string | null;
  };
  const ordered: Array<OddsRow & Record<string, unknown>> = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb
      .from('odds_snapshots')
      .select('*')
      .eq('season', '2026-27')
      .order('captured_at', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    ordered.push(...((data ?? []) as Array<OddsRow & Record<string, unknown>>));
    console.log(`odds page ${from}-${from + page - 1}: ${data?.length ?? 0} (running ${ordered.length})`);
    if ((data ?? []).length < page) break;
  }

  const stamps = [...new Set(ordered.map((r) => r.captured_at))].sort();
  const captures = stamps.map((ts) => {
    const slice = ordered.filter((r) => r.captured_at === ts);
    const h2h = [
      ...new Set(
        slice.filter((r) => r.home_team && r.away_team).map((r) => `${r.home_team}-${r.away_team}`)
      ),
    ].sort();
    const sources: Record<string, number> = {};
    for (const r of slice) {
      const k = `${r.source}:${r.market_type}`;
      sources[k] = (sources[k] ?? 0) + 1;
    }
    return {
      captured_at: ts,
      rows: slice.length,
      beforeMd1Kickoff: ts < MD1_FIRST_KICK,
      sources,
      h2hPairs: h2h,
    };
  });

  write('2026-27-odds-captures.json', {
    frozenAt: new Date().toISOString(),
    md1FirstKick: MD1_FIRST_KICK,
    rowCount: ordered.length,
    captureCount: captures.length,
    preKickoffCaptures: captures.filter((c) => c.beforeMd1Kickoff).length,
    captures,
  });
  write('2026-27-odds-snapshots.json', {
    frozenAt: new Date().toISOString(),
    note: 'Full copy of odds_snapshots for 2026-27. PostgREST pages of 1000; do not trust a single .select().',
    rowCount: ordered.length,
    captureTimestamps: stamps,
    rows: ordered,
  });
}

// --- 2. Freeze the CURRENT live snapshot. MD1 is finished; MD2 is Friday.
// This is the post-MD1 / pre-MD2 information set. Live Elo already includes
// MD1 results. Once NEW-TOT kicks off Saturday this cannot be reconstructed
// from "current" any more without an archive.
{
  const live = await getLiveSnapshot();
  write('2026-27-post-md1-engine.json', {
    frozenAt: new Date().toISOString(),
    kind: 'post-md1-pre-md2',
    warning:
      'This is AFTER matchday 1 results. Ratings already include MD1. It is the archive of the current information set, not the pre-MD1 information set.',
    standingsSource: live.standingsSource,
    fixturesSource: live.fixturesSource,
    oddsSource: live.oddsSource,
    oddsCoverage: live.oddsCoverage,
    summary: summarizeSnapshot('post-md1', live.teams, live.fixtures),
    teams: live.teams,
    fixtures: live.fixtures,
  });
}

// --- 3. Reconstruct pre-MD1 engine inputs from football-data + the 22:11 odds
// capture (the last full snapshot before the Ledger published at 22:25).
{
  const matchesRes = await fetch('https://api.football-data.org/v4/competitions/PL/matches', {
    headers: { 'X-Auth-Token': fdKey },
  });
  if (!matchesRes.ok) throw new Error(`football-data matches HTTP ${matchesRes.status}`);
  const matchesJson = (await matchesRes.json()) as {
    matches?: Array<{
      id?: number;
      utcDate: string;
      matchday: number;
      status: string;
      homeTeam: { name: string; tla: string };
      awayTeam: { name: string; tla: string };
      score?: { fullTime?: { home?: number | null; away?: number | null } };
    }>;
  };
  const matches = [...(matchesJson.matches ?? [])].sort(
    (a, b) => a.utcDate.localeCompare(b.utcDate) || (a.id ?? 0) - (b.id ?? 0)
  );

  const { data: oddsRows, error } = await sb
    .from('odds_snapshots')
    .select('home_team, away_team, team, bookmaker, price_decimal')
    .eq('captured_at', PRE_MD1_CAPTURE)
    .eq('source', 'the-odds-api')
    .eq('market_type', 'h2h');
  if (error) throw new Error(error.message);

  type Triple = { homeOdds: number; drawOdds: number; awayOdds: number };
  const byFixtureBook = new Map<string, Triple>();
  for (const row of oddsRows ?? []) {
    const key = `${row.home_team}-${row.away_team}::${row.bookmaker}`;
    const current = byFixtureBook.get(key) ?? { homeOdds: 0, drawOdds: 0, awayOdds: 0 };
    if (row.team === row.home_team) current.homeOdds = Number(row.price_decimal);
    else if (row.team === row.away_team) current.awayOdds = Number(row.price_decimal);
    else if (row.team === 'DRAW') current.drawOdds = Number(row.price_decimal);
    byFixtureBook.set(key, current);
  }
  const oddsByPair = new Map<string, { homeWin: number; draw: number; awayWin: number }>();
  const grouped = new Map<string, Triple[]>();
  for (const [key, triple] of byFixtureBook) {
    if (!triple.homeOdds || !triple.drawOdds || !triple.awayOdds) continue;
    const pair = key.split('::')[0];
    const list = grouped.get(pair) ?? [];
    list.push(triple);
    grouped.set(pair, list);
  }
  for (const [pair, triples] of grouped) {
    const avg = averageBookmakerOdds(triples);
    if (avg) oddsByPair.set(pair, avg);
  }

  const teams = zeroedTeams();
  const fixtures: Fixture[] = matches.map((match, index) => {
    const home = abbrFor(match.homeTeam.name) ?? abbrFor(match.homeTeam.tla);
    const away = abbrFor(match.awayTeam.name) ?? abbrFor(match.awayTeam.tla);
    if (!home || !away) {
      throw new Error(`unmapped ${match.homeTeam.name} v ${match.awayTeam.name}`);
    }
    const base: Fixture = {
      id: String(match.id ?? index),
      homeTeam: home,
      awayTeam: away,
      matchday: match.matchday,
      date: match.utcDate,
      status: 'SCHEDULED',
      homeScore: match.score?.fullTime?.home ?? undefined,
      awayScore: match.score?.fullTime?.away ?? undefined,
      probSource: 'elo_estimated',
    };
    const liveOdds = oddsByPair.get(`${home}-${away}`);
    if (liveOdds) {
      return {
        ...base,
        homeWinProb: liveOdds.homeWin,
        drawProb: liveOdds.draw,
        awayWinProb: liveOdds.awayWin,
        probSource: 'odds_api',
      };
    }
    const homeTeam = teams.find((t) => t.abbr === home);
    const awayTeam = teams.find((t) => t.abbr === away);
    if (!homeTeam || !awayTeam) return base;
    const probs = eloProb(teamElo(homeTeam), teamElo(awayTeam));
    return {
      ...base,
      homeWinProb: probs.homeWin,
      drawProb: probs.draw,
      awayWinProb: probs.awayWin,
      probSource: 'elo_estimated',
    };
  });

  write('2026-27-pre-md1-engine.json', {
    frozenAt: new Date().toISOString(),
    kind: 'reconstructed-pre-md1',
    warning:
      'NOT a bit-for-bit copy of the 20 Aug live snapshot. Reconstructed from football-data (all 380, status forced to SCHEDULED, sorted utcDate then id) plus the-odds-api h2h consensus at 2026-08-20T22:11:09Z, with Elo from preseason priors for the other 370. Fixture array order is the RNG key — if football-data’s 20 Aug SCHEDULED order differed, a replay will not match the Ledger exactly.',
    oddsCaptureUsed: PRE_MD1_CAPTURE,
    ledgerPublishedAt: LEDGER_PUBLISHED,
    md1FirstKick: MD1_FIRST_KICK,
    seed: SENSITIVITY_SEED,
    ledgerSims: 100000,
    summary: summarizeSnapshot('reconstructed-pre-md1', teams, fixtures),
    oddsPricedPairs: [...oddsByPair.keys()].sort(),
    teams,
    fixtures,
  });

  // --- 4. Replay vs published Ledger.
  // Query through this script's client: lib/ledger/projections.ts captures
  // SUPABASE_* at import time, which is before .env is loaded here.
  const { data: publishedRows, error: publishedError } = await sb
    .from('projections')
    .select('team, champion_pct, top7_pct, relegation_pct, avg_points, matchday, model_version, created_at')
    .eq('season', '2026-27')
    .eq('matchday', 0)
    .eq('model_version', 'blend-v1-hybrid');
  if (publishedError) throw new Error(publishedError.message);
  const published = publishedRows ?? [];
  console.log(`published ledger rows: ${published.length}`);
  if (published.length !== 20) {
    throw new Error(`expected 20 published MD0 rows, got ${published.length}`);
  }
  console.log(`replaying 100,000 sims with seed ${SENSITIVITY_SEED}...`);
  const started = Date.now();
  const results = simulate(teams, fixtures, 100000, SENSITIVITY_SEED);
  console.log(`replay finished in ${Date.now() - started}ms`);

  const comparison = published
    .map((row) => {
      const sim = results.find((r) => r.team === row.team);
      if (!sim) return { team: row.team, missing: true };
      return {
        team: row.team,
        published: {
          champion_pct: row.champion_pct,
          top7_pct: row.top7_pct,
          relegation_pct: row.relegation_pct,
          avg_points: row.avg_points,
        },
        replay: {
          champion_pct: Math.round(sim.championPct * 1000) / 1000,
          top7_pct: Math.round(sim.top7Pct * 1000) / 1000,
          relegation_pct: Math.round(sim.relegationPct * 1000) / 1000,
          avg_points: Math.round(sim.avgPoints * 1000) / 1000,
        },
        delta: {
          champion_pp: Math.round((sim.championPct - row.champion_pct) * 1000) / 1000,
          top7_pp: Math.round((sim.top7Pct - row.top7_pct) * 1000) / 1000,
          relegation_pp: Math.round((sim.relegationPct - row.relegation_pct) * 1000) / 1000,
          avg_points: Math.round((sim.avgPoints - row.avg_points) * 1000) / 1000,
        },
      };
    })
    .sort((a, b) => Math.abs((b.delta?.top7_pp ?? 0)) - Math.abs((a.delta?.top7_pp ?? 0)));

  const maxAbsTop7 = Math.max(...comparison.map((c) => Math.abs(c.delta?.top7_pp ?? 99)));
  const newRow = comparison.find((c) => c.team === 'NEW');
  write('2026-27-md0-replay-check.json', {
    frozenAt: new Date().toISOString(),
    seed: SENSITIVITY_SEED,
    numSims: 100000,
    elapsedMs: Date.now() - started,
    maxAbsTop7Pp: maxAbsTop7,
    replayMatchesLedger: maxAbsTop7 < 0.05,
    practicallyClose: maxAbsTop7 < 0.5,
    newcastle: newRow,
    comparison,
  });
}

console.log('done');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

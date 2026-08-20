import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CURRENT_SEASON } from '@/lib/constants';
import { abbrFor } from '@/lib/clubs';
import { oddsToProb } from '@/lib/odds-converter';
import { fetchKalshiSeasonMarkets } from '@/lib/odds/kalshi';

/**
 * Odds snapshot job.
 *
 * WHY THIS SHIPS BEFORE THE FEATURES THAT USE IT
 *
 * Line movement cannot be backfilled. Every day this job is not running is a day
 * of market history permanently gone — you can always compute a new statistic
 * from stored prices, but you can never recover a price you did not store. So it
 * writes the raw payload unconditionally and never trims it: parsing logic will
 * change, the payloads will not, and being able to reprocess a whole season
 * against a fixed parser is worth the storage many times over.
 *
 * WHAT IT CAPTURES
 *
 *   h2h        the-odds-api, per-fixture match odds, de-vigged across the three
 *              outcomes. Costs one request against a 500/month quota.
 *   outrights  Kalshi season-long markets — title, relegation, points totals.
 *              Free and unauthenticated. See lib/odds/kalshi.ts on why the
 *              bookmakers cannot supply these.
 *
 * ONE SOURCE FAILING MUST NEVER FAIL THE BATCH. Each source is captured
 * independently and its outcome reported separately, so a the-odds-api outage
 * still leaves us with the Kalshi history for that hour, and vice versa. A
 * partial capture is worth enormously more than none.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'odds_snapshots';

/**
 * Quota budget, deliberately written down.
 *
 * the-odds-api allows 500 requests a month. This job makes exactly ONE h2h
 * request per run. At four runs a day that is ~120 a month, leaving ~380 for
 * everything else — the live dashboard's own odds fetch included. Adding a
 * second market or a second region here doubles that, so do the arithmetic
 * before adding one.
 */
export const ODDS_API_REQUESTS_PER_RUN = 1;

export interface SnapshotRow {
  captured_at: string;
  season: string;
  source: string;
  market_type: string;
  fixture_id?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  team?: string | null;
  line?: number | null;
  commence_time?: string | null;
  bookmaker?: string | null;
  price_decimal?: number | null;
  implied_prob?: number | null;
  devig_prob?: number | null;
  raw: unknown;
}

export interface SourceOutcome {
  source: string;
  ok: boolean;
  rows: number;
  detail: string;
}

export interface SnapshotResult {
  capturedAt: string;
  season: string;
  persisted: boolean;
  totalRows: number;
  sources: SourceOutcome[];
}

function getSupabaseAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isOddsSnapshotConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

interface OddsApiOutcome {
  name?: string;
  price?: number;
}
interface OddsApiEvent {
  id?: string;
  home_team?: string;
  away_team?: string;
  commence_time?: string;
  bookmakers?: Array<{
    key?: string;
    markets?: Array<{ key?: string; outcomes?: OddsApiOutcome[] }>;
  }>;
}

/**
 * Per-bookmaker h2h prices, de-vigged within that bookmaker's own three-way book.
 *
 * Stored per bookmaker rather than averaged: the average is derivable later and
 * the disagreement between books is not. Consensus is a statistic; the spread of
 * opinion is data.
 */
async function captureH2h(capturedAt: string): Promise<{ rows: SnapshotRow[]; outcome: SourceOutcome }> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return { rows: [], outcome: { source: 'the-odds-api', ok: false, rows: 0, detail: 'ODDS_API_KEY not set' } };
  }

  const url =
    `https://api.the-odds-api.com/v4/sports/soccer_epl/odds/` +
    `?apiKey=${apiKey}&regions=uk&markets=h2h&oddsFormat=decimal`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return {
        rows: [],
        outcome: { source: 'the-odds-api', ok: false, rows: 0, detail: `HTTP ${res.status}` },
      };
    }
    const remaining = res.headers.get('x-requests-remaining');
    const events = (await res.json()) as OddsApiEvent[];
    const rows: SnapshotRow[] = [];

    for (const event of events) {
      const home = abbrFor(event.home_team);
      const away = abbrFor(event.away_team);
      if (!home || !away) {
        console.error(
          `[odds-snapshot] unmapped club in "${event.home_team}" v "${event.away_team}"; ` +
            `add it to lib/clubs.ts`
        );
        continue;
      }

      for (const bookmaker of event.bookmakers ?? []) {
        const market = bookmaker.markets?.find((m) => m.key === 'h2h');
        if (!market?.outcomes) continue;

        const priceFor = (team?: string) =>
          market.outcomes?.find((o) => o.name === team)?.price ?? null;
        const homePrice = priceFor(event.home_team);
        const awayPrice = priceFor(event.away_team);
        const drawPrice = market.outcomes.find((o) => o.name === 'Draw')?.price ?? null;
        if (!homePrice || !awayPrice || !drawPrice) continue;

        const devig = oddsToProb(homePrice, drawPrice, awayPrice);
        const legs: Array<[string, number, number]> = [
          [home, homePrice, devig.homeWin],
          ['DRAW', drawPrice, devig.draw],
          [away, awayPrice, devig.awayWin],
        ];

        for (const [team, price, prob] of legs) {
          rows.push({
            captured_at: capturedAt,
            season: CURRENT_SEASON,
            source: 'the-odds-api',
            market_type: 'h2h',
            fixture_id: event.id ?? null,
            home_team: home,
            away_team: away,
            team,
            commence_time: event.commence_time ?? null,
            bookmaker: bookmaker.key ?? null,
            price_decimal: price,
            implied_prob: 1 / price,
            devig_prob: prob,
            raw: { event: { id: event.id, home_team: event.home_team, away_team: event.away_team }, bookmaker: bookmaker.key, market },
          });
        }
      }
    }

    return {
      rows,
      outcome: {
        source: 'the-odds-api',
        ok: true,
        rows: rows.length,
        detail: `${events.length} events, quota remaining ${remaining ?? 'unknown'}`,
      },
    };
  } catch (error) {
    return {
      rows: [],
      outcome: { source: 'the-odds-api', ok: false, rows: 0, detail: (error as Error).message },
    };
  }
}

async function captureKalshi(capturedAt: string): Promise<{ rows: SnapshotRow[]; outcome: SourceOutcome }> {
  try {
    const snapshots = await fetchKalshiSeasonMarkets();
    const rows: SnapshotRow[] = [];
    const detail: string[] = [];

    for (const snapshot of snapshots) {
      if (snapshot.quotes.length === 0) {
        detail.push(`${snapshot.marketType}:0`);
        continue;
      }
      detail.push(`${snapshot.marketType}:${snapshot.quotes.length}`);

      for (const quote of snapshot.quotes) {
        rows.push({
          captured_at: capturedAt,
          season: CURRENT_SEASON,
          source: 'kalshi',
          market_type: snapshot.marketType,
          team: quote.abbr,
          line: quote.line ?? null,
          bookmaker: 'kalshi',
          // Mid is the price; null where the quote is unusable, which is
          // preserved rather than smoothed over.
          price_decimal: quote.mid,
          implied_prob: quote.mid,
          devig_prob: snapshot.probabilities[quote.abbr] ?? null,
          raw: {
            ticker: quote.ticker,
            bid: quote.bid,
            ask: quote.ask,
            last: quote.last,
            spread: quote.spread,
            volume: quote.volume,
            openInterest: quote.openInterest,
            spreadTooWide: quote.spreadTooWide,
            atTickFloor: quote.atTickFloor,
            normalisedTo: snapshot.normalisedTo,
            rawSum: snapshot.rawSum,
          },
        });
      }
    }

    return {
      rows,
      outcome: { source: 'kalshi', ok: true, rows: rows.length, detail: detail.join(' ') },
    };
  } catch (error) {
    return { rows: [], outcome: { source: 'kalshi', ok: false, rows: 0, detail: (error as Error).message } };
  }
}

export async function captureOddsSnapshot(): Promise<SnapshotResult> {
  const capturedAt = new Date().toISOString();

  // Independent on purpose: allSettled, not all, so one throwing source cannot
  // discard the other's rows.
  const settled = await Promise.allSettled([captureH2h(capturedAt), captureKalshi(capturedAt)]);

  const rows: SnapshotRow[] = [];
  const sources: SourceOutcome[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      rows.push(...result.value.rows);
      sources.push(result.value.outcome);
    } else {
      sources.push({ source: 'unknown', ok: false, rows: 0, detail: String(result.reason) });
    }
  }

  let persisted = false;
  const client = getSupabaseAdminClient();
  if (!client) {
    sources.push({ source: 'supabase', ok: false, rows: 0, detail: 'credentials not set; nothing written' });
  } else if (rows.length > 0) {
    // Append-only. No upsert and no conflict target: two snapshots minutes apart
    // are two observations, not a correction of one another.
    const { error } = await client.from(TABLE_NAME).insert(rows);
    if (error) {
      sources.push({ source: 'supabase', ok: false, rows: 0, detail: error.message });
    } else {
      persisted = true;
      sources.push({ source: 'supabase', ok: true, rows: rows.length, detail: 'inserted' });
    }
  }

  return { capturedAt, season: CURRENT_SEASON, persisted, totalRows: rows.length, sources };
}

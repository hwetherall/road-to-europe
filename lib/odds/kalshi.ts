import { SEASON_START_YEAR } from '../constants';
import { abbrFor } from '../clubs';

/**
 * Kalshi season-long Premier League markets.
 *
 * WHY KALSHI AND NOT THE BOOKMAKERS
 *
 * The original plan was to take outright markets from the-odds-api, which we
 * already pay for. That turns out to be impossible rather than merely gated:
 * `GET /v4/sports/?all=true` returns 175 sports, only 12 with
 * `has_outrights: true`, and they are the US majors plus golf. `soccer_epl`
 * itself reports `has_outrights: false`, and the only soccer entry in the whole
 * catalogue is an inactive FIFA World Cup winner market. There is no EPL futures
 * key to find. Recorded here so nobody spends another hour looking for it.
 *
 * So Kalshi is the primary outright source, not a second opinion. That is a
 * better position than it sounds: prices are quoted directly as probabilities in
 * dollars, so there is no bookmaker overround to strip per-runner — only the
 * spread and the requirement that a set of mutually exclusive outcomes sums to
 * the right total.
 *
 * NO AUTHENTICATION IS USED, DELIBERATELY
 *
 * Every endpoint below is public. Kalshi's RSA-signed authentication exists for
 * order placement and portfolio access, neither of which Keepwatch does — and an
 * app that only reads prices should not be holding a key that can trade. If
 * reads ever start requiring auth, that is the point to reconsider, not before.
 *
 * WHAT EXISTS, AND WHAT EACH MARKET MAY BE USED FOR
 *
 *   KXPREMIERLEAGUE   title winner       ~$1.2M volume   top of the table only
 *   KXEPLRELEGATION   relegation         ~$30k volume    all 20, the useful one
 *   KXEPLTEAMPOINTS   points thresholds  ~$2k volume     capture, do not trust
 *   KXEPLTOP4/TOP6    top 4 / top 6      not listed      polled in case they appear
 *
 * The relegation market is the valuable one and neither the spec nor the handoff
 * anticipated it. The title market cannot separate the bottom 13 clubs — they all
 * sit at bid 0.00 / ask 0.01, which is the tick floor, not a price. Relegation
 * quotes span the whole table, so the two together pin both ends.
 *
 * TWO WAYS A QUOTE CAN BE UNUSABLE, AND THEY ARE DIFFERENT
 *
 *   Wide spread.   KXEPLTEAMPOINTS quotes Newcastle 50+ points at bid 0.02 / ask
 *                  0.97. The midpoint of that is not a probability, it is the
 *                  average of two numbers nobody will trade at.
 *   At tick floor. A market quoted 0.00 / 0.01 is saying "less than a cent",
 *                  which is a bound, not an estimate. Arsenal's 2.1% relegation
 *                  probability is mostly this: the market cannot express 0.3%.
 *
 * Both are flagged per quote rather than silently averaged, because they mislead
 * in opposite directions and a downstream comparison needs to know which it has.
 */

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

/** Season suffix Kalshi uses: the calendar year the season ends in, two digits. */
export const KALSHI_SEASON_SUFFIX = String((SEASON_START_YEAR + 1) % 100).padStart(2, '0');

/** Widest bid-ask spread, in probability, that still yields a usable midpoint. */
export const MAX_USABLE_SPREAD = 0.10;

/** A quote at or below this on the ask is reporting the tick floor, not a price. */
export const TICK_FLOOR = 0.01;

export type KalshiMarketType =
  | 'outright_winner'
  | 'outright_top4'
  | 'outright_top6'
  | 'outright_relegation'
  | 'points_total';

interface SeriesSpec {
  seriesTicker: string;
  marketType: KalshiMarketType;
  /**
   * What the probabilities of this market's mutually exclusive outcomes must sum
   * to. One champion, but THREE clubs are relegated and four qualify for the
   * Champions League — so a single normalise-to-one helper would divide every
   * relegation probability by three. Null means the outcomes are independent
   * (points thresholds) and must not be normalised at all.
   */
  normalisesTo: number | null;
}

export const KALSHI_SERIES: SeriesSpec[] = [
  { seriesTicker: 'KXPREMIERLEAGUE', marketType: 'outright_winner', normalisesTo: 1 },
  { seriesTicker: 'KXEPLRELEGATION', marketType: 'outright_relegation', normalisesTo: 3 },
  { seriesTicker: 'KXEPLTOP4', marketType: 'outright_top4', normalisesTo: 4 },
  { seriesTicker: 'KXEPLTOP6', marketType: 'outright_top6', normalisesTo: 6 },
  { seriesTicker: 'KXEPLTEAMPOINTS', marketType: 'points_total', normalisesTo: null },
];

export interface KalshiQuote {
  /** Keepwatch abbreviation. Kalshi's ticker suffix already uses ours. */
  abbr: string;
  ticker: string;
  bid: number | null;
  ask: number | null;
  /** Midpoint, before any normalisation. Null when unusable. */
  mid: number | null;
  last: number | null;
  spread: number | null;
  volume: number;
  openInterest: number;
  /** points_total only: the points threshold this market is about. */
  line?: number;
  /** Spread too wide for the midpoint to mean anything. */
  spreadTooWide: boolean;
  /** Quoted at the 1-cent tick floor; a bound rather than an estimate. */
  atTickFloor: boolean;
}

export interface KalshiMarketSnapshot {
  marketType: KalshiMarketType;
  seriesTicker: string;
  eventTicker: string | null;
  quotes: KalshiQuote[];
  /**
   * De-vigged probabilities by abbreviation, normalised to `normalisesTo`.
   * Populated only for markets that normalise and only from usable quotes.
   */
  probabilities: Record<string, number>;
  /** Sum of raw midpoints before normalisation. 1.08 means an 8% spread cost. */
  rawSum: number;
  normalisedTo: number | null;
  usableQuotes: number;
  notes: string[];
}

interface RawMarket {
  ticker?: string;
  event_ticker?: string;
  yes_bid_dollars?: string | number | null;
  yes_ask_dollars?: string | number | null;
  last_price_dollars?: string | number | null;
  volume_fp?: string | number | null;
  open_interest_fp?: string | number | null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split a ticker into club and, for points markets, the threshold.
 * `KXEPLRELEGATION-27-NEW` -> NEW.  `KXEPLTEAMPOINTS-27-NEW55` -> NEW, 55.
 */
export function parseTicker(ticker: string): { abbr?: string; line?: number } {
  const suffix = ticker.split('-').pop();
  if (!suffix) return {};

  const direct = abbrFor(suffix);
  if (direct) return { abbr: direct };

  const withLine = suffix.match(/^([A-Za-z]+?)(\d+)$/);
  if (withLine) {
    const abbr = abbrFor(withLine[1]);
    if (abbr) return { abbr, line: Number(withLine[2]) };
  }
  return {};
}

function toQuote(market: RawMarket): KalshiQuote | null {
  const ticker = market.ticker;
  if (!ticker) return null;
  const { abbr, line } = parseTicker(ticker);
  if (!abbr) return null;

  const bid = num(market.yes_bid_dollars);
  const ask = num(market.yes_ask_dollars);
  const spread = bid !== null && ask !== null ? ask - bid : null;

  const spreadTooWide = spread === null || spread > MAX_USABLE_SPREAD;
  const atTickFloor = ask !== null && ask <= TICK_FLOOR;

  const usable = bid !== null && ask !== null && !spreadTooWide && !atTickFloor;

  return {
    abbr,
    ticker,
    bid,
    ask,
    mid: usable ? (bid + ask) / 2 : null,
    last: num(market.last_price_dollars),
    spread,
    volume: num(market.volume_fp) ?? 0,
    openInterest: num(market.open_interest_fp) ?? 0,
    ...(line !== undefined ? { line } : {}),
    spreadTooWide,
    atTickFloor,
  };
}

async function fetchSeries(spec: SeriesSpec): Promise<KalshiMarketSnapshot> {
  const notes: string[] = [];
  let markets: RawMarket[] = [];

  const url =
    `${BASE}/markets?series_ticker=${spec.seriesTicker}` +
    `&limit=200&status=open`;

  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      notes.push(`HTTP ${res.status} from ${spec.seriesTicker}`);
    } else {
      const body = (await res.json()) as { markets?: RawMarket[] };
      markets = body.markets ?? [];
    }
  } catch (error) {
    notes.push(`fetch failed for ${spec.seriesTicker}: ${(error as Error).message}`);
  }

  // Only this season's event. The series outlives any one season.
  const wanted = `${spec.seriesTicker}-${KALSHI_SEASON_SUFFIX}`;
  const thisSeason = markets.filter((m) => m.event_ticker === wanted);
  if (markets.length > 0 && thisSeason.length === 0) {
    notes.push(
      `${markets.length} open market(s) but none for ${wanted}; ` +
        `saw ${[...new Set(markets.map((m) => m.event_ticker))].join(', ')}`
    );
  }
  if (markets.length === 0) {
    notes.push(`no open markets listed for ${spec.seriesTicker}`);
  }

  const quotes = thisSeason
    .map(toQuote)
    .filter((q): q is KalshiQuote => q !== null)
    .sort((a, b) => (b.mid ?? 0) - (a.mid ?? 0));

  const unmapped = thisSeason.length - quotes.length;
  if (unmapped > 0) notes.push(`${unmapped} market(s) had an unrecognised club ticker`);

  const usable = quotes.filter((q) => q.mid !== null);
  const rawSum = usable.reduce((sum, q) => sum + (q.mid as number), 0);

  const probabilities: Record<string, number> = {};
  if (spec.normalisesTo !== null && rawSum > 0) {
    // Normalising rescales the usable quotes so they sum to the number of slots
    // the market is about. Where quotes are missing or unusable this attributes
    // their share to the clubs that ARE quoted, which overstates them — noted
    // rather than hidden.
    const factor = spec.normalisesTo / rawSum;
    for (const q of usable) probabilities[q.abbr] = (q.mid as number) * factor;
    if (usable.length < quotes.length) {
      notes.push(
        `${quotes.length - usable.length} of ${quotes.length} quotes unusable ` +
          `(wide spread or tick floor); the remainder absorb their probability`
      );
    }
  }

  return {
    marketType: spec.marketType,
    seriesTicker: spec.seriesTicker,
    eventTicker: thisSeason.length > 0 ? wanted : null,
    quotes,
    probabilities,
    rawSum,
    normalisedTo: spec.normalisesTo,
    usableQuotes: usable.length,
    notes,
  };
}

/**
 * Every season-long market Kalshi lists for the current season.
 *
 * One failing series never fails the batch: each snapshot carries its own notes,
 * so a caller can use the relegation market when the title market is down. This
 * runs on a schedule and a partial capture is worth far more than none.
 */
export async function fetchKalshiSeasonMarkets(): Promise<KalshiMarketSnapshot[]> {
  return Promise.all(KALSHI_SERIES.map(fetchSeries));
}

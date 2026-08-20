import { createClient } from '@supabase/supabase-js';
import { CURRENT_SEASON } from '@/lib/constants';

/**
 * The market's view, read back out of the odds snapshot table.
 *
 * Deliberately reads from `odds_snapshots` rather than calling Kalshi directly.
 * Two reasons. The Ledger is a record of what was believed at a moment, so it
 * should quote the prices that were actually captured at that moment rather than
 * whatever the market says when someone loads the page — otherwise the
 * "disagreement" section drifts and the page stops being a fixed artifact. And it
 * exercises the snapshot table for something real, which is the fastest way to
 * find out whether what is being stored is actually usable.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface MarketView {
  /** Probability in percent, by club abbreviation. */
  title: Record<string, number>;
  relegation: Record<string, number>;
  capturedAt: string | null;
}

interface Row {
  captured_at: string;
  market_type: string;
  team: string | null;
  devig_prob: number | null;
}

/**
 * Latest usable market probabilities at or before `asOf`.
 *
 * Rows with a null `devig_prob` are skipped rather than treated as zero: the
 * snapshot writer nulls them precisely when the quote was unusable (a spread too
 * wide to have a midpoint, or a price pinned at the one-cent tick floor), and
 * reading those as "0% chance" would be worse than having no number.
 */
export async function getMarketView(asOf?: string): Promise<MarketView> {
  const empty: MarketView = { title: {}, relegation: {}, capturedAt: null };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return empty;

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let query = client
    .from('odds_snapshots')
    .select('captured_at, market_type, team, devig_prob')
    .eq('season', CURRENT_SEASON)
    .eq('source', 'kalshi')
    .in('market_type', ['outright_winner', 'outright_relegation'])
    .order('captured_at', { ascending: false })
    .limit(400);

  if (asOf) query = query.lte('captured_at', asOf);

  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    if (error) console.error(`[ledger] could not read market snapshot: ${error.message}`);
    return empty;
  }

  // Take only the most recent capture, so title and relegation are quoted from
  // the same moment rather than mixed across hours.
  const rows = data as Row[];
  const latest = rows[0].captured_at;
  const view: MarketView = { title: {}, relegation: {}, capturedAt: latest };

  for (const row of rows) {
    if (row.captured_at !== latest) continue;
    if (row.team === null || row.devig_prob === null) continue;
    const target = row.market_type === 'outright_winner' ? view.title : view.relegation;
    target[row.team] = row.devig_prob * 100;
  }

  return view;
}

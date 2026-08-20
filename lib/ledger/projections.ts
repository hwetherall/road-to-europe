import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CURRENT_SEASON } from '@/lib/constants';
import { SimulationResult } from '@/lib/types';
import { PRIORS_SOURCE } from '@/lib/ratings/priors';

/**
 * The Preseason Ledger — locked, timestamped projections.
 *
 * IMMUTABILITY IS THE ENTIRE POINT
 *
 * A forecast you can revise after the fact is not being scored, and an unscored
 * forecast carries no information. So the `unique (season, matchday,
 * model_version, team)` constraint on the table is the mechanism, and this module
 * deliberately provides NO upsert path: no `onConflict`, no `ignoreDuplicates`,
 * no update. A collision is a bug to surface, not a conflict to resolve
 * gracefully — if a write fails because a projection already exists, the correct
 * response is to look at why something tried to overwrite a track record, not to
 * make the overwrite succeed.
 *
 * The repo has an upsert helper pattern in lib/weekly-preview/cache.ts. This
 * table does not get one, on purpose.
 *
 * To publish a genuinely different model rather than to correct this one, bump
 * `model_version`. Both then coexist and both get scored, which is the honest way
 * to change your mind in public.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'projections';

/** Bump this to publish a different model. Never to correct a published one. */
export const MODEL_VERSION = 'blend-v1-hybrid';

/** Matchday 0 means "before a ball was kicked". */
export const PRESEASON_MATCHDAY = 0;

export interface ProjectionRow {
  season: string;
  matchday: number;
  model_version: string;
  prior_source: string;
  team: string;
  champion_pct: number;
  top4_pct: number;
  top7_pct: number;
  relegation_pct: number;
  avg_points: number;
  avg_position: number;
  position_distribution: number[];
}

export interface PublishResult {
  ok: boolean;
  rows: number;
  detail: string;
  /** True when the write was refused because a projection already existed. */
  alreadyPublished: boolean;
}

function getSupabaseAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isLedgerConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Turn a simulation into projection rows.
 *
 * `positionDistribution` is stored as counts-normalised probabilities so the
 * Ranked Probability Score can be computed later without re-running anything.
 * That is what makes the Ledger scoreable in May from what was written in August.
 */
export function buildProjectionRows(
  results: SimulationResult[],
  options: { matchday?: number; modelVersion?: string } = {}
): ProjectionRow[] {
  const matchday = options.matchday ?? PRESEASON_MATCHDAY;
  const modelVersion = options.modelVersion ?? MODEL_VERSION;

  return results.map((r) => {
    const total = r.positionDistribution.reduce((sum, p) => sum + p, 0);
    return {
      season: CURRENT_SEASON,
      matchday,
      model_version: modelVersion,
      prior_source: PRIORS_SOURCE,
      team: r.team,
      champion_pct: round(r.championPct),
      top4_pct: round(r.top4Pct),
      top7_pct: round(r.top7Pct),
      relegation_pct: round(r.relegationPct),
      avg_points: round(r.avgPoints),
      avg_position: round(r.avgPosition),
      position_distribution: r.positionDistribution.map((p) =>
        total > 0 ? round(p / total, 6) : 0
      ),
    };
  });
}

/**
 * Write projections. Once.
 *
 * A duplicate-key error is reported as `alreadyPublished` rather than thrown,
 * because "this has already been published" is a normal answer to "publish this"
 * for an immutable record — but it is never silently treated as success.
 */
export async function publishProjections(rows: ProjectionRow[]): Promise<PublishResult> {
  if (rows.length === 0) {
    return { ok: false, rows: 0, detail: 'nothing to publish', alreadyPublished: false };
  }

  const client = getSupabaseAdminClient();
  if (!client) {
    return { ok: false, rows: 0, detail: 'Supabase credentials not set', alreadyPublished: false };
  }

  const { error } = await client.from(TABLE_NAME).insert(rows);
  if (error) {
    // 23505 is Postgres' unique_violation.
    const alreadyPublished = error.code === '23505';
    return {
      ok: false,
      rows: 0,
      detail: alreadyPublished
        ? `already published for ${rows[0].season} matchday ${rows[0].matchday} ` +
          `model ${rows[0].model_version}; a published projection is never overwritten`
        : error.message,
      alreadyPublished,
    };
  }

  return { ok: true, rows: rows.length, detail: 'published', alreadyPublished: false };
}

export interface PublishedProjection extends ProjectionRow {
  created_at: string;
}

/** Read a published projection back, for the artifact page. */
export async function getPublishedProjections(options: {
  matchday?: number;
  modelVersion?: string;
} = {}): Promise<PublishedProjection[]> {
  const client = getSupabaseAdminClient();
  if (!client) return [];

  const { data, error } = await client
    .from(TABLE_NAME)
    .select('*')
    .eq('season', CURRENT_SEASON)
    .eq('matchday', options.matchday ?? PRESEASON_MATCHDAY)
    .eq('model_version', options.modelVersion ?? MODEL_VERSION)
    .order('avg_position', { ascending: true });

  if (error) {
    console.error(`[ledger] could not read projections: ${error.message}`);
    return [];
  }
  return (data ?? []) as PublishedProjection[];
}

function round(value: number, dp = 3): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

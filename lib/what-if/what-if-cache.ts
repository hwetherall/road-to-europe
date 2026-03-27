import { createHash } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Team, Fixture } from '@/lib/types';
import { WhatIfAnalysis, WHAT_IF_ANALYSIS_VERSION } from './types';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'what_if_analyses';

// ── Client ──

function getSupabaseAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isWhatIfCacheConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

// ── Scenario Key ──

export function createWhatIfScenarioKey(input: {
  targetTeam: string;
  targetMetric: string;
  teams: Team[];
  fixtures: Fixture[];
}): string {
  const normalizedTeams = [...input.teams]
    .sort((a, b) => a.abbr.localeCompare(b.abbr))
    .map((t) => ({
      abbr: t.abbr,
      points: t.points,
      goalDifference: t.goalDifference,
      played: t.played,
    }));

  const normalizedFixtures = [...input.fixtures]
    .filter((f) => f.status === 'SCHEDULED')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => ({
      id: f.id,
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
    }));

  const blob = JSON.stringify({
    version: WHAT_IF_ANALYSIS_VERSION,
    target: `${input.targetTeam}:${input.targetMetric}`,
    teams: normalizedTeams,
    fixtures: normalizedFixtures,
  });

  return createHash('sha256').update(blob).digest('hex').slice(0, 16);
}

// ── Cache Read ──

export interface CachedWhatIfRecord {
  analysis: WhatIfAnalysis;
  generatedAt: number;
  cacheMatchType: 'exact' | 'fallback';
}

function isCurrentAnalysisVersion(value: unknown): value is WhatIfAnalysis {
  return !!value && typeof value === 'object' && (value as WhatIfAnalysis).version === WHAT_IF_ANALYSIS_VERSION;
}

export async function getCachedWhatIfAnalysis(params: {
  scenarioKey: string;
  targetTeam: string;
  targetMetric: string;
}): Promise<CachedWhatIfRecord | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;

  try {
    // Exact match by scenario key
    const { data: exact } = await client
      .from(TABLE_NAME)
      .select('analysis_json, updated_at')
      .eq('scenario_key', params.scenarioKey)
      .limit(1)
      .single();

    if (exact && isCurrentAnalysisVersion(exact.analysis_json)) {
      return {
        analysis: exact.analysis_json as WhatIfAnalysis,
        generatedAt: new Date(exact.updated_at).getTime(),
        cacheMatchType: 'exact',
      };
    }

    // Fallback: same team+metric, most recent
    const { data: fallback } = await client
      .from(TABLE_NAME)
      .select('analysis_json, updated_at')
      .eq('team_abbr', params.targetTeam)
      .eq('target_metric', params.targetMetric)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (fallback && isCurrentAnalysisVersion(fallback.analysis_json)) {
      return {
        analysis: fallback.analysis_json as WhatIfAnalysis,
        generatedAt: new Date(fallback.updated_at).getTime(),
        cacheMatchType: 'fallback',
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ── Cache Write ──

export async function upsertWhatIfCache(params: {
  scenarioKey: string;
  targetTeam: string;
  targetMetric: string;
  gameweek: number;
  analysis: WhatIfAnalysis;
}): Promise<boolean> {
  const client = getSupabaseAdminClient();
  if (!client) return false;

  try {
    const now = new Date().toISOString();

    const { error } = await client.from(TABLE_NAME).upsert(
      {
        team_abbr: params.targetTeam,
        target_metric: params.targetMetric,
        season: '2025-26',
        gameweek: params.gameweek,
        scenario_key: params.scenarioKey,
        analysis_json: params.analysis,
        updated_at: now,
      },
      { onConflict: 'team_abbr,target_metric,season,gameweek' }
    );

    if (error) {
      console.error('[WhatIfCache] Upsert error:', error.message);
      return false;
    }

    return true;
  } catch (e) {
    console.error('[WhatIfCache] Upsert exception:', e);
    return false;
  }
}

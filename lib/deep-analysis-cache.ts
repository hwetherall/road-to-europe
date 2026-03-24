import { createHash } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DeepAnalysis, Fixture, Team } from '@/lib/types';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'deep_analysis_reports';

interface ScenarioKeyInput {
  targetTeam: string;
  targetMetric: string;
  teams: Team[];
  fixtures: Fixture[];
}

interface CacheLookupParams {
  scenarioKey: string;
  targetTeam: string;
  targetMetric: string;
}

interface CacheWriteParams {
  scenarioKey: string;
  targetTeam: string;
  targetMetric: string;
  targetThreshold: number;
  analysis: DeepAnalysis;
  pathResult: unknown;
  aiWarning: string;
}

export interface CachedDeepAnalysisRecord {
  analysis: DeepAnalysis;
  pathResult: unknown;
  aiWarning: string;
  generatedAt: number;
  cacheMatchType: 'exact' | 'scenario_fallback';
}

function getSupabaseAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function normalizeTeamsForKey(teams: Team[]) {
  return [...teams]
    .sort((a, b) => a.abbr.localeCompare(b.abbr))
    .map((team) => ({
      abbr: team.abbr,
      points: team.points,
      goalDifference: team.goalDifference,
      goalsFor: team.goalsFor,
      goalsAgainst: team.goalsAgainst,
      played: team.played,
      won: team.won,
      drawn: team.drawn,
      lost: team.lost,
    }));
}

function normalizeFixturesForKey(fixtures: Fixture[]) {
  return [...fixtures]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((fixture) => ({
      id: fixture.id,
      status: fixture.status,
      date: fixture.date,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      homeScore: fixture.homeScore ?? null,
      awayScore: fixture.awayScore ?? null,
      homeWinProb: fixture.homeWinProb ?? null,
      drawProb: fixture.drawProb ?? null,
      awayWinProb: fixture.awayWinProb ?? null,
      probSource: fixture.probSource,
    }));
}

export function createDeepAnalysisScenarioKey(input: ScenarioKeyInput): string {
  const canonicalScenario = {
    version: 1,
    targetTeam: input.targetTeam,
    targetMetric: input.targetMetric,
    teams: normalizeTeamsForKey(input.teams),
    fixtures: normalizeFixturesForKey(input.fixtures),
  };

  return createHash('sha256')
    .update(JSON.stringify(canonicalScenario))
    .digest('hex');
}

export function isDeepAnalysisCacheConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function mapCachedRow(
  data: {
    analysis: unknown;
    path_result: unknown;
    ai_warning: unknown;
    generated_at: string | null;
  },
  cacheMatchType: 'exact' | 'scenario_fallback'
): CachedDeepAnalysisRecord | null {
  if (!data.analysis) return null;
  return {
    analysis: data.analysis as DeepAnalysis,
    pathResult: data.path_result,
    aiWarning: typeof data.ai_warning === 'string' ? data.ai_warning : '',
    generatedAt: data.generated_at ? new Date(data.generated_at).getTime() : Date.now(),
    cacheMatchType,
  };
}

export async function getCachedDeepAnalysis({
  scenarioKey,
  targetTeam,
  targetMetric,
}: CacheLookupParams): Promise<CachedDeepAnalysisRecord | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data: exactData, error: exactError } = await supabase
    .from(TABLE_NAME)
    .select('analysis, path_result, ai_warning, generated_at')
    .eq('scenario_key', scenarioKey)
    .maybeSingle();

  if (exactError) {
    console.error('Deep analysis exact cache lookup failed:', exactError.message);
    return null;
  }

  const exact = exactData
    ? mapCachedRow(
        exactData as {
          analysis: unknown;
          path_result: unknown;
          ai_warning: unknown;
          generated_at: string | null;
        },
        'exact'
      )
    : null;

  if (exact) {
    return exact;
  }

  // Fallback: reuse the most recently generated report for the same team + scenario settings.
  const { data: fallbackData, error: fallbackError } = await supabase
    .from(TABLE_NAME)
    .select('analysis, path_result, ai_warning, generated_at')
    .eq('target_team', targetTeam)
    .eq('target_metric', targetMetric)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackError) {
    console.error('Deep analysis fallback cache lookup failed:', fallbackError.message);
    return null;
  }

  return fallbackData
    ? mapCachedRow(
        fallbackData as {
          analysis: unknown;
          path_result: unknown;
          ai_warning: unknown;
          generated_at: string | null;
        },
        'scenario_fallback'
      )
    : null;
}

export async function upsertDeepAnalysisCache({
  scenarioKey,
  targetTeam,
  targetMetric,
  targetThreshold,
  analysis,
  pathResult,
  aiWarning,
}: CacheWriteParams): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return;

  const payload = {
    scenario_key: scenarioKey,
    target_team: targetTeam,
    target_metric: targetMetric,
    target_threshold: targetThreshold,
    analysis,
    path_result: pathResult,
    ai_warning: aiWarning,
    generated_at: new Date(analysis.generatedAt).toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(TABLE_NAME).upsert(payload, {
    onConflict: 'scenario_key',
  });

  if (error) {
    console.error('Deep analysis cache upsert failed:', error.message);
  }
}

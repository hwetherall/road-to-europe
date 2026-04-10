import { createHash, randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Fixture, Team } from '@/lib/types';
import { WeeklyPreviewDraft, WEEKLY_PREVIEW_VERSION } from '@/lib/weekly-preview/types';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'weekly_previews';

interface WeeklyPreviewRow {
  id: string;
  version: string;
  season: string;
  matchday: number;
  club_abbr: string;
  status: 'draft' | 'published';
  scheduled_for: string;
  generated_at: string;
  markdown: string;
  dossier_json: WeeklyPreviewDraft['dossier'];
  sections_json: WeeklyPreviewDraft['sections'];
  sources_json: WeeklyPreviewDraft['sources'];
  warnings_json: WeeklyPreviewDraft['warnings'];
  metadata_json: WeeklyPreviewDraft['metadata'];
}

function getSupabaseAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isWeeklyPreviewConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export function createWeeklyPreviewDataHash(input: {
  season: string;
  club: string;
  teams: Team[];
  fixtures: Fixture[];
}): string {
  const teamsBlob = [...input.teams]
    .sort((a, b) => a.abbr.localeCompare(b.abbr))
    .map((team) => ({
      abbr: team.abbr,
      points: team.points,
      goalDifference: team.goalDifference,
      goalsFor: team.goalsFor,
      goalsAgainst: team.goalsAgainst,
      played: team.played,
    }));

  const fixturesBlob = [...input.fixtures]
    .filter((fixture) => fixture.status === 'SCHEDULED')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((fixture) => ({
      id: fixture.id,
      matchday: fixture.matchday,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      homeWinProb: fixture.homeWinProb,
      drawProb: fixture.drawProb,
      awayWinProb: fixture.awayWinProb,
      probSource: fixture.probSource,
    }));

  return createHash('sha256')
    .update(
      JSON.stringify({
        version: WEEKLY_PREVIEW_VERSION,
        season: input.season,
        club: input.club,
        teams: teamsBlob,
        fixtures: fixturesBlob,
      })
    )
    .digest('hex')
    .slice(0, 24);
}

function mapRow(row: WeeklyPreviewRow): WeeklyPreviewDraft {
  return {
    id: row.id,
    version: row.version,
    season: row.season,
    matchday: row.matchday,
    club: row.club_abbr,
    status: row.status,
    generatedAt: new Date(row.generated_at).getTime(),
    scheduledFor: row.scheduled_for,
    markdown: row.markdown,
    dossier: row.dossier_json,
    sections: row.sections_json,
    sources: row.sources_json,
    warnings: row.warnings_json,
    metadata: row.metadata_json,
  };
}

export async function getLatestWeeklyPreviewDraft(
  club = 'NEW'
): Promise<WeeklyPreviewDraft | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE_NAME)
    .select(
      'id, version, season, matchday, club_abbr, status, scheduled_for, generated_at, markdown, dossier_json, sections_json, sources_json, warnings_json, metadata_json'
    )
    .eq('club_abbr', club)
    .eq('status', 'draft')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as WeeklyPreviewRow);
}

export async function upsertWeeklyPreviewDraft(
  draft: WeeklyPreviewDraft
): Promise<{ persisted: boolean; draft: WeeklyPreviewDraft }> {
  const client = getSupabaseAdminClient();
  if (!client) return { persisted: false, draft };

  const row = {
    id: draft.id || randomUUID(),
    version: draft.version,
    season: draft.season,
    matchday: draft.matchday,
    club_abbr: draft.club,
    status: draft.status,
    scheduled_for: draft.scheduledFor,
    generated_at: new Date(draft.generatedAt).toISOString(),
    data_hash: draft.dossier.dataHash,
    markdown: draft.markdown,
    dossier_json: draft.dossier,
    sections_json: draft.sections,
    sources_json: draft.sources,
    warnings_json: draft.warnings,
    metadata_json: draft.metadata,
  };

  const { error } = await client.from(TABLE_NAME).upsert(row, {
    onConflict: 'season,matchday,club_abbr',
  });

  if (error) {
    console.error('[weekly-preview] upsert failed:', error.message);
    return { persisted: false, draft };
  }

  return {
    persisted: true,
    draft: {
      ...draft,
      id: row.id,
    },
  };
}

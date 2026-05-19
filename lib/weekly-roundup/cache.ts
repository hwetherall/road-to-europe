import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { RoundupDraft, RoundupQaAudit, RoundupQaIssue } from '@/lib/weekly-roundup/types';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE_NAME = 'weekly_roundups';
const AUDIT_TABLE_NAME = 'weekly_roundup_audits';

interface WeeklyRoundupRow {
  id: string;
  version: string;
  season: string;
  matchday: number;
  club_abbr: string;
  status: 'draft' | 'published';
  generated_at: string;
  data_hash: string;
  markdown: string;
  dossier_json: RoundupDraft['dossier'];
  sections_json: RoundupDraft['sections'];
  sources_json: RoundupDraft['sources'];
  warnings_json: RoundupDraft['warnings'];
  metadata_json: RoundupDraft['metadata'];
}

function getSupabaseAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isWeeklyRoundupConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function mapRow(row: WeeklyRoundupRow): RoundupDraft {
  return {
    id: row.id,
    version: row.version,
    season: row.season,
    matchday: row.matchday,
    club: row.club_abbr,
    status: row.status,
    generatedAt: new Date(row.generated_at).getTime(),
    markdown: row.markdown,
    dossier: row.dossier_json,
    sections: row.sections_json,
    sources: row.sources_json,
    warnings: row.warnings_json,
    metadata: row.metadata_json,
  };
}

const SELECT_COLUMNS =
  'id, version, season, matchday, club_abbr, status, generated_at, data_hash, markdown, dossier_json, sections_json, sources_json, warnings_json, metadata_json';

export async function getLatestWeeklyRoundupDraft(
  club = 'NEW'
): Promise<RoundupDraft | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE_NAME)
    .select(SELECT_COLUMNS)
    .eq('club_abbr', club)
    .eq('status', 'draft')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as WeeklyRoundupRow);
}

export async function getWeeklyRoundupByMatchday(
  matchday: number,
  club = 'NEW'
): Promise<RoundupDraft | null> {
  const client = getSupabaseAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE_NAME)
    .select(SELECT_COLUMNS)
    .eq('club_abbr', club)
    .eq('matchday', matchday)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as WeeklyRoundupRow);
}

export interface WeeklyRoundupListItem {
  id: string;
  matchday: number;
  season: string;
  generatedAt: number;
  status: 'draft' | 'published';
}

export async function listWeeklyRoundups(club = 'NEW'): Promise<WeeklyRoundupListItem[]> {
  const client = getSupabaseAdminClient();
  if (!client) return [];

  const { data, error } = await client
    .from(TABLE_NAME)
    .select('id, matchday, season, generated_at, status')
    .eq('club_abbr', club)
    .order('generated_at', { ascending: false });

  if (error || !data) return [];
  return (
    data as Array<{
      id: string;
      matchday: number;
      season: string;
      generated_at: string;
      status: 'draft' | 'published';
    }>
  ).map((row) => ({
    id: row.id,
    matchday: row.matchday,
    season: row.season,
    generatedAt: new Date(row.generated_at).getTime(),
    status: row.status,
  }));
}

export async function upsertWeeklyRoundupDraft(
  draft: RoundupDraft
): Promise<{ persisted: boolean; draft: RoundupDraft }> {
  const client = getSupabaseAdminClient();
  if (!client) return { persisted: false, draft };

  const row = {
    id: draft.id || randomUUID(),
    version: draft.version,
    season: draft.season,
    matchday: draft.matchday,
    club_abbr: draft.club,
    status: draft.status,
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
    console.error('[weekly-roundup] upsert failed:', error.message);
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

function countAuditIssues(issues: RoundupQaIssue[]) {
  return {
    high: issues.filter((issue) => issue.severity === 'high').length,
    medium: issues.filter((issue) => issue.severity === 'medium').length,
    low: issues.filter((issue) => issue.severity === 'low').length,
  };
}

export async function insertWeeklyRoundupAudit(
  draft: RoundupDraft,
  audit: RoundupQaAudit
): Promise<boolean> {
  const client = getSupabaseAdminClient();
  if (!client) return false;

  const allIssuesById = new Map<string, RoundupQaIssue>();
  for (const issue of [...audit.issues, ...audit.deterministicIssues]) {
    allIssuesById.set(issue.issueId, issue);
  }
  const allIssues = [...allIssuesById.values()];
  const counts = countAuditIssues(allIssues);

  const { error } = await client.from(AUDIT_TABLE_NAME).insert({
    roundup_id: draft.id,
    season: draft.season,
    matchday: draft.matchday,
    club_abbr: draft.club,
    generated_at: new Date(audit.reviewedAt).toISOString(),
    reviewer_model: audit.reviewerModel,
    status: audit.status,
    issue_count: allIssues.length,
    high_count: counts.high,
    medium_count: counts.medium,
    low_count: counts.low,
    issues_json: audit.issues,
    deterministic_issues_json: audit.deterministicIssues,
    summary: audit.summary,
    metadata_json: {
      acceptedReviewerOutput: audit.acceptedReviewerOutput,
      fallbackReason: audit.fallbackReason ?? null,
    },
  });

  if (error) {
    console.error('[weekly-roundup] audit insert failed:', error.message);
    return false;
  }

  return true;
}

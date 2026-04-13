/**
 * lib/injuries.ts
 *
 * Reads injury data from the Supabase `injuries` table.
 * Replaces unreliable AI-agent web search for injury/availability info.
 *
 * Usage in agent tools:
 *   const injuries = await getInjuriesByClub('NEW');
 *   const allInjuries = await getAllInjuries();
 *   const stale = isInjuryDataStale();
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── Types ──

export interface InjuryRecord {
  club: string;
  club_abbr: string | null;
  player: string;
  reason: string | null;
  return_date: string | null;
  status: string | null;
  scraped_at: string;
}

export interface InjurySummary {
  totalInjured: number;
  clubCount: number;
  lastScraped: string | null;
  isStale: boolean;
  injuries: InjuryRecord[];
}

// ── Client ──

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function isInjuryDataConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

// ── Queries ──

/**
 * Get all injuries for a specific club by abbreviation.
 * This is the primary query your AI agents should use.
 */
export async function getInjuriesByClub(clubAbbr: string): Promise<InjuryRecord[]> {
  const client = getClient();
  if (!client) return [];

  const { data, error } = await client
    .from('injuries')
    .select('*')
    .eq('club_abbr', clubAbbr.toUpperCase())
    .order('player', { ascending: true });

  if (error) {
    console.error(`[injuries] Failed to fetch for ${clubAbbr}:`, error.message);
    return [];
  }

  return data ?? [];
}

/**
 * Get injuries for multiple clubs at once.
 * Useful for the weekly preview which needs data on 4-6 teams.
 */
export async function getInjuriesForClubs(clubAbbrs: string[]): Promise<Record<string, InjuryRecord[]>> {
  const client = getClient();
  if (!client) return {};

  const upperAbbrs = clubAbbrs.map((a) => a.toUpperCase());

  const { data, error } = await client
    .from('injuries')
    .select('*')
    .in('club_abbr', upperAbbrs)
    .order('club_abbr', { ascending: true })
    .order('player', { ascending: true });

  if (error) {
    console.error('[injuries] Failed to fetch for multiple clubs:', error.message);
    return {};
  }

  // Group by club abbreviation
  const grouped: Record<string, InjuryRecord[]> = {};
  for (const abbr of upperAbbrs) {
    grouped[abbr] = [];
  }
  for (const record of data ?? []) {
    if (record.club_abbr && grouped[record.club_abbr]) {
      grouped[record.club_abbr].push(record);
    }
  }

  return grouped;
}

/**
 * Get all injuries across the league.
 * Returns a summary with staleness check.
 */
export async function getAllInjuries(): Promise<InjurySummary> {
  const client = getClient();
  if (!client) {
    return { totalInjured: 0, clubCount: 0, lastScraped: null, isStale: true, injuries: [] };
  }

  const { data, error } = await client
    .from('injuries')
    .select('*')
    .order('club_abbr', { ascending: true })
    .order('player', { ascending: true });

  if (error) {
    console.error('[injuries] Failed to fetch all:', error.message);
    return { totalInjured: 0, clubCount: 0, lastScraped: null, isStale: true, injuries: [] };
  }

  const injuries = data ?? [];
  const clubs = new Set(injuries.map((r) => r.club_abbr).filter(Boolean));

  // Find the most recent scrape timestamp
  const lastScraped = injuries.reduce<string | null>((latest, r) => {
    if (!latest || r.scraped_at > latest) return r.scraped_at;
    return latest;
  }, null);

  // Data is stale if last scrape was more than 24 hours ago
  const isStale = !lastScraped || (Date.now() - new Date(lastScraped).getTime()) > 24 * 60 * 60 * 1000;

  return {
    totalInjured: injuries.length,
    clubCount: clubs.size,
    lastScraped,
    isStale,
    injuries,
  };
}

// ── Formatting helpers for agent prompts ──

/**
 * Format injury data as a concise text block for injection into LLM prompts.
 * This replaces the web-search-based injury gathering in your research pipeline.
 */
export function formatInjuriesForPrompt(injuries: InjuryRecord[], clubName?: string): string {
  if (injuries.length === 0) {
    return clubName
      ? `No injury data available for ${clubName}.`
      : 'No injury data available.';
  }

  const header = clubName
    ? `${clubName} — ${injuries.length} player(s) on injury list:`
    : `${injuries.length} player(s) on injury list:`;

  const lines = injuries.map((r) => {
    const parts = [r.player];
    if (r.reason) parts.push(`(${r.reason})`);
    if (r.return_date) parts.push(`— expected return: ${r.return_date}`);
    if (r.status) parts.push(`[${r.status}]`);
    return `  • ${parts.join(' ')}`;
  });

  return [header, ...lines].join('\n');
}

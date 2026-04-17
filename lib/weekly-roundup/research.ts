import { executeWebSearchDetailed } from '@/lib/web-search';
import type { WebSearchExecution } from '@/lib/web-search';
import { ESPNMatchDetail, formatScorersLine } from '@/lib/espn';
import { WeeklyPreviewSourceRef } from '@/lib/weekly-preview/types';
import {
  RoundupDossier,
  RoundupMatchResearch,
  RoundupResearchBundle,
} from '@/lib/weekly-roundup/types';

const SEARCH_BATCH_SIZE = 4;
const SEARCH_BATCH_DELAY_MS = 1100;

async function batchedSearch(queries: string[]): Promise<WebSearchExecution[]> {
  const results: WebSearchExecution[] = [];
  for (let i = 0; i < queries.length; i += SEARCH_BATCH_SIZE) {
    const batch = queries.slice(i, i + SEARCH_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((q) => executeWebSearchDetailed(q)));
    results.push(...batchResults);
    if (i + SEARCH_BATCH_SIZE < queries.length) {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_BATCH_DELAY_MS));
    }
  }
  return results;
}

function sourceId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function clip(text: string, max = 400): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

const currentMonth = () => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return months[new Date().getMonth()];
};

function teamNames(dossier: RoundupDossier) {
  const lookup = new Map(dossier.preRoundTeams.map((t) => [t.abbr, t.name]));
  return (abbr: string) => lookup.get(abbr) ?? abbr;
}

export async function buildRoundupResearchBundle(
  dossier: RoundupDossier
): Promise<RoundupResearchBundle> {
  const month = currentMonth();
  const year = new Date().getFullYear();
  const nameOf = teamNames(dossier);
  const shiftMap = new Map(dossier.probabilityShifts.map((s) => [s.team, s]));

  // Identify deep-dive fixtures
  const newcastleResult = dossier.targetClubResult;
  const rtcResult = dossier.resultThatChanged;
  const deepFixtureIds = new Set<string>();
  if (newcastleResult) deepFixtureIds.add(newcastleResult.fixtureId);
  if (rtcResult) deepFixtureIds.add(rtcResult.fixtureId);

  // ── Tier 1: Deep research (5-7 queries per fixture) ──
  const tier1Queries: Array<{ query: string; fixtureId: string }> = [];

  for (const fixtureId of deepFixtureIds) {
    const result = dossier.results.find((r) => r.fixtureId === fixtureId);
    if (!result) continue;

    const home = nameOf(result.homeTeam);
    const away = nameOf(result.awayTeam);

    tier1Queries.push(
      { query: `${home} vs ${away} match report Premier League ${month} ${year}`, fixtureId },
      { query: `${home} vs ${away} result score goals scorers ${month} ${year}`, fixtureId },
      { query: `${home} vs ${away} post-match reaction quotes ${month} ${year}`, fixtureId },
      { query: `${home} vs ${away} tactical analysis ${month} ${year}`, fixtureId },
      { query: `${home} ${away} Premier League player ratings ${month} ${year}`, fixtureId },
    );

    // Extra queries for Newcastle's match
    const isNewcastleMatch =
      result.homeTeam === 'NEW' || result.awayTeam === 'NEW';
    if (isNewcastleMatch) {
      tier1Queries.push(
        { query: `Newcastle Premier League result impact European race ${month} ${year}`, fixtureId },
        { query: `Newcastle season form results ${month} ${year}`, fixtureId },
      );
    }
  }

  // ── Tier 2: Light research (1-2 queries per remaining fixture) ──
  const tier2Queries: Array<{ query: string; fixtureId: string }> = [];

  for (const result of dossier.results) {
    if (deepFixtureIds.has(result.fixtureId)) continue;

    const home = nameOf(result.homeTeam);
    const away = nameOf(result.awayTeam);

    tier2Queries.push({
      query: `${home} vs ${away} Premier League result ${month} ${year}`,
      fixtureId: result.fixtureId,
    });

    // Extra query for high-impact fixtures
    const homeShift = shiftMap.get(result.homeTeam);
    const awayShift = shiftMap.get(result.awayTeam);
    const highImpact =
      (homeShift && (Math.abs(homeShift.delta.top7Pct) > 2 || Math.abs(homeShift.delta.survivalPct) > 2)) ||
      (awayShift && (Math.abs(awayShift.delta.top7Pct) > 2 || Math.abs(awayShift.delta.survivalPct) > 2));

    if (highImpact) {
      tier2Queries.push({
        query: `${home} vs ${away} match report ${month} ${year}`,
        fixtureId: result.fixtureId,
      });
    }
  }

  // Run all queries in batched groups (4 parallel, 1.1s gap) to stay under
  // Serper's 5/sec rate limit. Adds ~Nbatches*1.1s to research phase.
  const allQueries = [...tier1Queries, ...tier2Queries];
  const allSearches = await batchedSearch(allQueries.map((q) => q.query));

  // Build sources
  const sources: WeeklyPreviewSourceRef[] = allSearches.map((search, index) => ({
    id: sourceId('roundup-research', index),
    title: search.query,
    url: '',
    provider: search.provider,
  }));

  // Group research by fixture
  const fixtureResearch = new Map<string, { summaries: string[]; sourceIds: string[]; tier: 'deep' | 'light' }>();

  allQueries.forEach((q, index) => {
    const existing = fixtureResearch.get(q.fixtureId) ?? {
      summaries: [],
      sourceIds: [],
      tier: deepFixtureIds.has(q.fixtureId) ? 'deep' as const : 'light' as const,
    };
    const search = allSearches[index];
    if (search.resultCount > 0) {
      existing.summaries.push(clip(search.summary, 500));
    }
    existing.sourceIds.push(sources[index].id);
    fixtureResearch.set(q.fixtureId, existing);
  });

  // ESPN event lookup by team pair. ESPN is authoritative for scorers when
  // present; web-search is a fallback only when ESPN has no matching event.
  const espnByPair = new Map<string, ESPNMatchDetail>();
  for (const event of dossier.espnEvents ?? []) {
    espnByPair.set(`${event.homeTeam}-${event.awayTeam}`, event);
  }

  // Build RoundupMatchResearch for each fixture
  const matchResearch: RoundupMatchResearch[] = dossier.results.map((result) => {
    const research = fixtureResearch.get(result.fixtureId);
    const combined = research?.summaries.join(' ') ?? '';
    const espn = espnByPair.get(`${result.homeTeam}-${result.awayTeam}`);

    const espnScorersLine = espn ? formatScorersLine(espn.goals) : '';
    const scorersVerified = espnScorersLine.length > 0;

    return {
      fixtureId: result.fixtureId,
      homeTeam: result.homeTeam,
      awayTeam: result.awayTeam,
      score: `${result.homeGoals}-${result.awayGoals}`,
      scorers: scorersVerified ? espnScorersLine : '',
      scorersVerified,
      goals: espn?.goals ?? [],
      redCards: espn?.cards.filter((c) => c.type === 'red') ?? [],
      keyEvent: combined.length > 0 ? clip(combined, 200) : 'no key event found',
      tacticalNote: combined.length > 0 ? clip(combined, 200) : 'no tactical note found',
      managerQuote: combined.length > 0 ? clip(combined, 200) : 'no quote found',
      narrativeHook: combined.length > 0 ? clip(combined, 150) : `${nameOf(result.homeTeam)} ${result.homeGoals}-${result.awayGoals} ${nameOf(result.awayTeam)}`,
      tier: research?.tier ?? 'light',
      sourceRefIds: research?.sourceIds ?? [],
    };
  });

  return { matchResearch, sources };
}

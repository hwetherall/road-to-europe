import { executeWebSearchDetailed } from '@/lib/web-search';
import { computeSquadProfile } from '@/lib/what-if/squad-quality';
import { Fixture } from '@/lib/types';
import {
  WeeklyPreviewClubFactSheet,
  WeeklyPreviewHotNewsItem,
  WeeklyPreviewSourceRef,
} from '@/lib/weekly-preview/types';

interface ResearchBundle {
  hotNewsCandidates: WeeklyPreviewHotNewsItem[];
  clubFactSheet: WeeklyPreviewClubFactSheet;
  sources: WeeklyPreviewSourceRef[];
  gameOfWeekResearch: string[];
  approvedStorylines: string[];
}

function sourceId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function clip(text: string, max = 400): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

const currentMonth = () => {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return months[new Date().getMonth()];
};

export async function buildResearchBundle(input: {
  selectedClubName: string;
  opponentName: string | null;
  selectedClubFixture: Fixture | null;
  gameOfWeekFixture: Fixture | null;
}): Promise<ResearchBundle> {
  const month = currentMonth();
  const year = new Date().getFullYear();

  // ── Wave 1: broad league + club-specific news (6 queries) ──
  const wave1Queries = [
    `Premier League injuries suspensions team news ${month} ${year}`,
    `Premier League weekend preview matchday talking points ${month} ${year}`,
    `${input.selectedClubName} injuries suspensions team news ${month} ${year}`,
    `${input.selectedClubName} press conference manager quotes ${month} ${year}`,
    `${input.selectedClubName} recent form last 5 matches results Premier League ${year}`,
    `${input.selectedClubName} predicted lineup this weekend ${year}`,
  ];

  // ── Wave 2: opponent + match-specific research (up to 5 queries) ──
  const wave2Queries: string[] = [];
  if (input.opponentName) {
    wave2Queries.push(
      `${input.opponentName} injuries suspensions team news ${month} ${year}`,
      `${input.opponentName} recent form last 5 results Premier League ${year}`,
      `${input.opponentName} tactics style of play analysis ${year}`,
    );
  }
  if (input.gameOfWeekFixture) {
    const home = input.gameOfWeekFixture.homeTeam;
    const away = input.gameOfWeekFixture.awayTeam;
    wave2Queries.push(
      `${home} vs ${away} Premier League preview ${month} ${year}`,
      `${home} ${away} team news predicted lineups ${month} ${year}`,
    );
  }

  // Run both waves in parallel
  const [wave1Searches, wave2Searches] = await Promise.all([
    Promise.all(wave1Queries.map((query) => executeWebSearchDetailed(query))),
    Promise.all(wave2Queries.map((query) => executeWebSearchDetailed(query))),
  ]);

  const allSearches = [...wave1Searches, ...wave2Searches];

  const sources: WeeklyPreviewSourceRef[] = allSearches.map((search, index) => ({
    id: sourceId('research', index),
    title: search.query,
    url: '',
    provider: search.provider,
  }));

  // Hot news: draw from the first 3 searches (broad league news)
  const hotNewsCandidates: WeeklyPreviewHotNewsItem[] = allSearches
    .slice(0, 3)
    .map((search, originalIndex) => ({ search, originalIndex }))
    .filter(({ search, originalIndex }) =>
      originalIndex === 0 || (search.resultCount > 0 && search.summary.trim().length > 40)
    )
    .map(({ search, originalIndex }) => ({
      title: clip(search.summary, 120),
      summary: clip(search.summary),
      uncertaintyNote:
        search.resultCount <= 2 ? 'Limited search coverage; treat details as provisional.' : undefined,
      relevantTeams:
        originalIndex >= 2 && input.opponentName ? [input.selectedClubName, input.opponentName] : [input.selectedClubName],
      sourceRefIds: [sources[originalIndex].id],
    }));

  const selectedProfile = await computeSquadProfile('NEW');
  const opponentAbbr = input.selectedClubFixture
    ? input.selectedClubFixture.homeTeam === 'NEW'
      ? input.selectedClubFixture.awayTeam
      : input.selectedClubFixture.homeTeam
    : '';
  const opponentProfile = opponentAbbr ? await computeSquadProfile(opponentAbbr) : null;

  const clubFactSheet: WeeklyPreviewClubFactSheet = {
    clubNews: [
      clip(wave1Searches[2]?.summary || 'No Newcastle-specific club news surfaced.'),
      clip(wave1Searches[3]?.summary || 'No press-conference update surfaced.'),
    ],
    injuryUpdates: [
      clip(wave1Searches[2]?.summary || 'No Newcastle injury update found.'),
      input.opponentName && wave2Searches[0]
        ? clip(wave2Searches[0].summary || `No ${input.opponentName} injury update found.`)
        : 'No opponent injury update found.',
    ],
    squadUpdates: [
      `${selectedProfile.teamName} starting XI average: ${selectedProfile.averageStartingXI.toFixed(1)}.`,
      `${selectedProfile.teamName} weakest position group: ${selectedProfile.weakestPositionGroup} (${selectedProfile.weakestPositionAvg.toFixed(1)}).`,
      clip(wave1Searches[4]?.summary || 'No recent form data found.'),
      clip(wave1Searches[5]?.summary || 'No predicted lineup data found.'),
    ],
    opponentUpdates: input.opponentName
      ? [
          clip(wave2Searches[0]?.summary || `No ${input.opponentName} injury update found.`),
          clip(wave2Searches[1]?.summary || `No ${input.opponentName} form data found.`),
          clip(wave2Searches[2]?.summary || `No ${input.opponentName} tactical analysis found.`),
        ]
      : [],
    squadEdgeNotes: opponentProfile
      ? [
          `${selectedProfile.teamName} starting XI average ${selectedProfile.averageStartingXI.toFixed(1)} vs ${opponentProfile.teamName} ${opponentProfile.averageStartingXI.toFixed(1)}.`,
          `${selectedProfile.teamName} depth ${selectedProfile.depthScore.toFixed(1)} vs ${opponentProfile.teamName} ${opponentProfile.depthScore.toFixed(1)}.`,
        ]
      : [`${selectedProfile.teamName} squad profile loaded from the EA database.`],
  };

  // GOTW research: combine both GOTW-specific searches
  const gotwSearches = wave2Searches.slice(input.opponentName ? 3 : 0);
  const gameOfWeekResearch = gotwSearches
    .filter((s) => s.resultCount > 0)
    .map((s) => clip(s.summary, 500));

  return {
    hotNewsCandidates,
    clubFactSheet,
    sources,
    gameOfWeekResearch,
    approvedStorylines: [
      'The weekend should be framed through leverage rather than hype.',
      `${input.selectedClubName} are the emotional lens for the digest.`,
      'Every section should use quantified swing language when numbers are available.',
      'Use recent match results and form where research provides them, not just EA ratings.',
    ],
  };
}

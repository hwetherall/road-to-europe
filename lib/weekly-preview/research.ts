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

function clip(text: string, max = 260): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

export async function buildResearchBundle(input: {
  selectedClubName: string;
  opponentName: string | null;
  selectedClubFixture: Fixture | null;
  gameOfWeekFixture: Fixture | null;
}): Promise<ResearchBundle> {
  const queries = [
    'Premier League injuries suspensions manager change scandal this week 2026',
    'Premier League team news this week April 2026 injuries suspensions',
    `${input.selectedClubName} injuries suspensions team news 2026`,
    `${input.selectedClubName} press conference training update 2026`,
  ];

  if (input.opponentName) {
    queries.push(`${input.opponentName} injuries suspensions team news 2026`);
  }

  if (input.gameOfWeekFixture) {
    queries.push(
      `${input.gameOfWeekFixture.homeTeam} ${input.gameOfWeekFixture.awayTeam} tactical preview 2026`
    );
  }

  const searches = await Promise.all(queries.map((query) => executeWebSearchDetailed(query)));

  const sources: WeeklyPreviewSourceRef[] = searches.map((search, index) => ({
    id: sourceId('research', index),
    title: search.query,
    url: '',
    provider: search.provider,
  }));

  const hotNewsCandidates: WeeklyPreviewHotNewsItem[] = searches
    .slice(0, 3)
    .map((search, index) => ({
      title:
        index === 0
          ? 'Injuries and availability are shaping the weekend'
          : index === 1
            ? 'Managerial noise could turn into tactical change'
            : 'Off-pitch stories are close enough to affect selection',
      summary: clip(search.summary),
      uncertaintyNote:
        search.resultCount === 0 ? 'Search coverage was thin; treat this as provisional.' : undefined,
      relevantTeams:
        index === 2 && input.opponentName ? [input.selectedClubName, input.opponentName] : [input.selectedClubName],
      sourceRefIds: [sources[index].id],
    }))
    .slice(0, 3);

  const selectedProfile = await computeSquadProfile('NEW');
  const opponentAbbr = input.selectedClubFixture
    ? input.selectedClubFixture.homeTeam === 'NEW'
      ? input.selectedClubFixture.awayTeam
      : input.selectedClubFixture.homeTeam
    : '';
  const opponentProfile = opponentAbbr ? await computeSquadProfile(opponentAbbr) : null;

  const clubFactSheet: WeeklyPreviewClubFactSheet = {
    clubNews: [
      clip(searches[2]?.summary || 'No Newcastle-specific club news surfaced in preflight research.'),
      clip(
        searches[3]?.summary ||
          'No fresh training-ground or press-conference update surfaced in preflight research.'
      ),
    ],
    injuryUpdates: [
      clip(searches[2]?.summary || 'No Newcastle injury update found.'),
      input.opponentName
        ? clip(searches[4]?.summary || `No ${input.opponentName} injury update found.`)
        : 'No opponent injury update found.',
    ],
    squadUpdates: [
      `${selectedProfile.teamName} starting XI average: ${selectedProfile.averageStartingXI.toFixed(1)}.`,
      `${selectedProfile.teamName} weakest position group: ${selectedProfile.weakestPositionGroup} (${selectedProfile.weakestPositionAvg.toFixed(1)}).`,
    ],
    opponentUpdates: input.opponentName
      ? [clip(searches[4]?.summary || `No fresh ${input.opponentName} update found.`)]
      : [],
    squadEdgeNotes: opponentProfile
      ? [
          `${selectedProfile.teamName} starting XI average ${selectedProfile.averageStartingXI.toFixed(1)} vs ${opponentProfile.teamName} ${opponentProfile.averageStartingXI.toFixed(1)}.`,
          `${selectedProfile.teamName} depth ${selectedProfile.depthScore.toFixed(1)} vs ${opponentProfile.teamName} ${opponentProfile.depthScore.toFixed(1)}.`,
        ]
      : [`${selectedProfile.teamName} squad profile loaded from the EA database.`],
  };

  return {
    hotNewsCandidates,
    clubFactSheet,
    sources,
    gameOfWeekResearch:
      input.gameOfWeekFixture && searches[searches.length - 1]
        ? [clip(searches[searches.length - 1].summary, 420)]
        : [],
    approvedStorylines: [
      'The weekend should be framed through leverage rather than hype.',
      `${input.selectedClubName} are the emotional lens for the digest.`,
      'Every section should use quantified swing language when numbers are available.',
    ],
  };
}

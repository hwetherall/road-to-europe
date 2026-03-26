import { PlayerQuality, SquadProfile } from './types';
import { getPlayersForClub, getClubName } from './fifa-data';

// ── Position Grouping ──

const POSITION_GROUPS: Record<string, string> = {
  GK: 'goalkeeper',
  CB: 'centre-back',
  LB: 'full-back',
  RB: 'full-back',
  LWB: 'full-back',
  RWB: 'full-back',
  CDM: 'defensive-mid',
  CM: 'central-mid',
  CAM: 'attacking-mid',
  LM: 'wide-mid',
  RM: 'wide-mid',
  LW: 'winger',
  RW: 'winger',
  CF: 'striker',
  ST: 'striker',
};

function getPrimaryPositionGroup(player: PlayerQuality): string {
  const pos = player.positions[0] ?? '';
  return POSITION_GROUPS[pos] ?? 'unknown';
}

function groupByPosition(
  players: PlayerQuality[]
): Record<string, PlayerQuality[]> {
  const groups: Record<string, PlayerQuality[]> = {};
  for (const p of players) {
    const group = getPrimaryPositionGroup(p);
    if (!groups[group]) groups[group] = [];
    groups[group].push(p);
  }
  return groups;
}

// ── Squad Profile Computation ──

export function computeSquadProfileFromPlayers(
  players: PlayerQuality[],
  teamName: string,
  teamAbbr: string
): SquadProfile {
  if (players.length === 0) {
    return {
      teamName,
      teamAbbr,
      averageOverall: 0,
      averageStartingXI: 0,
      depthScore: 0,
      weakestPositionGroup: 'unknown',
      weakestPositionAvg: 0,
      strongestPositionGroup: 'unknown',
      strongestPositionAvg: 0,
      players: [],
      totalSquadValue: 0,
    };
  }

  const sorted = [...players].sort((a, b) => b.overall - a.overall);
  const startingXI = sorted.slice(0, 11);
  const bench = sorted.slice(11, 20);

  const positionGroups = groupByPosition(players);
  const groupAverages = Object.entries(positionGroups)
    .filter(([group]) => group !== 'unknown')
    .map(([group, groupPlayers]) => ({
      group,
      avg: groupPlayers.reduce((s, p) => s + p.overall, 0) / groupPlayers.length,
      count: groupPlayers.length,
    }));

  const weakest =
    groupAverages.length > 0
      ? groupAverages.reduce((a, b) => (a.avg < b.avg ? a : b))
      : { group: 'unknown', avg: 0 };
  const strongest =
    groupAverages.length > 0
      ? groupAverages.reduce((a, b) => (a.avg > b.avg ? a : b))
      : { group: 'unknown', avg: 0 };

  return {
    teamName,
    teamAbbr,
    averageOverall:
      players.reduce((s, p) => s + p.overall, 0) / players.length,
    averageStartingXI:
      startingXI.reduce((s, p) => s + p.overall, 0) /
      Math.min(11, startingXI.length),
    depthScore:
      bench.length > 0
        ? bench.reduce((s, p) => s + p.overall, 0) / bench.length
        : 0,
    weakestPositionGroup: weakest.group,
    weakestPositionAvg: weakest.avg,
    strongestPositionGroup: strongest.group,
    strongestPositionAvg: strongest.avg,
    players,
    totalSquadValue: players.reduce((s, p) => s + p.valueEuro, 0),
  };
}

export async function computeSquadProfile(
  teamAbbr: string
): Promise<SquadProfile> {
  const teamName = getClubName(teamAbbr) ?? teamAbbr;
  const players = await getPlayersForClub(teamAbbr);
  return computeSquadProfileFromPlayers(players, teamName, teamAbbr);
}

export async function computeAllSquadProfiles(): Promise<SquadProfile[]> {
  const ALL_TEAMS = [
    'ARS', 'MCI', 'MUN', 'AVL', 'CFC', 'LFC', 'BRE', 'FUL',
    'EVE', 'BRI', 'NEW', 'BOU', 'SUN', 'CRY', 'LEE', 'TOT',
    'NFO', 'WHU', 'BUR', 'WOL',
  ];

  const profiles: SquadProfile[] = [];
  for (const abbr of ALL_TEAMS) {
    profiles.push(await computeSquadProfile(abbr));
  }

  return profiles.sort((a, b) => b.averageStartingXI - a.averageStartingXI);
}

export function rankSquad(
  profiles: SquadProfile[],
  teamAbbr: string
): { rank: number; profile: SquadProfile; gapToTop: number } {
  const sorted = [...profiles].sort(
    (a, b) => b.averageStartingXI - a.averageStartingXI
  );
  const idx = sorted.findIndex((p) => p.teamAbbr === teamAbbr);
  const profile = sorted[idx] ?? sorted[0];
  const topProfile = sorted[0];

  return {
    rank: idx + 1,
    profile,
    gapToTop: topProfile
      ? +(topProfile.averageStartingXI - profile.averageStartingXI).toFixed(1)
      : 0,
  };
}

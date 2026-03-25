import { Team, SimulationResult, CardConfig, TeamContext } from './types';
import { getTeamColour } from './team-colours';

export function getTeamContext(team: Team, standings: Team[], simResult?: SimulationResult): TeamContext {
  const sorted = [...standings].sort(
    (a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor
  );
  const position = sorted.findIndex((t) => t.abbr === team.abbr) + 1;
  const gamesLeft = 38 - team.played;
  const maxPossiblePoints = team.points + gamesLeft * 3;
  const leaderPoints = sorted[0]?.points ?? 0;
  const relegationZonePoints = sorted[17]?.points ?? 0;

  if (position <= 2 || (position <= 4 && maxPossiblePoints >= leaderPoints)) {
    return titleContext(team, simResult);
  }

  if (position >= 15 || team.points - relegationZonePoints < gamesLeft * 2) {
    return relegationContext(team, simResult);
  }

  return europeContext(team, simResult);
}

function titleContext(team: Team, sim?: SimulationResult): TeamContext {
  const cards: CardConfig[] = [
    { key: 'championPct', label: 'Champion', sub: '1st Place', color: '#FFD700' },
    { key: 'top4Pct', label: 'Champions League', sub: 'Top 4', color: '#22c55e' },
    { key: 'top5Pct', label: 'UCL (Expanded)', sub: 'Top 5', color: '#C0C0C0' },
    { key: 'top7Pct', label: 'Any Europe', sub: 'Top 7', color: '#00CCAA' },
  ];
  const primaryMetric = pickPrimaryMetric(cards, 'championPct', sim);
  return {
    team: team.abbr,
    zone: 'title',
    primaryMetric,
    accentColor: getTeamColour(team.abbr),
    relevantCards: filterCards(cards, sim),
  };
}

function europeContext(team: Team, sim?: SimulationResult): TeamContext {
  const cards: CardConfig[] = [
    { key: 'top4Pct', label: 'Champions League', sub: 'Top 4', color: '#FFD700' },
    { key: 'top5Pct', label: 'UCL (Expanded)', sub: 'Top 5', color: '#C0C0C0' },
    { key: 'top6Pct', label: 'Europa League', sub: 'Top 6', color: '#FF6B35' },
    { key: 'top7Pct', label: 'Any Europe', sub: 'Top 7', color: '#00CCAA' },
  ];
  const primaryMetric = pickPrimaryMetric(cards, 'top7Pct', sim);
  return {
    team: team.abbr,
    zone: 'europe',
    primaryMetric,
    accentColor: getTeamColour(team.abbr),
    relevantCards: filterCards(cards, sim),
  };
}

function relegationContext(team: Team, sim?: SimulationResult): TeamContext {
  const cards: CardConfig[] = [
    { key: 'survivalPct', label: 'Survival', sub: 'Not Bottom 3', color: '#22c55e' },
    { key: 'relegationPct', label: 'Relegation', sub: 'Bottom 3', color: '#ef4444', invert: true },
    { key: 'top7Pct', label: 'Any Europe', sub: 'Top 7', color: '#00CCAA' },
    { key: 'top4Pct', label: 'Champions League', sub: 'Top 4', color: '#FFD700' },
  ];
  const primaryMetric = pickPrimaryMetric(cards, 'survivalPct', sim);
  return {
    team: team.abbr,
    zone: 'relegation',
    primaryMetric,
    accentColor: getTeamColour(team.abbr),
    relevantCards: filterCards(cards, sim),
  };
}

function pickPrimaryMetric(
  cards: CardConfig[],
  defaultMetric: TeamContext['primaryMetric'],
  sim?: SimulationResult
): TeamContext['primaryMetric'] {
  if (!sim) return defaultMetric;

  const EPSILON = 1e-9;
  const possible = cards.filter((card) => {
    const value = sim[card.key] as number;
    return value > EPSILON && value < 100 - EPSILON;
  });

  if (possible.length > 0) {
    const defaultCard = cards.find((card) => card.key === defaultMetric);
    const ranked = possible
      .map((card, index) => {
        const value = sim[card.key] as number;
        return {
          card,
          distanceToFifty: Math.abs(value - 50),
          index,
          isDefault: card.key === defaultCard?.key,
        };
      })
      .sort((a, b) => {
        if (a.distanceToFifty !== b.distanceToFifty) {
          return a.distanceToFifty - b.distanceToFifty;
        }
        if (a.isDefault !== b.isDefault) {
          return a.isDefault ? -1 : 1;
        }
        return a.index - b.index;
      });

    return ranked[0].card.key as TeamContext['primaryMetric'];
  }

  // If everything is effectively hard 0/100, prefer the least-extreme option.
  const leastExtreme = cards
    .map((card, index) => ({
      card,
      distanceToFifty: Math.abs((sim[card.key] as number) - 50),
      index,
      isDefault: card.key === defaultMetric,
    }))
    .sort((a, b) => {
      if (a.distanceToFifty !== b.distanceToFifty) {
        return a.distanceToFifty - b.distanceToFifty;
      }
      if (a.isDefault !== b.isDefault) {
        return a.isDefault ? -1 : 1;
      }
      return a.index - b.index;
    })[0];

  return (leastExtreme?.card.key as TeamContext['primaryMetric']) ?? defaultMetric;
}

function filterCards(cards: CardConfig[], sim?: SimulationResult): CardConfig[] {
  if (!sim) return cards.slice(0, 4);
  // Show cards where probability is between 0.1% and 99.9% (the interesting zone)
  // Always keep at least 3 cards, prioritizing the first ones (most relevant to zone)
  const interesting = cards.filter((c) => {
    const val = sim[c.key] as number;
    return val > 0.1 && val < 99.9;
  });
  if (interesting.length >= 3) return interesting.slice(0, 5);

  // Prefer probabilities that are at least still mathematically possible.
  const possible = cards.filter((c) => {
    const val = sim[c.key] as number;
    return val > 0 && val < 100;
  });
  if (possible.length >= 3) return possible.slice(0, 5);
  if (possible.length > 0) return possible;

  return cards.slice(0, 4);
}

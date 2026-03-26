import { OpenRouterTool } from '@/lib/openrouter';
import { Team, Fixture, SimulationResult } from '@/lib/types';
import { simulateFull } from '@/lib/server-simulation';
import { executeWebSearch } from '@/lib/web-search';
import { lookupPlayer, getPlayersForClub } from './fifa-data';
import { computeSquadProfile, computeSquadProfileFromPlayers, rankSquad, computeAllSquadProfiles } from './squad-quality';
import { CounterfactualScenario } from './types';

// ── Tool Definitions (OpenAI function-calling format) ──

export const WHAT_IF_TOOLS: OpenRouterTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_simulation',
      description:
        'Run a Monte Carlo simulation with modified probabilities. Provide team-level probability deltas (e.g. increase a team\'s home win probability by 0.08 across all their fixtures). Can also lock specific fixtures. Returns the target metric probability and position distribution. Use this to TEST every hypothesis with real numbers.',
      parameters: {
        type: 'object',
        properties: {
          modifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                teamAbbr: { type: 'string', description: 'Team abbreviation (e.g. AVL, ARS)' },
                homeWinDelta: { type: 'number', description: 'Delta to add to home win probability (-0.5 to 0.5)' },
                awayWinDelta: { type: 'number', description: 'Delta to add to away win probability (-0.5 to 0.5)' },
                drawDelta: { type: 'number', description: 'Delta to add to draw probability (-0.3 to 0.3)' },
              },
              required: ['teamAbbr', 'homeWinDelta', 'awayWinDelta', 'drawDelta'],
            },
            description: 'Probability modifications per team',
          },
          fixtureLocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fixtureId: { type: 'string' },
                result: { type: 'string', enum: ['home', 'draw', 'away'] },
              },
              required: ['fixtureId', 'result'],
            },
            description: 'Lock specific fixtures to a result',
          },
          simCount: { type: 'number', description: 'Number of simulations (default 10000)' },
        },
        required: ['modifications'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_player',
      description:
        "Look up a player's FIFA 26 quality ratings. Use this to compare players numerically — e.g. to check if a transfer target is a significant upgrade. Returns overall rating, potential, age, positions, and attribute breakdown.",
      parameters: {
        type: 'object',
        properties: {
          playerName: { type: 'string', description: 'Player name to search for' },
          fuzzyMatch: { type: 'boolean', description: 'Allow fuzzy matching (default true)' },
        },
        required: ['playerName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_squads',
      description:
        'Compare squad quality profiles between two or more teams. Returns overall ratings, depth scores, position-group breakdowns, and identifies the biggest quality gaps. Essential for diagnosing why a team cannot compete at the target level.',
      parameters: {
        type: 'object',
        properties: {
          teams: {
            type: 'array',
            items: { type: 'string' },
            description: 'Team abbreviations to compare (e.g. ["AVL", "ARS", "MCI"])',
            minItems: 2,
            maxItems: 5,
          },
        },
        required: ['teams'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the web for current football information. Use for: verifying transfers and fees, checking player availability, finding tactical analysis, checking fixture congestion. ALWAYS verify football facts via search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'evaluate_plausibility',
      description:
        'Score the plausibility of a scenario you have just simulated. Forces structured reasoning about whether it could really happen. Call this AFTER running a simulation, BEFORE storing the result.',
      parameters: {
        type: 'object',
        properties: {
          scenarioTitle: { type: 'string' },
          scenarioDescription: { type: 'string' },
          constraints: {
            type: 'array',
            items: { type: 'string' },
            description: 'List every reason this scenario might not be realistic',
          },
          plausibilityScore: {
            type: 'number',
            description: '0 = impossible fantasy, 100 = already happening. Be harsh.',
          },
          reasoning: { type: 'string' },
        },
        required: ['scenarioTitle', 'scenarioDescription', 'constraints', 'plausibilityScore', 'reasoning'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store_scenario',
      description:
        'Store a completed scenario with its simulation results and plausibility evaluation. Only store scenarios worth including in the final analysis — do not store dead ends.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: {
            type: 'string',
            enum: ['squad_upgrade', 'competition_priority', 'tactical_change', 'injury_prevention', 'combination', 'perfect_world'],
          },
          description: { type: 'string' },
          modifications: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                teamAbbr: { type: 'string' },
                homeWinDelta: { type: 'number' },
                awayWinDelta: { type: 'number' },
                drawDelta: { type: 'number' },
              },
              required: ['teamAbbr', 'homeWinDelta', 'awayWinDelta', 'drawDelta'],
            },
          },
          fixtureLocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                fixtureId: { type: 'string' },
                result: { type: 'string', enum: ['home', 'draw', 'away'] },
              },
            },
          },
          simulationResult: {
            type: 'object',
            properties: {
              targetMetric: { type: 'string' },
              baselineOdds: { type: 'number' },
              modifiedOdds: { type: 'number' },
              delta: { type: 'number' },
            },
            required: ['targetMetric', 'baselineOdds', 'modifiedOdds', 'delta'],
          },
          plausibility: {
            type: 'object',
            properties: {
              score: { type: 'number' },
              reasoning: { type: 'string' },
              constraints: { type: 'array', items: { type: 'string' } },
            },
            required: ['score', 'reasoning', 'constraints'],
          },
        },
        required: ['title', 'category', 'description', 'modifications', 'simulationResult', 'plausibility'],
      },
    },
  },
];

// ── Tool Executors ──

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function applyModifications(
  fixtures: Fixture[],
  modifications: Array<{ teamAbbr: string; homeWinDelta: number; awayWinDelta: number; drawDelta: number }>,
  fixtureLocks?: Array<{ fixtureId: string; result: string }>
): Fixture[] {
  let modified = fixtures.map((f) => ({ ...f }));

  // Apply fixture locks first
  if (fixtureLocks) {
    for (const lock of fixtureLocks) {
      modified = modified.map((f) => {
        if (f.id !== lock.fixtureId) return f;
        return {
          ...f,
          homeWinProb: lock.result === 'home' ? 1.0 : 0.0,
          drawProb: lock.result === 'draw' ? 1.0 : 0.0,
          awayWinProb: lock.result === 'away' ? 1.0 : 0.0,
        };
      });
    }
  }

  // Apply probability deltas
  for (const mod of modifications) {
    modified = modified.map((f) => {
      if (f.status !== 'SCHEDULED') return f;
      // Skip locked fixtures
      if (fixtureLocks?.some((l) => l.fixtureId === f.id)) return f;

      const isHome = f.homeTeam === mod.teamAbbr;
      const isAway = f.awayTeam === mod.teamAbbr;
      if (!isHome && !isAway) return f;

      let hDelta = 0, dDelta = 0, aDelta = 0;

      if (isHome) {
        hDelta = mod.homeWinDelta;
        dDelta = mod.drawDelta;
        aDelta = -(hDelta + dDelta);
      } else {
        aDelta = mod.awayWinDelta;
        dDelta = mod.drawDelta;
        hDelta = -(aDelta + dDelta);
      }

      const newHome = clamp((f.homeWinProb ?? 0.4) + hDelta, 0.01, 0.98);
      const newDraw = clamp((f.drawProb ?? 0.25) + dDelta, 0.01, 0.98);
      const newAway = clamp((f.awayWinProb ?? 0.35) + aDelta, 0.01, 0.98);

      const total = newHome + newDraw + newAway;
      return {
        ...f,
        homeWinProb: newHome / total,
        drawProb: newDraw / total,
        awayWinProb: newAway / total,
      };
    });
  }

  return modified;
}

export function createToolExecutors(
  teams: Team[],
  fixtures: Fixture[],
  targetTeam: string,
  targetMetric: keyof SimulationResult,
  scenarioAccumulator: CounterfactualScenario[]
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  let simulationCount = 0;

  return {
    async run_simulation(args) {
      const modifications = (args.modifications as Array<{
        teamAbbr: string;
        homeWinDelta: number;
        awayWinDelta: number;
        drawDelta: number;
      }>) ?? [];
      const fixtureLocks = args.fixtureLocks as Array<{ fixtureId: string; result: string }> | undefined;
      const simCount = (args.simCount as number) ?? 10000;

      const modifiedFixtures = applyModifications(fixtures, modifications, fixtureLocks);
      const results = simulateFull(teams, modifiedFixtures, simCount);
      simulationCount++;

      const targetResult = results.find((r) => r.team === targetTeam);
      const metricValue = targetResult ? (targetResult[targetMetric] as number) : 0;

      // Return a useful summary
      return {
        targetTeam,
        targetMetric,
        targetMetricPct: +metricValue.toFixed(2),
        expectedPoints: targetResult ? +targetResult.avgPoints.toFixed(1) : 0,
        expectedPosition: targetResult ? +targetResult.avgPosition.toFixed(1) : 0,
        top4Pct: targetResult ? +targetResult.top4Pct.toFixed(2) : 0,
        top7Pct: targetResult ? +targetResult.top7Pct.toFixed(2) : 0,
        championPct: targetResult ? +((targetResult as unknown as Record<string, number>).championPct ?? 0).toFixed(2) : 0,
        simulationsRun: simCount,
        totalSimulationsThisSession: simulationCount,
      };
    },

    async lookup_player(args) {
      const name = args.playerName as string;
      const fuzzy = (args.fuzzyMatch as boolean) ?? true;
      const players = await lookupPlayer(name, fuzzy);

      if (players.length === 0) {
        return { found: false, message: `No player found matching "${name}"` };
      }

      return {
        found: true,
        count: players.length,
        players: players.map((p) => ({
          name: p.name,
          overall: p.overall,
          potential: p.potential,
          age: p.age,
          positions: p.positions,
          club: p.club,
          pace: p.pace,
          shooting: p.shooting,
          passing: p.passing,
          dribbling: p.dribbling,
          defending: p.defending,
          physical: p.physical,
        })),
      };
    },

    async compare_squads(args) {
      const teamAbbrs = args.teams as string[];
      const allProfiles = await computeAllSquadProfiles();

      const profiles = teamAbbrs.map((abbr) => {
        const existing = allProfiles.find((p) => p.teamAbbr === abbr);
        if (existing) return existing;
        // Fallback: compute individually
        return computeSquadProfileFromPlayers([], abbr, abbr);
      });

      return {
        profiles: profiles.map((p) => ({
          team: p.teamAbbr,
          name: p.teamName,
          averageOverall: +p.averageOverall.toFixed(1),
          averageStartingXI: +p.averageStartingXI.toFixed(1),
          depthScore: +p.depthScore.toFixed(1),
          weakestPosition: `${p.weakestPositionGroup} (${p.weakestPositionAvg.toFixed(1)})`,
          strongestPosition: `${p.strongestPositionGroup} (${p.strongestPositionAvg.toFixed(1)})`,
          squadSize: p.players.length,
          totalValue: p.totalSquadValue,
        })),
        rankings: allProfiles.slice(0, 20).map((p, i) => ({
          rank: i + 1,
          team: p.teamAbbr,
          startingXIAvg: +p.averageStartingXI.toFixed(1),
        })),
      };
    },

    async web_search(args) {
      const query = args.query as string;
      try {
        const results = await executeWebSearch(query);
        // Truncate to avoid bloating conversation
        return results.length > 1500 ? results.slice(0, 1500) + '...' : results;
      } catch (e) {
        return `Search failed: ${e instanceof Error ? e.message : 'Unknown error'}`;
      }
    },

    async evaluate_plausibility(args) {
      // Passthrough — the structured output itself is the value
      return {
        scenarioTitle: args.scenarioTitle,
        plausibilityScore: args.plausibilityScore,
        constraints: args.constraints,
        reasoning: args.reasoning,
      };
    },

    async store_scenario(args) {
      const scenario: CounterfactualScenario = {
        id: `scenario-${scenarioAccumulator.length + 1}`,
        title: args.title as string,
        category: args.category as CounterfactualScenario['category'],
        description: args.description as string,
        modifications: ((args.modifications as Array<Record<string, unknown>>) ?? []).map((m) => ({
          type: 'team_quality_delta' as const,
          description: '',
          teamAbbr: m.teamAbbr as string,
          homeWinDelta: m.homeWinDelta as number,
          awayWinDelta: m.awayWinDelta as number,
          drawDelta: m.drawDelta as number,
        })),
        simulationResult: args.simulationResult as CounterfactualScenario['simulationResult'],
        plausibility: args.plausibility as CounterfactualScenario['plausibility'],
        iteration: scenarioAccumulator.length + 1,
      };

      scenarioAccumulator.push(scenario);

      return {
        stored: true,
        scenarioId: scenario.id,
        scenarioCount: scenarioAccumulator.length,
      };
    },
  };
}

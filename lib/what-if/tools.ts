import { OpenRouterTool } from '@/lib/openrouter';
import { Team, Fixture, SimulationResult } from '@/lib/types';
import { simulateFullSeason, TeamModification } from './full-season-sim';
import { executeWebSearchDetailed } from '@/lib/web-search';
import { lookupPlayer } from './fifa-data';
import { computeSquadProfileFromPlayers, computeAllSquadProfiles } from './squad-quality';
import { CounterfactualScenario, WhatIfSearchTraceEntry } from './types';

// ── Tool Definitions (OpenAI function-calling format) ──

export const WHAT_IF_TOOLS: OpenRouterTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_simulation',
      description:
        'Run a FULL-SEASON Monte Carlo simulation (all 380 fixtures from scratch) with modified probabilities. Modifications apply to EVERY match in the season, not just remaining games. Teams start at 0 points — current standings are ignored. Returns the target metric probability, expected points, and baseline comparison.',
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
            description: 'Probability modifications per team (applied across ALL 380 fixtures)',
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
        'Search the web for current football information. Use for: verifying transfers and fees, checking player availability, finding tactical analysis, checking fixture congestion. ALWAYS include "2025-26" in queries about teams. ALWAYS verify football facts via search.',
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
              expectedPoints: { type: 'number', description: 'Modified expected points from the simulation' },
              expectedPosition: { type: 'number', description: 'Modified expected position from the simulation' },
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

export interface FullSeasonBaseline {
  targetMetricPct: number;
  expectedPoints: number;
  expectedPosition: number;
}

export function createToolExecutors(
  teams: Team[],
  fixtures: Fixture[],
  targetTeam: string,
  targetMetric: keyof SimulationResult,
  scenarioAccumulator: CounterfactualScenario[],
  baselineFullSeason?: FullSeasonBaseline,
  searchTrail?: WhatIfSearchTraceEntry[],
  phase?: WhatIfSearchTraceEntry['phase']
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  let simulationCount = 0;

  return {
    async run_simulation(args) {
      const modifications = ((args.modifications as Array<{
        teamAbbr: string;
        homeWinDelta: number;
        awayWinDelta: number;
        drawDelta: number;
      }>) ?? []).map(m => ({
        teamAbbr: m.teamAbbr,
        homeWinDelta: m.homeWinDelta,
        awayWinDelta: m.awayWinDelta,
        drawDelta: m.drawDelta,
      } satisfies TeamModification));

      const simCount = (args.simCount as number) ?? 10000;

      // Run full-season simulation
      const results = simulateFullSeason({
        teams,
        fixtures,
        modifications,
        numSims: simCount,
      });
      simulationCount++;

      const targetResult = results.find((r) => r.team === targetTeam);
      const metricValue = targetResult ? (targetResult[targetMetric] as number) : 0;

      // Use cached baseline if available, otherwise compute
      let baselinePct = baselineFullSeason?.targetMetricPct ?? 0;
      let baselineExpPoints = baselineFullSeason?.expectedPoints ?? 0;
      let baselineExpPos = baselineFullSeason?.expectedPosition ?? 0;

      if (!baselineFullSeason) {
        const baselineResults = simulateFullSeason({
          teams,
          fixtures,
          modifications: [],
          numSims: 10000,
        });
        const baselineTarget = baselineResults.find((r) => r.team === targetTeam);
        baselinePct = baselineTarget ? (baselineTarget[targetMetric] as number) : 0;
        baselineExpPoints = baselineTarget?.avgPoints ?? 0;
        baselineExpPos = baselineTarget?.avgPosition ?? 0;
      }

      return {
        targetTeam,
        targetMetric,
        targetMetricPct: +metricValue.toFixed(2),
        baselinePct: +baselinePct.toFixed(2),
        delta: +(metricValue - baselinePct).toFixed(2),
        expectedPoints: targetResult ? +targetResult.avgPoints.toFixed(1) : 0,
        expectedPosition: targetResult ? +targetResult.avgPosition.toFixed(1) : 0,
        baselineExpectedPoints: +baselineExpPoints.toFixed(1),
        baselineExpectedPosition: +baselineExpPos.toFixed(1),
        top4Pct: targetResult ? +targetResult.top4Pct.toFixed(2) : 0,
        top7Pct: targetResult ? +targetResult.top7Pct.toFixed(2) : 0,
        championPct: targetResult ? +((targetResult as unknown as Record<string, number>).championPct ?? 0).toFixed(2) : 0,
        simulationsRun: simCount,
        totalSimulationsThisSession: simulationCount,
        note: 'Full-season simulation: all 380 fixtures from scratch using Elo. Teams start at 0 points.',
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
      let query = args.query as string;

      // Fix 2: Auto-append "2025-26" to queries that mention PL teams but no season
      const teamNames = teams.map(t => t.name.toLowerCase());
      const teamAbbrs = teams.map(t => t.abbr.toLowerCase());
      const mentionsTeam = teamNames.some(n => query.toLowerCase().includes(n)) ||
                           teamAbbrs.some(a => query.toLowerCase().includes(a));
      const hasSeason = /20\d\d[-\/]\d\d/.test(query) || /20\d\d/.test(query);

      if (mentionsTeam && !hasSeason) {
        query = `${query} 2025-26`;
      }

      try {
        const execution = await executeWebSearchDetailed(query);
        if (searchTrail && phase) {
          searchTrail.push({
            phase,
            query: execution.query,
            provider: execution.provider,
            resultCount: execution.resultCount,
          });
        }
        // Truncate to avoid bloating conversation
        return execution.summary.length > 1500
          ? execution.summary.slice(0, 1500) + '...'
          : execution.summary;
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
        fixtureLocks: ((args.fixtureLocks as Array<Record<string, unknown>>) ?? []).map((lock) => ({
          fixtureId: lock.fixtureId as string,
          result: lock.result as 'home' | 'draw' | 'away',
        })),
        simulationResult: {
          ...(args.simulationResult as CounterfactualScenario['simulationResult']),
          modifiedExpectedPoints: (args.simulationResult as Record<string, unknown>).expectedPoints as number | undefined,
          modifiedExpectedPosition: (args.simulationResult as Record<string, unknown>).expectedPosition as number | undefined,
        },
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

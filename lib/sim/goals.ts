/**
 * Goal-model parameters, shared by every simulation engine.
 *
 * These were four separate copies (lib/montecarlo.ts, lib/server-simulation.ts
 * twice, lib/what-if/full-season-sim.ts). Consolidated here because this table
 * is the deliberate seam for the Dixon-Coles work: goal expectation currently
 * depends only on the result type, not on who is playing, so Arsenal beating
 * Burnley and Burnley beating Arsenal generate the same scoreline distribution.
 * Replacing that means replacing this file, not hunting four copies.
 */
export const GOAL_PARAMS = {
  homeWin: { home: 1.7, away: 0.6 },
  draw: { home: 1.1, away: 1.1 },
  awayWin: { home: 0.7, away: 1.5 },
} as const;

/** Points awarded by outcome code: 0 home win, 1 draw, 2 away win. */
export const POINTS_BY_OUTCOME: ReadonlyArray<readonly [number, number]> = [
  [3, 0],
  [1, 1],
  [0, 3],
];

import { CandidatePath, FixtureLock } from './types';

/**
 * Compute composite plausibility for a set of fixture locks.
 * This is the product of individual lock plausibilities (bookmaker probabilities).
 */
export function compositePlausibility(locks: FixtureLock[]): number {
  return locks.reduce((product, lock) => product * lock.individualPlausibility, 1);
}

/**
 * Remove paths with composite plausibility below threshold.
 */
export function filterByPlausibility(
  paths: CandidatePath[],
  minPlausibility: number = 0.005
): CandidatePath[] {
  return paths.filter((p) => p.compositePlausibility >= minPlausibility);
}

/**
 * Deduplicate paths that are >80% similar in their lock sets.
 * Keeps the first (higher-plausibility) path in each cluster.
 */
export function deduplicatePaths(paths: CandidatePath[]): CandidatePath[] {
  const kept: CandidatePath[] = [];
  for (const path of paths) {
    const isDuplicate = kept.some((existing) => {
      const existingLockSet = new Set(
        existing.locks.map((l) => `${l.fixtureId}:${l.result}`)
      );
      const overlap = path.locks.filter((l) =>
        existingLockSet.has(`${l.fixtureId}:${l.result}`)
      );
      return (
        overlap.length / Math.max(path.locks.length, existing.locks.length) > 0.8
      );
    });
    if (!isDuplicate) kept.push(path);
  }
  return kept;
}

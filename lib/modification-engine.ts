import { Fixture } from './types';
import { Chapter, TeamFixtureLock } from './chat-types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Resolve a team-relative fixture lock to home/draw/away probabilities.
 * "win" means the team wins, "lose" means they lose.
 */
function resolveTeamLock(
  fixture: Fixture,
  lock: TeamFixtureLock
): { homeWinProb: number; drawProb: number; awayWinProb: number } {
  const isHome = fixture.homeTeam === lock.team;

  if (lock.result === 'draw') {
    return { homeWinProb: 0.0, drawProb: 1.0, awayWinProb: 0.0 };
  }
  if (lock.result === 'win') {
    // Team wins: if they're home → home win, if away → away win
    return isHome
      ? { homeWinProb: 1.0, drawProb: 0.0, awayWinProb: 0.0 }
      : { homeWinProb: 0.0, drawProb: 0.0, awayWinProb: 1.0 };
  }
  // lose: team loses
  return isHome
    ? { homeWinProb: 0.0, drawProb: 0.0, awayWinProb: 1.0 }
    : { homeWinProb: 1.0, drawProb: 0.0, awayWinProb: 0.0 };
}

/** Apply team-level fixture locks to a fixture list. Returns set of locked fixture IDs. */
function applyTeamFixtureLocks(
  fixtures: Fixture[],
  locks: TeamFixtureLock[]
): Set<string> {
  const lockedIds = new Set<string>();

  for (const lock of locks) {
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      if (f.status !== 'SCHEDULED') continue;
      if (f.homeTeam !== lock.team && f.awayTeam !== lock.team) continue;

      const resolved = resolveTeamLock(f, lock);
      fixtures[i] = { ...f, ...resolved };
      lockedIds.add(f.id);
    }
  }

  return lockedIds;
}

/** Apply probability modifier deltas, skipping already-locked fixtures. */
function applyProbabilityModifier(
  fixtures: Fixture[],
  mod: NonNullable<Chapter['modification']>,
  lockedIds: Set<string>
): void {
  for (const teamMod of mod.teamModifications) {
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      if (lockedIds.has(f.id)) continue; // Don't modify locked fixtures
      const isHome = f.homeTeam === teamMod.team;
      const isAway = f.awayTeam === teamMod.team;
      if (!isHome && !isAway) continue;
      if (f.status !== 'SCHEDULED') continue;

      // Check for fixture-specific override
      const fixtureOverride = mod.fixtureSpecificOverrides?.find(
        (o) => o.fixtureId === f.id
      );

      let hDelta = 0,
        dDelta = 0,
        aDelta = 0;

      if (fixtureOverride) {
        hDelta = fixtureOverride.homeWinDelta ?? 0;
        dDelta = fixtureOverride.drawDelta ?? 0;
        aDelta = fixtureOverride.awayWinDelta ?? 0;
      } else if (isHome) {
        hDelta = teamMod.homeWinDelta;
        dDelta = teamMod.drawDelta;
        aDelta = -(hDelta + dDelta);
      } else {
        aDelta = teamMod.awayWinDelta;
        dDelta = teamMod.drawDelta;
        hDelta = -(aDelta + dDelta);
      }

      const newHome = clamp((f.homeWinProb ?? 0) + hDelta, 0.01, 0.98);
      const newDraw = clamp((f.drawProb ?? 0) + dDelta, 0.01, 0.98);
      const newAway = clamp((f.awayWinProb ?? 0) + aDelta, 0.01, 0.98);

      // Re-normalise to sum to 1.0
      const total = newHome + newDraw + newAway;
      fixtures[i] = {
        ...f,
        homeWinProb: newHome / total,
        drawProb: newDraw / total,
        awayWinProb: newAway / total,
      };
    }
  }
}

/**
 * Apply all active chapters to a fixture list, returning modified probabilities.
 * Chapters are applied in creation order (oldest first).
 * Fixture locks override probabilities entirely.
 * Probability modifiers apply deltas and re-normalise.
 * Compound chapters apply fixture locks first, then probability modifiers
 * (skipping already-locked fixtures).
 */
export function applyChapters(fixtures: Fixture[], chapters: Chapter[]): Fixture[] {
  const modified = fixtures.map((f) => ({ ...f }));

  const activeChapters = chapters
    .filter((c) => c.status === 'active')
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const chapter of activeChapters) {
    // Track which fixtures are locked by this chapter (so we don't modify them with probability deltas)
    const lockedIds = new Set<string>();

    // Step 1: Apply single fixture lock (legacy format)
    if (chapter.fixtureLock) {
      const fId = chapter.fixtureLock.fixtureId;
      const idx = modified.findIndex((f) => f.id === fId);
      if (idx >= 0) {
        modified[idx] = {
          ...modified[idx],
          homeWinProb: chapter.fixtureLock.result === 'home' ? 1.0 : 0.0,
          drawProb: chapter.fixtureLock.result === 'draw' ? 1.0 : 0.0,
          awayWinProb: chapter.fixtureLock.result === 'away' ? 1.0 : 0.0,
        };
        lockedIds.add(fId);
      }
    }

    // Step 2: Apply team-level fixture locks (compound format)
    if (chapter.teamFixtureLocks && chapter.teamFixtureLocks.length > 0) {
      const teamLockedIds = applyTeamFixtureLocks(modified, chapter.teamFixtureLocks);
      teamLockedIds.forEach((id) => lockedIds.add(id));
    }

    // Step 3: Apply probability modifiers (skipping locked fixtures)
    if (chapter.modification) {
      applyProbabilityModifier(modified, chapter.modification, lockedIds);
    }
  }

  return modified;
}

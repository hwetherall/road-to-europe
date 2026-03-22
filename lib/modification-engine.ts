import { Fixture } from './types';
import { Chapter } from './chat-types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Apply all active chapters to a fixture list, returning modified probabilities.
 * Chapters are applied in creation order (oldest first).
 * Fixture locks override probabilities entirely.
 * Probability modifiers apply deltas and re-normalise.
 */
export function applyChapters(fixtures: Fixture[], chapters: Chapter[]): Fixture[] {
  let modified = fixtures.map((f) => ({ ...f }));

  const activeChapters = chapters
    .filter((c) => c.status === 'active')
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const chapter of activeChapters) {
    if (chapter.type === 'fixture_lock' && chapter.fixtureLock) {
      modified = modified.map((f) => {
        if (f.id !== chapter.fixtureLock!.fixtureId) return f;
        return {
          ...f,
          homeWinProb: chapter.fixtureLock!.result === 'home' ? 1.0 : 0.0,
          drawProb: chapter.fixtureLock!.result === 'draw' ? 1.0 : 0.0,
          awayWinProb: chapter.fixtureLock!.result === 'away' ? 1.0 : 0.0,
        };
      });
    }

    if (chapter.type === 'probability_modifier' && chapter.modification) {
      const mod = chapter.modification;

      for (const teamMod of mod.teamModifications) {
        modified = modified.map((f) => {
          const isHome = f.homeTeam === teamMod.team;
          const isAway = f.awayTeam === teamMod.team;
          if (!isHome && !isAway) return f;
          if (f.status !== 'SCHEDULED') return f;

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
          return {
            ...f,
            homeWinProb: newHome / total,
            drawProb: newDraw / total,
            awayWinProb: newAway / total,
          };
        });
      }
    }
  }

  return modified;
}

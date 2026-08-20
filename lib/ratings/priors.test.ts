import { describe, expect, it } from 'vitest';
import {
  LEAGUE_MEAN_ELO,
  PRESEASON_PRIORS,
  PRIORS_GENERATED_AT,
  REGRESSION_RETAIN,
  priorElo,
  priorFor,
  priorSpread,
} from '@/lib/ratings/priors';
import { CLUBS, CLUB_ABBRS } from '@/lib/clubs';

describe('preseason priors', () => {
  /**
   * The bug this table exists to fix: teamElo returned exactly 1500 for all
   * twenty clubs at played === 0, so Matchday 0 was twenty identical clubs and
   * every projection downstream was a coin flip.
   */
  it('is not flat', () => {
    expect(priorSpread()).toBeGreaterThan(150);
  });

  it('covers every club in the league, and nothing else', () => {
    expect(Object.keys(PRESEASON_PRIORS).sort()).toEqual([...CLUB_ABBRS].sort());
    for (const club of CLUBS) {
      expect(priorFor(club.abbr)).toBeDefined();
    }
  });

  it('records where every prior came from', () => {
    for (const [abbr, prior] of Object.entries(PRESEASON_PRIORS)) {
      expect(prior.from === 'carryover_regressed' || prior.from === 'market_relegation').toBe(true);
      if (prior.from === 'carryover_regressed') {
        // A carryover prior must be reproducible from the number it came from.
        expect(prior.lastSeasonPoints, `${abbr} has no lastSeasonPoints`).toBeGreaterThan(0);
      } else {
        // A market-set or hand-set value must say why.
        expect(prior.note, `${abbr} has no note`).toBeTruthy();
      }
    }
  });

  /**
   * Recompute every carryover prior from last season's points. This is what makes
   * the table auditable rather than merely present: if someone edits a rating
   * without editing the reason, the arithmetic stops matching.
   */
  it('reproduces every carryover prior from last season points', () => {
    for (const [abbr, prior] of Object.entries(PRESEASON_PRIORS)) {
      if (prior.from !== 'carryover_regressed') continue;
      const ppg = (prior.lastSeasonPoints as number) / 38;
      const finalElo = LEAGUE_MEAN_ELO + (ppg - 1.5) * 200;
      const expected = Math.round(LEAGUE_MEAN_ELO + REGRESSION_RETAIN * (finalElo - LEAGUE_MEAN_ELO));
      expect(prior.elo, `${abbr}`).toBe(expected);
    }
  });

  it('shrinks toward the mean rather than away from it', () => {
    expect(REGRESSION_RETAIN).toBeGreaterThan(0);
    expect(REGRESSION_RETAIN).toBeLessThan(1);
    for (const prior of Object.values(PRESEASON_PRIORS)) {
      if (prior.from !== 'carryover_regressed') continue;
      const ppg = (prior.lastSeasonPoints as number) / 38;
      const unregressed = LEAGUE_MEAN_ELO + (ppg - 1.5) * 200;
      // The regressed prior must sit between the raw estimate and the mean.
      const lo = Math.min(unregressed, LEAGUE_MEAN_ELO);
      const hi = Math.max(unregressed, LEAGUE_MEAN_ELO);
      expect(prior.elo).toBeGreaterThanOrEqual(Math.floor(lo));
      expect(prior.elo).toBeLessThanOrEqual(Math.ceil(hi));
    }
  });

  it('warns rather than silently rating an unknown club as promoted', () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    try {
      const value = priorElo('ZZZ');
      expect(value).toBe(1380);
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain('ZZZ');
      // Logged once per unknown club, not once per call.
      priorElo('ZZZ');
      expect(errors.length).toBe(1);
    } finally {
      console.error = original;
    }
  });

  it('records when it was generated', () => {
    expect(PRIORS_GENERATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

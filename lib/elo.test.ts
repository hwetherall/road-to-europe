import { describe, expect, it } from 'vitest';
import { eloBreakdown, eloProb, priorWeight, teamElo } from '@/lib/elo';
import { PRESEASON_PRIORS, priorElo } from '@/lib/ratings/priors';
import { CLUB_ABBRS } from '@/lib/clubs';
import { Team } from '@/lib/types';

function team(abbr: string, played: number, points: number): Team {
  return {
    id: abbr, name: abbr, abbr, points, played,
    goalDifference: 0, goalsFor: 0, goalsAgainst: 0, won: 0, drawn: 0, lost: 0,
  };
}

describe('priorWeight', () => {
  it('starts at pure prior and decays', () => {
    expect(priorWeight(0)).toBe(1);
    expect(priorWeight(12)).toBeCloseTo(0.5, 12);
    expect(priorWeight(19)).toBeCloseTo(12 / 31, 12);
    expect(priorWeight(38)).toBeLessThan(0.25);
  });

  it('is monotonically decreasing', () => {
    for (let n = 1; n <= 38; n++) {
      expect(priorWeight(n)).toBeLessThan(priorWeight(n - 1));
    }
  });

  it('treats a negative match count as zero rather than inverting', () => {
    expect(priorWeight(-5)).toBe(1);
  });
});

describe('teamElo', () => {
  /**
   * D1, the failure this replaced: every club came back as exactly 1500 before a
   * ball was kicked, so the whole league was a coin flip and 370 of the season's
   * 380 fixture probabilities were identical.
   */
  it('is not uniform at Matchday 0', () => {
    const ratings = CLUB_ABBRS.map((abbr) => teamElo(team(abbr, 0, 0)));
    expect(new Set(ratings).size).toBeGreaterThan(10);
    expect(Math.max(...ratings) - Math.min(...ratings)).toBeGreaterThan(150);
  });

  it('is exactly the prior before any match is played', () => {
    for (const abbr of CLUB_ABBRS) {
      expect(teamElo(team(abbr, 0, 0))).toBe(priorElo(abbr));
    }
  });

  it('moves toward observed form as evidence accumulates', () => {
    // A club performing far above its prior: 3.0 PPG is title-winning form.
    const abbr = 'NEW';
    const prior = priorElo(abbr);
    const early = teamElo(team(abbr, 3, 9));
    const mid = teamElo(team(abbr, 19, 57));
    const late = teamElo(team(abbr, 38, 114));

    expect(early).toBeGreaterThan(prior);
    expect(mid).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mid);
    // Never all the way to pure form while any prior weight remains.
    const pureForm = 1500 + (3.0 - 1.5) * 200;
    expect(late).toBeLessThan(pureForm);
  });

  it('blends in the stated proportion', () => {
    const abbr = 'ARS';
    const prior = priorElo(abbr);
    const played = 12;
    const points = 12; // 1.0 PPG
    const form = 1500 + (1.0 - 1.5) * 200;
    // At 12 matches the weight is exactly one half.
    expect(teamElo(team(abbr, played, points))).toBeCloseTo(0.5 * prior + 0.5 * form, 9);
  });

  it('exposes a breakdown consistent with the blend', () => {
    const t = team('TOT', 6, 8);
    const b = eloBreakdown(t);
    expect(b.played).toBe(6);
    expect(b.prior).toBe(priorElo('TOT'));
    expect(b.priorWeight).toBeCloseTo(priorWeight(6), 12);
    expect(b.blended).toBeCloseTo(b.priorWeight * b.prior + (1 - b.priorWeight) * b.form, 9);
    expect(b.blended).toBe(teamElo(t));
  });

  it('orders clubs by prior strength at Matchday 0', () => {
    const strongest = Object.entries(PRESEASON_PRIORS).sort((a, b) => b[1].elo - a[1].elo)[0][0];
    const weakest = Object.entries(PRESEASON_PRIORS).sort((a, b) => a[1].elo - b[1].elo)[0][0];
    expect(teamElo(team(strongest, 0, 0))).toBeGreaterThan(teamElo(team(weakest, 0, 0)));
  });
});

describe('eloProb', () => {
  it('is unchanged by the blend work: normalised, home-advantaged', () => {
    const p = eloProb(1500, 1500);
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 12);
    // Equal ratings, so the home side is favoured only by home advantage.
    expect(p.homeWin).toBeGreaterThan(p.awayWin);
  });

  it('favours the stronger side', () => {
    const strong = eloProb(1600, 1400);
    const weak = eloProb(1400, 1600);
    expect(strong.homeWin).toBeGreaterThan(weak.homeWin);
    expect(strong.homeWin + strong.draw + strong.awayWin).toBeCloseTo(1, 12);
  });
});

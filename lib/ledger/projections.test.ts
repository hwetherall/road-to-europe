import { describe, expect, it } from 'vitest';
import { buildProjectionRows, MODEL_VERSION, PRESEASON_MATCHDAY } from '@/lib/ledger/projections';
import { rankedProbabilityScore } from '@/lib/ledger/scoring';
import { SimulationResult } from '@/lib/types';

function result(team: string, dist: number[]): SimulationResult {
  return {
    team,
    positionDistribution: dist,
    top4Pct: 10, top5Pct: 12, top6Pct: 14, top7Pct: 16,
    relegationPct: 5, championPct: 3, survivalPct: 95,
    avgPoints: 55.1234, avgPosition: 8.5678,
  };
}

const flat20 = new Array(20).fill(500);

describe('buildProjectionRows', () => {
  it('stamps season, matchday, model and prior source', () => {
    const rows = buildProjectionRows([result('NEW', flat20)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].matchday).toBe(PRESEASON_MATCHDAY);
    expect(rows[0].model_version).toBe(MODEL_VERSION);
    expect(rows[0].season).toBe('2026-27');
    expect(rows[0].prior_source).toBeTruthy();
    expect(rows[0].team).toBe('NEW');
  });

  /**
   * The distribution has to be stored as probabilities, not raw simulation
   * counts: the point of writing it down in August is that RPS can be computed
   * against it in May without re-running anything. If it were stored as counts,
   * scoring would silently depend on the simulation count used at publish time.
   */
  it('normalises the position distribution to probabilities', () => {
    const rows = buildProjectionRows([result('NEW', flat20)]);
    const dist = rows[0].position_distribution;
    expect(dist).toHaveLength(20);
    expect(dist.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 6);
    for (const p of dist) expect(p).toBeCloseTo(0.05, 6);
  });

  it('produces a distribution that can be scored directly', () => {
    const counts = new Array(20).fill(0);
    counts[6] = 8000;
    counts[7] = 2000;
    const rows = buildProjectionRows([result('NEW', counts)]);
    // 80% on 7th, 20% on 8th. Finishing 7th should score very well.
    const score = rankedProbabilityScore(rows[0].position_distribution, 7);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.01);
    expect(rankedProbabilityScore(rows[0].position_distribution, 20)).toBeGreaterThan(score * 50);
  });

  it('handles an all-zero distribution without producing NaN', () => {
    const rows = buildProjectionRows([result('NEW', new Array(20).fill(0))]);
    for (const p of rows[0].position_distribution) expect(p).toBe(0);
  });

  it('rounds the stored numbers rather than writing full float noise', () => {
    const rows = buildProjectionRows([result('NEW', flat20)]);
    expect(rows[0].avg_points).toBe(55.123);
    expect(rows[0].avg_position).toBe(8.568);
  });

  it('allows a different model version without touching the published one', () => {
    const rows = buildProjectionRows([result('NEW', flat20)], { modelVersion: 'experiment-x' });
    expect(rows[0].model_version).toBe('experiment-x');
  });

  /**
   * There must be no way to overwrite a published projection. This asserts the
   * module's surface, because the guarantee is enforced by absence — an upsert
   * helper added later would silently remove it.
   */
  it('exposes no upsert or update path', async () => {
    const mod = await import('@/lib/ledger/projections');
    const names = Object.keys(mod).join(' ').toLowerCase();
    expect(names).not.toContain('upsert');
    expect(names).not.toContain('update');
    expect(names).not.toContain('overwrite');
    expect(names).not.toContain('delete');
  });
});

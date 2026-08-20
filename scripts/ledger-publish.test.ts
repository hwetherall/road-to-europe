import { describe, expect, it } from 'vitest';
import { loadEnvConfig } from '@next/env';

/**
 * `npm run ledger:publish` — generate and lock the preseason projection.
 *
 * Run once. A second run is refused by the unique constraint on the table, which
 * is the intended behaviour and is reported rather than treated as success.
 *
 * Skipped in the normal suite: it needs the network, live credentials, and it
 * writes an immutable row.
 */
const ENABLED = !!process.env.LEDGER_PUBLISH;

describe.skipIf(!ENABLED)('ledger:publish', () => {
  it('publishes the preseason projection', async () => {
    loadEnvConfig(process.cwd(), true);
    const { getLiveSnapshot } = await import('@/lib/live-data');
    const { simulate } = await import('@/lib/montecarlo');
    const { buildProjectionRows, publishProjections, MODEL_VERSION } = await import(
      '@/lib/ledger/projections'
    );
    const { SENSITIVITY_SEED } = await import('@/lib/sensitivity');

    const snap = await getLiveSnapshot();
    console.log(
      `standings=${snap.standingsSource} fixtures=${snap.fixturesSource} ` +
        `teams=${snap.teams.length} fixtures=${snap.fixtures.length}`
    );

    // Refuse to publish a track record from fallback data. This is the whole
    // failure mode the season-start work existed to close.
    expect(snap.standingsSource).toBe('live');
    expect(snap.fixturesSource).toBe('live');
    expect(snap.teams.length).toBe(20);

    const played = snap.teams.reduce((sum, t) => sum + t.played, 0);
    console.log(`total matches played across the league: ${played}`);
    expect(played).toBe(0); // preseason means preseason

    // 100,000 simulations: this is written once and never recomputed, so it is
    // worth paying for a tighter distribution than the dashboard can afford.
    const SIMS = 100000;
    const started = Date.now();
    const results = simulate(snap.teams, snap.fixtures, SIMS, SENSITIVITY_SEED);
    console.log(`simulated ${SIMS.toLocaleString()} seasons in ${Date.now() - started}ms`);

    const rows = buildProjectionRows(results);
    expect(rows.length).toBe(20);

    // Sanity before locking: the table must not be flat, and probabilities must
    // be coherent. A published projection is not revisable, so these checks are
    // the last chance to catch a broken run.
    const titles = rows.map((r) => r.champion_pct);
    expect(Math.max(...titles)).toBeGreaterThan(25);
    expect(titles.reduce((s, t) => s + t, 0)).toBeCloseTo(100, 0);
    expect(rows.reduce((s, r) => s + r.relegation_pct, 0)).toBeCloseTo(300, 0);
    for (const r of rows) {
      expect(r.top4_pct).toBeLessThanOrEqual(r.top7_pct + 1e-6);
      expect(r.champion_pct).toBeLessThanOrEqual(r.top4_pct + 1e-6);
      expect(r.position_distribution.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 4);
    }

    const ordered = [...rows].sort((a, b) => a.avg_position - b.avg_position);
    console.log('\nprojected table:');
    for (const [i, r] of ordered.entries()) {
      console.log(
        `${String(i + 1).padStart(3)} ${r.team.padEnd(5)} ${r.avg_points.toFixed(1).padStart(5)}pts  ` +
          `title ${r.champion_pct.toFixed(1).padStart(5)}%  top4 ${r.top4_pct.toFixed(1).padStart(5)}%  ` +
          `top7 ${r.top7_pct.toFixed(1).padStart(5)}%  releg ${r.relegation_pct.toFixed(1).padStart(5)}%`
      );
    }

    const result = await publishProjections(rows);
    console.log(`\npublish: ok=${result.ok} rows=${result.rows} — ${result.detail}`);
    if (result.alreadyPublished) {
      console.log(`already published for model ${MODEL_VERSION}; nothing was overwritten`);
    }
    expect(result.ok || result.alreadyPublished).toBe(true);
  }, 600000);
});

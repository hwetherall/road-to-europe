import { describe, expect, it } from 'vitest';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), true);

import { fetchKalshiSeasonMarkets } from '@/lib/odds/kalshi';
import { getLiveSnapshot } from '@/lib/live-data';
import { simulate } from '@/lib/montecarlo';
import { PRESEASON_PRIORS, REGRESSION_RETAIN, priorElo, priorFor } from '@/lib/ratings/priors';
import { CLUB_ABBRS, clubByAbbr } from '@/lib/clubs';

/**
 * `npm run priors:check` — model against market, for all twenty clubs.
 *
 * This is the artifact Step 2 of the spec exists to produce: something to read
 * before locking the Preseason Ledger, showing where Keepwatch and the betting
 * market disagree and by how much. A large disagreement means one of three
 * things, and which one matters:
 *
 *   1. The prior is wrong — a promoted club, a big summer, a new manager. This
 *      is the likeliest at Matchday 0 and the only one worth acting on today.
 *   2. The engine is wrong — ratings are fine but the simulation is not turning
 *      them into the right distribution. Goal difference not depending on who is
 *      playing is the known culprit. Note it, do not fix it here.
 *   3. We genuinely disagree with the market. Legitimate and interesting, but
 *      with a carryover prior and no fitted parameters it is the least likely.
 *
 * Skipped in the normal suite because it needs the network and live credentials.
 */
const ENABLED = !!process.env.PRIORS_CHECK;

const fmt = (n: number | null | undefined, w = 6, dp = 1) =>
  (n === null || n === undefined ? '-' : n.toFixed(dp)).padStart(w);

describe.skipIf(!ENABLED)('priors:check', () => {
  it('compares the model against the market', async () => {
    const [snapshots, snap] = await Promise.all([
      fetchKalshiSeasonMarkets(),
      getLiveSnapshot(),
    ]);

    console.log('\n════ MARKETS ════');
    for (const s of snapshots) {
      console.log(
        `${s.seriesTicker.padEnd(18)} ${String(s.marketType).padEnd(20)} ` +
          `quotes ${String(s.quotes.length).padStart(3)}  usable ${String(s.usableQuotes).padStart(3)}  ` +
          `rawSum ${s.rawSum.toFixed(3)} -> ${s.normalisedTo ?? 'not normalised'}`
      );
      for (const note of s.notes) console.log(`    note: ${note}`);
    }

    const title = snapshots.find((s) => s.marketType === 'outright_winner')?.probabilities ?? {};
    const releg = snapshots.find((s) => s.marketType === 'outright_relegation')?.probabilities ?? {};

    console.log('\n════ MODEL vs MARKET ════');
    console.log(`priors generated with REGRESSION_RETAIN = ${REGRESSION_RETAIN}`);

    const res = simulate(snap.teams, snap.fixtures, 20000, 20260821);
    const byTeam = new Map(res.map((r) => [r.team, r]));

    const rows = CLUB_ABBRS.map((abbr) => {
      const r = byTeam.get(abbr);
      const mTitle = title[abbr] !== undefined ? title[abbr] * 100 : null;
      const mReleg = releg[abbr] !== undefined ? releg[abbr] * 100 : null;
      return {
        abbr,
        name: clubByAbbr(abbr)?.name ?? abbr,
        elo: priorElo(abbr),
        from: priorFor(abbr)?.from,
        title: r?.championPct ?? null,
        releg: r?.relegationPct ?? null,
        pts: r?.avgPoints ?? null,
        mTitle,
        mReleg,
        dTitle: mTitle !== null && r ? r.championPct - mTitle : null,
        dReleg: mReleg !== null && r ? r.relegationPct - mReleg : null,
      };
    }).sort((a, b) => b.elo - a.elo);

    console.log(
      'club  elo   src  avgPts | title: model market delta | relegation: model market delta'
    );
    for (const r of rows) {
      console.log(
        `${r.abbr.padEnd(5)}${String(r.elo).padStart(5)}  ${r.from === 'market_relegation' ? 'MKT' : 'car'} ` +
          `${fmt(r.pts)} |${fmt(r.title)}${fmt(r.mTitle)}${fmt(r.dTitle, 7)} |` +
          `${fmt(r.releg)}${fmt(r.mReleg)}${fmt(r.dReleg, 7)}`
      );
    }

    const relDeltas = rows.filter((r) => r.dReleg !== null);
    const relMae = relDeltas.reduce((s, r) => s + Math.abs(r.dReleg as number), 0) / relDeltas.length;
    console.log(`\nrelegation MAE across ${relDeltas.length} quoted clubs: ${relMae.toFixed(2)}pp`);

    console.log('\n════ DISAGREEMENTS WORTH A DECISION (|delta| > 5pp) ════');
    const flagged = rows
      .map((r) => ({
        abbr: r.abbr,
        name: r.name,
        metric: Math.abs(r.dReleg ?? 0) >= Math.abs(r.dTitle ?? 0) ? 'relegation' : 'title',
        delta: Math.abs(r.dReleg ?? 0) >= Math.abs(r.dTitle ?? 0) ? r.dReleg : r.dTitle,
      }))
      .filter((r) => r.delta !== null && Math.abs(r.delta) > 5)
      .sort((a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number));

    if (flagged.length === 0) {
      console.log('  none');
    } else {
      for (const f of flagged) {
        const dir = (f.delta as number) > 0 ? 'model MORE' : 'model LESS';
        console.log(
          `  ${f.name.padEnd(15)} ${f.metric.padEnd(11)} ${dir} than market by ` +
            `${Math.abs(f.delta as number).toFixed(1)}pp`
        );
      }
      console.log(
        '\n  At Matchday 0 assume explanation (1) first: the prior is missing something\n' +
          '  the market can see. Adjust in lib/ratings/priors.ts with a // reason: comment,\n' +
          '  or leave it and let the Ledger score the disagreement.'
      );
    }

    // The promoted clubs were fitted to this market, so they are the check that
    // the fit has not silently drifted from the prices it was fitted to.
    for (const abbr of CLUB_ABBRS) {
      if (priorFor(abbr)?.from !== 'market_relegation') continue;
      const row = rows.find((r) => r.abbr === abbr);
      if (row?.dReleg === null || row?.dReleg === undefined) continue;
      expect(Math.abs(row.dReleg), `${abbr} has drifted from its fitted market price`).toBeLessThan(6);
    }

    expect(Object.keys(PRESEASON_PRIORS).length).toBe(CLUB_ABBRS.length);
  }, 300000);
});

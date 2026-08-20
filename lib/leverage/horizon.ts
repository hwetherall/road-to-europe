import { Fixture, SensitivityMetric, Team } from '../types';
import { LeverageCandidate, LockResult, pairedLeverageScan } from './paired-scan';

/**
 * Horizon-scaled leverage.
 *
 * At 38 rounds remaining no single fixture decides much, but a cluster can.
 * The unit of analysis should scale with the horizon: months in August,
 * matchdays by Christmas, fixtures by March.
 *
 * Note this is an EDITORIAL choice, not a workaround for noise. The paired
 * engine measures a single August fixture with a ~0.24pp floor at 5,000 sims,
 * which is below the 0.2-0.4pp a fixture is actually worth, so fixture-level
 * leverage stays available and honest all season. Month windows are here
 * because "Newcastle's season is decided in a five-week window from late
 * October" is a truer and more interesting thing to say in August than a
 * ranked list of 380 fixtures — not because the fixtures are unmeasurable.
 */
export type LeverageUnit = 'fixture' | 'matchday' | 'month';

export function selectLeverageUnit(roundsRemaining: number): LeverageUnit {
  if (roundsRemaining <= 12) return 'fixture';
  if (roundsRemaining <= 25) return 'matchday';
  return 'month';
}

export interface LeverageWindow {
  id: string;
  /** Human label: "October 2026", "Matchday 12". */
  label: string;
  unit: LeverageUnit;
  /** The bundle to hand to pairedLeverageScan. */
  candidate: LeverageCandidate;
  fixtureCount: number;
  matchdays: number[];
}

/**
 * The clubs whose results move the same race as the target: its nearest
 * neighbours in the table. Ties in the table are broken the EPL way.
 */
export function nearestRivals(teams: Team[], targetTeam: string, count: number): string[] {
  const sorted = [...teams].sort(
    (a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor
  );
  const index = sorted.findIndex((t) => t.abbr === targetTeam);
  if (index < 0) return [];

  // Walk outward from the target's position, taking the closest clubs first.
  const rivals: string[] = [];
  for (let step = 1; rivals.length < count && step < sorted.length; step++) {
    for (const candidate of [sorted[index - step], sorted[index + step]]) {
      if (candidate && rivals.length < count) rivals.push(candidate.abbr);
    }
  }
  return rivals;
}

/**
 * The result in `fixture` that helps `targetTeam` most.
 *
 * The target winning its own match; a rival dropping points otherwise. When
 * two rivals meet, a draw is better for the target than either winning — it
 * puts two points into the race instead of three.
 */
export function bestCaseResult(
  fixture: Fixture,
  targetTeam: string,
  rivals: Set<string>
): LockResult | null {
  const homeIsTarget = fixture.homeTeam === targetTeam;
  const awayIsTarget = fixture.awayTeam === targetTeam;
  if (homeIsTarget) return 'home';
  if (awayIsTarget) return 'away';

  const homeIsRival = rivals.has(fixture.homeTeam);
  const awayIsRival = rivals.has(fixture.awayTeam);
  if (homeIsRival && awayIsRival) return 'draw';
  if (homeIsRival) return 'away';
  if (awayIsRival) return 'home';
  return null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthKey(fixture: Fixture): { key: string; label: string } | null {
  if (!fixture.date) return null;
  const date = new Date(fixture.date);
  if (Number.isNaN(date.getTime())) return null;
  return {
    key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
    label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
  };
}

/**
 * Group the remaining schedule into windows and, for each, bundle every fixture
 * involving the target or a close rival at its best-case result for the target.
 * The resulting aggregate swing is what "this window decides your season" means.
 */
export function buildLeverageWindows(params: {
  teams: Team[];
  fixtures: Fixture[];
  targetTeam: string;
  unit: LeverageUnit;
  rivalCount?: number;
}): LeverageWindow[] {
  const { teams, fixtures, targetTeam, unit } = params;
  const rivalCount = params.rivalCount ?? 6;

  if (unit === 'fixture') return [];

  const rivals = new Set(nearestRivals(teams, targetTeam, rivalCount));
  const scheduled = fixtures.filter((f) => f.status === 'SCHEDULED');

  const groups = new Map<
    string,
    { label: string; locks: LeverageCandidate['locks']; matchdays: Set<number> }
  >();

  for (const fixture of scheduled) {
    const result = bestCaseResult(fixture, targetTeam, rivals);
    if (!result) continue;

    let key: string;
    let label: string;
    if (unit === 'matchday') {
      if (!Number.isFinite(fixture.matchday)) continue;
      key = `md-${fixture.matchday}`;
      label = `Matchday ${fixture.matchday}`;
    } else {
      const month = monthKey(fixture);
      // A fixture with no usable date cannot be placed in a calendar window.
      if (!month) continue;
      key = `month-${month.key}`;
      label = month.label;
    }

    const group = groups.get(key) ?? { label, locks: [], matchdays: new Set<number>() };
    group.locks.push({ fixtureId: fixture.id, result });
    if (Number.isFinite(fixture.matchday)) group.matchdays.add(fixture.matchday);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([id, group]) => ({
      id,
      label: group.label,
      unit,
      candidate: { id, locks: group.locks },
      fixtureCount: group.locks.length,
      matchdays: [...group.matchdays].sort((a, b) => a - b),
    }))
    .sort((a, b) => (a.matchdays[0] ?? 0) - (b.matchdays[0] ?? 0));
}

export interface ScoredLeverageWindow extends LeverageWindow {
  deltaPp: number;
  sePp: number;
  noiseFloorPp: number;
  belowNoiseFloor: boolean;
}

/** Rounds still to be played, from the earliest scheduled matchday. */
export function roundsRemaining(fixtures: Fixture[], totalMatchdays = 38): number {
  const scheduled = fixtures
    .filter((f) => f.status === 'SCHEDULED' && Number.isFinite(f.matchday))
    .map((f) => f.matchday);
  if (scheduled.length === 0) return 0;
  return totalMatchdays - Math.min(...scheduled) + 1;
}

/**
 * Build the windows for this horizon and measure each one's aggregate swing,
 * strongest first. Windows below their own noise floor are kept but flagged, so
 * a caller can show "this window is not distinguishable yet" rather than
 * silently dropping a month from the calendar.
 */
export function scoreLeverageWindows(params: {
  teams: Team[];
  fixtures: Fixture[];
  targetTeam: string;
  metric: SensitivityMetric;
  unit: LeverageUnit;
  numSims: number;
  seed: number;
  rivalCount?: number;
}): ScoredLeverageWindow[] {
  const windows = buildLeverageWindows(params);
  if (windows.length === 0) return [];

  const scan = pairedLeverageScan({
    teams: params.teams,
    fixtures: params.fixtures,
    targetTeam: params.targetTeam,
    metric: params.metric,
    candidates: windows.map((w) => w.candidate),
    numSims: params.numSims,
    seed: params.seed,
  });

  const byId = new Map(scan.results.map((r) => [r.candidateId, r]));

  return windows
    .map((window) => {
      const scored = byId.get(window.id);
      return {
        ...window,
        deltaPp: scored?.deltaPp ?? 0,
        sePp: scored?.sePp ?? 0,
        noiseFloorPp: scored?.noiseFloorPp ?? 0,
        belowNoiseFloor: scored?.belowNoiseFloor ?? true,
      };
    })
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));
}

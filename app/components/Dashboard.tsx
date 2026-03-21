'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Team, Fixture, SimulationResult, SensitivityResult, TeamContext } from '@/lib/types';
import { HARDCODED_STANDINGS, KNOWN_FIXTURES, ODDS_API_NAME_MAP } from '@/lib/constants';
import { generateRemainingFixtures } from '@/lib/fixture-generator';
import { simulate } from '@/lib/montecarlo';
import { sensitivityScan } from '@/lib/sensitivity';
import { getTeamContext } from '@/lib/team-context';
import { getTeamColour, getTeamTextColour } from '@/lib/team-colours';
import { teamElo, eloProb } from '@/lib/elo';
import TeamSelector from './TeamSelector';
import QualificationCards from './QualificationCards';
import PositionHistogram from './PositionHistogram';
import SensitivityChart from './SensitivityChart';
import WhatIfPanel from './WhatIfPanel';
import WhatIfComparison from './WhatIfComparison';
import FixtureList from './FixtureList';
import StandingsTable from './StandingsTable';
import LeagueProjections from './LeagueProjections';
import RefreshButton from './RefreshButton';

const SIM_COUNT = 10000;
const SENSITIVITY_SIMS = 1000;

function getInitialTeam(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    return params.get('team') ?? 'NEW';
  }
  return 'NEW';
}

export default function Dashboard() {
  const [teams, setTeams] = useState<Team[]>(HARDCODED_STANDINGS);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>(getInitialTeam);
  const [simResults, setSimResults] = useState<SimulationResult[] | null>(null);
  const [sensitivityResults, setSensitivityResults] = useState<SensitivityResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [dataSource, setDataSource] = useState<string>('');

  // What-If state
  const [whatIfActive, setWhatIfActive] = useState(false);
  const [locks, setLocks] = useState<Record<string, 'home' | 'draw' | 'away'>>({});
  const [baseSimResult, setBaseSimResult] = useState<SimulationResult | null>(null);
  const [whatIfSimResult, setWhatIfSimResult] = useState<SimulationResult | null>(null);
  const whatIfTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const whatIfPanelRef = useRef<HTMLDivElement | null>(null);

  const allFixtures = useMemo(() => {
    if (fixtures.length > 0) return fixtures;
    const generated = generateRemainingFixtures(HARDCODED_STANDINGS, KNOWN_FIXTURES);
    return [...KNOWN_FIXTURES, ...generated];
  }, [fixtures]);

  const teamResult = useMemo(
    () => simResults?.find((r) => r.team === selectedTeam) ?? null,
    [simResults, selectedTeam]
  );

  const teamContext: TeamContext | null = useMemo(() => {
    const team = teams.find((t) => t.abbr === selectedTeam);
    if (!team) return null;
    const result = whatIfSimResult ?? teamResult ?? undefined;
    return getTeamContext(team, teams, result);
  }, [teams, selectedTeam, teamResult, whatIfSimResult]);

  const accentColor = getTeamColour(selectedTeam);
  const textColor = getTeamTextColour(selectedTeam);

  // URL state sync
  const handleSelectTeam = useCallback((abbr: string) => {
    setSelectedTeam(abbr);
    const url = new URL(window.location.href);
    url.searchParams.set('team', abbr);
    window.history.replaceState({}, '', url.toString());
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [standingsRes, fixturesRes, oddsRes] = await Promise.all([
        fetch('/api/standings'),
        fetch('/api/fixtures'),
        fetch('/api/odds'),
      ]);

      let nextTeams = teams;

      if (standingsRes.ok) {
        const standingsData = await standingsRes.json();
        if (standingsData.teams?.length > 0) {
          nextTeams = standingsData.teams;
          setTeams(nextTeams);
          setDataSource(standingsData.source);
        }
      }

      // Parse live odds into a lookup by "homeAbbr-awayAbbr"
      type OddsEntry = { homeTeam: string; awayTeam: string; date: string; homeWin: number; draw: number; awayWin: number };
      const oddsLookup = new Map<string, OddsEntry>();
      if (oddsRes.ok) {
        const oddsData = await oddsRes.json();
        if (oddsData.odds?.length > 0) {
          for (const o of oddsData.odds as OddsEntry[]) {
            const homeAbbr = ODDS_API_NAME_MAP[o.homeTeam];
            const awayAbbr = ODDS_API_NAME_MAP[o.awayTeam];
            if (homeAbbr && awayAbbr) {
              oddsLookup.set(`${homeAbbr}-${awayAbbr}`, o);
            }
          }
        }
      }

      if (fixturesRes.ok) {
        const fixturesData = await fixturesRes.json();
        if (fixturesData.fixtures?.length > 0) {
          const known = fixturesData.fixtures.map((fixture: Fixture) => {
            // Finished fixtures don't need probabilities — keep as-is
            if (fixture.status === 'FINISHED') return fixture;

            // Try to match with live odds first
            const oddsKey = `${fixture.homeTeam}-${fixture.awayTeam}`;
            const liveOdds = oddsLookup.get(oddsKey);
            if (liveOdds && liveOdds.homeWin > 0) {
              return {
                ...fixture,
                homeWinProb: liveOdds.homeWin,
                drawProb: liveOdds.draw,
                awayWinProb: liveOdds.awayWin,
                probSource: 'odds_api' as const,
              };
            }

            // If fixture already has probabilities (e.g. from hardcoded data), keep them
            if (
              fixture.homeWinProb !== undefined &&
              fixture.drawProb !== undefined &&
              fixture.awayWinProb !== undefined
            ) {
              return fixture;
            }

            // Fall back to Elo estimation
            const homeTeam = nextTeams.find((t) => t.abbr === fixture.homeTeam);
            const awayTeam = nextTeams.find((t) => t.abbr === fixture.awayTeam);
            if (!homeTeam || !awayTeam) return fixture;

            const probs = eloProb(teamElo(homeTeam), teamElo(awayTeam));
            return {
              ...fixture,
              homeWinProb: probs.homeWin,
              drawProb: probs.draw,
              awayWinProb: probs.awayWin,
              probSource: 'elo_estimated' as const,
            };
          });

          const generated = generateRemainingFixtures(nextTeams, known);
          setFixtures([...known, ...generated]);
        }
      }
    } catch {
      setDataSource('hardcoded');
    }
  }, [teams]);

  const runSimulation = useCallback(() => {
    setRunning(true);
    setPhase('Running base simulation...');

    setTimeout(() => {
      const results = simulate(teams, allFixtures, SIM_COUNT);
      setSimResults(results);

      // Store base result for what-if comparison
      const baseResult = results.find((r) => r.team === selectedTeam) ?? null;
      setBaseSimResult(baseResult);

      setPhase('Running sensitivity analysis...');

      setTimeout(() => {
        const sensitivity = sensitivityScan(
          teams,
          allFixtures,
          selectedTeam,
          SENSITIVITY_SIMS
        );
        setSensitivityResults(sensitivity);
        setRunning(false);
        setPhase('');
      }, 50);
    }, 50);
  }, [teams, allFixtures, selectedTeam]);

  // What-if re-simulation (debounced)
  const runWhatIfSim = useCallback(() => {
    if (whatIfTimerRef.current) clearTimeout(whatIfTimerRef.current);

    const lockCount = Object.keys(locks).length;
    if (lockCount === 0) {
      setWhatIfSimResult(null);
      return;
    }

    whatIfTimerRef.current = setTimeout(() => {
      // Apply locks to fixtures
      const lockedFixtures = allFixtures.map((f) => {
        const lock = locks[f.id];
        if (!lock) return f;
        return {
          ...f,
          homeWinProb: lock === 'home' ? 1.0 : 0.0,
          drawProb: lock === 'draw' ? 1.0 : 0.0,
          awayWinProb: lock === 'away' ? 1.0 : 0.0,
        };
      });

      const results = simulate(teams, lockedFixtures, SIM_COUNT);
      const result = results.find((r) => r.team === selectedTeam) ?? null;
      setWhatIfSimResult(result);
    }, 300);
  }, [locks, allFixtures, teams, selectedTeam]);

  useEffect(() => {
    if (whatIfActive) runWhatIfSim();
  }, [locks, whatIfActive, runWhatIfSim]);

  // Bring What-If controls into view when enabled.
  useEffect(() => {
    if (!whatIfActive) return;
    const id = window.setTimeout(() => {
      whatIfPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(id);
  }, [whatIfActive]);

  // Auto-fetch + simulate on mount
  useEffect(() => {
    fetchData().then(() => {
      setTimeout(() => {
        setRunning(true);
        setPhase('Running base simulation...');
        setTimeout(() => {
          const initFixtures = [...KNOWN_FIXTURES, ...generateRemainingFixtures(HARDCODED_STANDINGS, KNOWN_FIXTURES)];
          const results = simulate(HARDCODED_STANDINGS, initFixtures, SIM_COUNT);
          setSimResults(results);

          const initTeam = getInitialTeam();
          const baseResult = results.find((r) => r.team === initTeam) ?? null;
          setBaseSimResult(baseResult);

          setPhase('Running sensitivity analysis...');
          setTimeout(() => {
            const sensitivity = sensitivityScan(HARDCODED_STANDINGS, initFixtures, initTeam, SENSITIVITY_SIMS);
            setSensitivityResults(sensitivity);
            setRunning(false);
            setPhase('');
          }, 50);
        }, 50);
      }, 100);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When team changes, re-run sensitivity (sim results are already for all teams)
  useEffect(() => {
    if (!simResults || running) return;

    // Update base result for what-if
    const baseResult = simResults.find((r) => r.team === selectedTeam) ?? null;
    setBaseSimResult(baseResult);

    // Re-run sensitivity for new team
    setPhase('Updating sensitivity...');
    setTimeout(() => {
      const sensitivity = sensitivityScan(
        teams,
        allFixtures,
        selectedTeam,
        SENSITIVITY_SIMS
      );
      setSensitivityResults(sensitivity);
      setPhase('');

      // Re-run what-if if active
      if (whatIfActive && Object.keys(locks).length > 0) {
        runWhatIfSim();
      }
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeam]);

  const handleToggleLock = useCallback((fixtureId: string, result: 'home' | 'draw' | 'away') => {
    setLocks((prev) => {
      const next = { ...prev };
      if (next[fixtureId] === result) {
        delete next[fixtureId];
      } else {
        next[fixtureId] = result;
      }
      return next;
    });
  }, []);

  const handleResetLocks = useCallback(() => {
    setLocks({});
    setWhatIfSimResult(null);
  }, []);

  // Find selected team data
  const sortedTeams = [...teams].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });
  const currentTeam = teams.find((t) => t.abbr === selectedTeam);
  const teamPosition = sortedTeams.findIndex((t) => t.abbr === selectedTeam) + 1;
  const gamesRemaining = currentTeam ? 38 - currentTeam.played : 0;

  // Display result: what-if overrides base when active
  const displayResult = whatIfSimResult ?? teamResult;
  const lockCount = Object.keys(locks).length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-inter">
      {/* Header */}
      <div
        className="border-b-2 px-6 py-8 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, #000 0%, #1a1a1a 50%, #000 100%)`,
          borderBottomColor: `${accentColor}30`,
        }}
      >
        <div
          className="absolute -top-10 -right-10 w-[200px] h-[200px]"
          style={{
            background: `radial-gradient(circle, ${accentColor}15 0%, transparent 70%)`,
          }}
        />
        <div className="max-w-[900px] mx-auto">
          <div className="flex items-center gap-3 mb-1.5">
            <div
              className="w-10 h-10 rounded-lg border-2 flex items-center justify-center font-oswald font-bold text-xs"
              style={{
                borderColor: `${accentColor}60`,
                background: `linear-gradient(135deg, ${accentColor}cc, ${accentColor}40)`,
                color: '#fff',
              }}
            >
              {selectedTeam}
            </div>
            <div>
              <h1 className="font-oswald text-[22px] font-bold tracking-wider uppercase m-0">
                Keepwatch
              </h1>
              <div className="text-[11px] text-white/40 tracking-[0.15em] uppercase">
                EPL Season Simulator
              </div>
            </div>
          </div>

          <TeamSelector
            teams={teams}
            selectedTeam={selectedTeam}
            onSelectTeam={handleSelectTeam}
          />

          {currentTeam && (
            <div className="flex gap-5 mt-4 text-[13px] flex-wrap">
              <span className="text-white/50">
                <span style={{ color: textColor }} className="font-semibold">{currentTeam.name}</span>
              </span>
              <span className="text-white/50">
                Position:{' '}
                <span className="text-white font-semibold">{teamPosition}{teamPosition === 1 ? 'st' : teamPosition === 2 ? 'nd' : teamPosition === 3 ? 'rd' : 'th'}</span>
              </span>
              <span className="text-white/50">
                Points:{' '}
                <span className="text-white font-semibold">{currentTeam.points}</span>
              </span>
              <span className="text-white/50">
                GD:{' '}
                <span className="text-white font-semibold">
                  {currentTeam.goalDifference > 0 ? '+' : ''}
                  {currentTeam.goalDifference}
                </span>
              </span>
              <span className="text-white/50">
                Remaining:{' '}
                <span className="text-white font-semibold">{gamesRemaining} games</span>
              </span>
              {dataSource && (
                <span className="text-white/30 text-[11px]">
                  Data: {dataSource}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[900px] mx-auto px-4 py-6">
        {/* Toolbar */}
        <div className="flex items-center gap-4 mb-7 flex-wrap">
          <RefreshButton
            onRefresh={runSimulation}
            running={running}
            hasResults={simResults !== null}
            fixtureCount={allFixtures.filter((f) => f.status === 'SCHEDULED').length}
            simCount={SIM_COUNT}
          />
          <button
            onClick={() => {
              setWhatIfActive(!whatIfActive);
              if (whatIfActive) {
                // Turning off — clear what-if result
                setWhatIfSimResult(null);
              }
            }}
            className={`px-5 py-3.5 rounded-lg text-sm font-bold font-oswald tracking-widest uppercase transition-all border cursor-pointer ${
              whatIfActive
                ? 'text-white border-amber-500/50'
                : 'bg-transparent text-white/50 border-white/[0.12] hover:border-white/20'
            }`}
            style={
              whatIfActive
                ? { background: 'rgba(245,158,11,0.15)' }
                : undefined
            }
          >
            {whatIfActive ? 'Exit What-If' : 'What-If Mode'}
          </button>
        </div>

        {running && phase && (
          <div className="mb-6 text-sm flex items-center gap-2" style={{ color: `${accentColor}aa` }}>
            <div
              className="w-4 h-4 border-2 rounded-full animate-spin"
              style={{ borderColor: `${accentColor}33`, borderTopColor: accentColor }}
            />
            {phase}
          </div>
        )}

        {/* What-If Panel */}
        {whatIfActive && (
          <div ref={whatIfPanelRef}>
            <WhatIfPanel
              fixtures={allFixtures}
              locks={locks}
              onToggleLock={handleToggleLock}
              onResetAll={handleResetLocks}
              selectedTeam={selectedTeam}
              sensitivityResults={sensitivityResults}
              teams={teams}
            />
          </div>
        )}

        {/* What-If Comparison Strip */}
        {whatIfActive && baseSimResult && whatIfSimResult && teamContext && lockCount > 0 && (
          <WhatIfComparison
            baseResult={baseSimResult}
            whatIfResult={whatIfSimResult}
            teamContext={teamContext}
            lockCount={lockCount}
          />
        )}

        {/* Qualification Cards */}
        {displayResult && teamContext && (
          <QualificationCards result={displayResult} cards={teamContext.relevantCards} />
        )}

        {/* Position Histogram */}
        {displayResult && (
          <PositionHistogram
            result={displayResult}
            accentColor={accentColor}
            numSims={SIM_COUNT}
          />
        )}

        {/* Sensitivity Chart */}
        {sensitivityResults && sensitivityResults.length > 0 && (
          <SensitivityChart results={sensitivityResults} selectedTeam={selectedTeam} teams={teams} />
        )}

        {/* League Projections */}
        {simResults && (
          <LeagueProjections
            results={simResults}
            selectedTeam={selectedTeam}
            accentColor={accentColor}
            teams={teams}
          />
        )}

        {/* Fixture List */}
        <FixtureList
          fixtures={allFixtures}
          selectedTeam={selectedTeam}
          teams={teams}
          accentColor={accentColor}
        />

        {/* Standings */}
        <StandingsTable teams={teams} selectedTeam={selectedTeam} accentColor={accentColor} />

        {/* Methodology */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 mb-8 text-xs text-white/40 leading-7">
          <div className="font-oswald text-[13px] tracking-widest uppercase text-white/50 mb-2">
            Methodology
          </div>
          Monte Carlo simulation of {SIM_COUNT.toLocaleString()} season outcomes.
          Match probabilities sourced from bookmaker odds where available, and
          estimated from Elo ratings (derived from points-per-game) with home
          advantage adjustment for remaining fixtures. Each simulation randomly
          resolves all remaining matches using Poisson-distributed goal sampling,
          calculates final standings, and records finishing positions.
          <br />
          <br />
          <strong className="text-white/50">Sensitivity analysis</strong> locks each
          fixture to every possible result (home win / draw / away win) and re-runs
          1,000 simulations per lock to measure the impact on the selected team&apos;s
          qualification odds.
          <br />
          <br />
          <strong className="text-white/50">What-If mode</strong> lets you manually lock
          fixture outcomes and see how they affect the selected team&apos;s odds in real
          time. Lock any fixture — not just the selected team&apos;s — since a
          rival&apos;s loss can matter more than your team&apos;s win.
          <div className="mt-3 text-white/25 italic">
            Standings as of March 21, 2026. European places assume standard
            allocation (no cup winners adjustments).
          </div>
        </div>
      </div>
    </div>
  );
}

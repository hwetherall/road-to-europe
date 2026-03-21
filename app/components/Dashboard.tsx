'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Team, Fixture, SimulationResult, SensitivityResult } from '@/lib/types';
import { HARDCODED_STANDINGS, KNOWN_FIXTURES, TARGET_TEAM } from '@/lib/constants';
import { generateRemainingFixtures } from '@/lib/fixture-generator';
import { simulate } from '@/lib/montecarlo';
import { sensitivityScan } from '@/lib/sensitivity';
import QualificationCards from './QualificationCards';
import SensitivityChart from './SensitivityChart';
import FixtureList from './FixtureList';
import StandingsTable from './StandingsTable';
import LeagueProjections from './LeagueProjections';
import RefreshButton from './RefreshButton';

const SIM_COUNT = 10000;
const SENSITIVITY_SIMS = 1000;

export default function Dashboard() {
  const [teams, setTeams] = useState<Team[]>(HARDCODED_STANDINGS);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [simResults, setSimResults] = useState<SimulationResult[] | null>(null);
  const [sensitivityResults, setSensitivityResults] = useState<SensitivityResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [dataSource, setDataSource] = useState<string>('');

  const allFixtures = useMemo(() => {
    if (fixtures.length > 0) return fixtures;
    const generated = generateRemainingFixtures(HARDCODED_STANDINGS, KNOWN_FIXTURES);
    return [...KNOWN_FIXTURES, ...generated];
  }, [fixtures]);

  const newcastleResult = useMemo(
    () => simResults?.find((r) => r.team === TARGET_TEAM) ?? null,
    [simResults]
  );

  const fetchData = useCallback(async () => {
    try {
      const [standingsRes, fixturesRes] = await Promise.all([
        fetch('/api/standings'),
        fetch('/api/fixtures'),
      ]);

      if (standingsRes.ok) {
        const standingsData = await standingsRes.json();
        if (standingsData.teams?.length > 0) {
          setTeams(standingsData.teams);
          setDataSource(standingsData.source);
        }
      }

      if (fixturesRes.ok) {
        const fixturesData = await fixturesRes.json();
        if (fixturesData.fixtures?.length > 0) {
          // Merge with generated fixtures for full season
          const known = fixturesData.fixtures;
          const generated = generateRemainingFixtures(teams, known);
          setFixtures([...known, ...generated]);
        }
      }
    } catch {
      // Use hardcoded data
      setDataSource('hardcoded');
    }
  }, [teams]);

  const runSimulation = useCallback(() => {
    setRunning(true);
    setPhase('Running base simulation...');

    // Use setTimeout to avoid blocking the UI
    setTimeout(() => {
      const results = simulate(teams, allFixtures, SIM_COUNT);
      setSimResults(results);
      setPhase('Running sensitivity analysis...');

      setTimeout(() => {
        const sensitivity = sensitivityScan(
          teams,
          allFixtures,
          TARGET_TEAM,
          SENSITIVITY_SIMS
        );
        setSensitivityResults(sensitivity);
        setRunning(false);
        setPhase('');
      }, 50);
    }, 50);
  }, [teams, allFixtures]);

  // Auto-fetch data and run simulation on mount
  useEffect(() => {
    fetchData().then(() => {
      // Small delay to let state settle
      setTimeout(() => {
        setRunning(true);
        setPhase('Running base simulation...');
        setTimeout(() => {
          const results = simulate(HARDCODED_STANDINGS, [...KNOWN_FIXTURES, ...generateRemainingFixtures(HARDCODED_STANDINGS, KNOWN_FIXTURES)], SIM_COUNT);
          setSimResults(results);
          setPhase('Running sensitivity analysis...');
          setTimeout(() => {
            const allFix = [...KNOWN_FIXTURES, ...generateRemainingFixtures(HARDCODED_STANDINGS, KNOWN_FIXTURES)];
            const sensitivity = sensitivityScan(HARDCODED_STANDINGS, allFix, TARGET_TEAM, SENSITIVITY_SIMS);
            setSensitivityResults(sensitivity);
            setRunning(false);
            setPhase('');
          }, 50);
        }, 50);
      }, 100);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Find Newcastle's current position
  const sortedTeams = [...teams].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });
  const newcastle = teams.find((t) => t.abbr === TARGET_TEAM);
  const newcastlePosition = sortedTeams.findIndex((t) => t.abbr === TARGET_TEAM) + 1;
  const gamesRemaining = newcastle ? 38 - newcastle.played : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-inter">
      {/* Header */}
      <div className="bg-gradient-to-br from-black via-[#1a1a1a] to-black border-b-2 border-white/[0.06] px-6 py-8 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-[200px] h-[200px] bg-[radial-gradient(circle,rgba(0,170,170,0.1)_0%,transparent_70%)]" />
        <div className="max-w-[900px] mx-auto">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="w-10 h-10 rounded-lg border-2 border-white/20 bg-gradient-to-br from-white/90 via-white/50 to-black/90" />
            <div>
              <h1 className="font-oswald text-[22px] font-bold tracking-wider uppercase m-0">
                Newcastle United
              </h1>
              <div className="text-[11px] text-white/40 tracking-[0.15em] uppercase">
                European Qualification Simulator
              </div>
            </div>
          </div>
          <div className="flex gap-5 mt-4 text-[13px]">
            <span className="text-white/50">
              Position:{' '}
              <span className="text-white font-semibold">{newcastlePosition}th</span>
            </span>
            <span className="text-white/50">
              Points:{' '}
              <span className="text-white font-semibold">{newcastle?.points ?? 0}</span>
            </span>
            <span className="text-white/50">
              GD:{' '}
              <span className="text-white font-semibold">
                {(newcastle?.goalDifference ?? 0) > 0 ? '+' : ''}
                {newcastle?.goalDifference ?? 0}
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
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[900px] mx-auto px-4 py-6">
        <RefreshButton
          onRefresh={runSimulation}
          running={running}
          hasResults={simResults !== null}
          fixtureCount={allFixtures.filter((f) => f.status === 'SCHEDULED').length}
          simCount={SIM_COUNT}
        />

        {running && phase && (
          <div className="mb-6 text-sm text-teal-400/70 flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-teal-400/30 border-t-teal-400 rounded-full animate-spin" />
            {phase}
          </div>
        )}

        {newcastleResult && <QualificationCards result={newcastleResult} />}

        {sensitivityResults && sensitivityResults.length > 0 && (
          <SensitivityChart results={sensitivityResults} />
        )}

        {simResults && <LeagueProjections results={simResults} />}

        <FixtureList fixtures={allFixtures} />

        <StandingsTable teams={teams} />

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
          1,000 simulations per lock to measure the impact on Newcastle&apos;s European
          qualification odds.
          <div className="mt-3 text-white/25 italic">
            Standings as of March 21, 2026. European places assume standard
            allocation (no cup winners adjustments).
          </div>
        </div>
      </div>
    </div>
  );
}

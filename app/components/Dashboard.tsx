'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Team,
  Fixture,
  SimulationResult,
  SensitivityResult,
  SensitivityMetric,
  TeamContext,
} from '@/lib/types';
import { Chapter } from '@/lib/chat-types';
import { HARDCODED_STANDINGS, KNOWN_FIXTURES, ODDS_API_NAME_MAP } from '@/lib/constants';
import { generateRemainingFixtures } from '@/lib/fixture-generator';
import { simulate } from '@/lib/montecarlo';
import { sensitivityScan } from '@/lib/sensitivity';
import { getTeamContext } from '@/lib/team-context';
import { getTeamColour, getTeamTextColour } from '@/lib/team-colours';
import { teamElo, eloProb } from '@/lib/elo';
import { applyChapters } from '@/lib/modification-engine';
import {
  addChapter,
  removeChapter,
  toggleChapter,
  resetAllChapters,
  createFixtureLockChapter,
} from '@/lib/chapters';
import { readKyleState, writeKyleState } from '@/lib/kyle';
import TeamSelector from './TeamSelector';
import QualificationCards from './QualificationCards';
import PositionHistogram from './PositionHistogram';
import SensitivityChart from './SensitivityChart';
import WhatIfPanel from './WhatIfPanel';
import ScenarioComparison from './ScenarioComparison';
import ChatSidebar from './ChatSidebar';
import FixtureList from './FixtureList';
import StandingsTable from './StandingsTable';
import LeagueProjections from './LeagueProjections';
import RefreshButton from './RefreshButton';
import KyleToggle from './KyleToggle';
import KyleMiniDashboard from './KyleMiniDashboard';
import DeepAnalysisModal from './DeepAnalysisModal';
import WhatIfAnalysis from './WhatIfAnalysis';

const SIM_COUNT = 10000;
const SENSITIVITY_SIMS = 1000;
const SENSITIVITY_METRIC_LABELS: Record<SensitivityMetric, string> = {
  championPct: 'title odds',
  top4Pct: 'top-4 odds',
  top5Pct: 'top-5 odds',
  top6Pct: 'top-6 odds',
  top7Pct: 'European odds',
  relegationPct: 'relegation risk',
  survivalPct: 'survival odds',
};

interface DashboardProps {
  initialTeam?: string;
}

type DeepDivePreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'disabled' | 'error';
  summary: string;
  keyScenario: string;
  cachedAt: number | null;
  cacheMatchType: 'exact' | 'scenario_fallback' | null;
  targetMetric: string | null;
};

export default function Dashboard({ initialTeam = 'NEW' }: DashboardProps) {
  const [teams, setTeams] = useState<Team[]>(HARDCODED_STANDINGS);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>(initialTeam);
  const [simResults, setSimResults] = useState<SimulationResult[] | null>(null);
  const [sensitivityResults, setSensitivityResults] = useState<SensitivityResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [dataSource, setDataSource] = useState<string>('');

  // What-If state
  const [whatIfActive, setWhatIfActive] = useState(false);
  const whatIfPanelRef = useRef<HTMLDivElement | null>(null);

  // Chapter state (V3A)
  const [scenarioState, setScenarioState] = useState({ chapters: [] as Chapter[] });
  const chapters = scenarioState.chapters;

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Kyle mode state
  const [kyleMode, setKyleMode] = useState<boolean>(() => readKyleState());

  // Deep Analysis modal state
  const [deepAnalysisOpen, setDeepAnalysisOpen] = useState(false);

  // What-If Analysis modal state
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [whatIfTarget, setWhatIfTarget] = useState<{ metric: keyof SimulationResult; label: string } | null>(null);
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [deepDivePreview, setDeepDivePreview] = useState<DeepDivePreviewState>({
    status: 'idle',
    summary: '',
    keyScenario: '',
    cachedAt: null,
    cacheMatchType: null,
    targetMetric: null,
  });

  // Modified simulation results (with chapters applied)
  const [modifiedSimResults, setModifiedSimResults] = useState<SimulationResult[] | null>(null);
  const chapterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allFixtures = useMemo(() => {
    if (fixtures.length > 0) return fixtures;
    const generated = generateRemainingFixtures(HARDCODED_STANDINGS, KNOWN_FIXTURES);
    return [...KNOWN_FIXTURES, ...generated];
  }, [fixtures]);

  // Baseline result for selected team (no chapters)
  const baselineTeamResult = useMemo(
    () => simResults?.find((r) => r.team === selectedTeam) ?? null,
    [simResults, selectedTeam]
  );

  // Modified result for selected team (with chapters)
  const modifiedTeamResult = useMemo(
    () => modifiedSimResults?.find((r) => r.team === selectedTeam) ?? null,
    [modifiedSimResults, selectedTeam]
  );

  // Active display result: modified if chapters exist, baseline otherwise
  const activeChapters = useMemo(
    () => chapters.filter((c) => c.status === 'active'),
    [chapters]
  );
  const hasActiveChapters = activeChapters.length > 0;
  const displayResult = hasActiveChapters ? (modifiedTeamResult ?? baselineTeamResult) : baselineTeamResult;

  const teamContext: TeamContext | null = useMemo(() => {
    const team = teams.find((t) => t.abbr === selectedTeam);
    if (!team) return null;
    const result = displayResult ?? undefined;
    return getTeamContext(team, teams, result);
  }, [teams, selectedTeam, displayResult]);

  const sensitivityMetric: SensitivityMetric = useMemo(
    () => teamContext?.primaryMetric ?? 'top7Pct',
    [teamContext]
  );
  const sensitivityMetricLabel = SENSITIVITY_METRIC_LABELS[sensitivityMetric];

  const accentColor = getTeamColour(selectedTeam);
  const textColor = getTeamTextColour(selectedTeam);

  // Derive locks from chapters for the WhatIfPanel display
  const locks = useMemo(() => {
    const result: Record<string, 'home' | 'draw' | 'away'> = {};
    for (const ch of activeChapters) {
      if (ch.type === 'fixture_lock' && ch.fixtureLock) {
        result[ch.fixtureLock.fixtureId] = ch.fixtureLock.result;
      }
    }
    return result;
  }, [activeChapters]);

  // URL state sync
  const handleSelectTeam = useCallback((abbr: string) => {
    setSelectedTeam(abbr);
    const url = new URL(window.location.href);
    url.searchParams.set('team', abbr);
    window.history.replaceState({}, '', url.toString());
  }, []);

  const fetchData = useCallback(async (): Promise<{ teams: Team[]; fixtures: Fixture[] }> => {
    let nextTeams = teams;
    let nextFixtures: Fixture[] = [];

    try {
      const [standingsRes, fixturesRes, oddsRes] = await Promise.all([
        fetch('/api/standings'),
        fetch('/api/fixtures'),
        fetch('/api/odds'),
      ]);

      if (standingsRes.ok) {
        const standingsData = await standingsRes.json();
        if (standingsData.teams?.length > 0) {
          nextTeams = standingsData.teams;
          setTeams(nextTeams);
          setDataSource(standingsData.source);
        }
      }

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
            if (fixture.status === 'FINISHED') return fixture;

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

            if (
              fixture.homeWinProb !== undefined &&
              fixture.drawProb !== undefined &&
              fixture.awayWinProb !== undefined
            ) {
              return fixture;
            }

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
          nextFixtures = [...known, ...generated];
          setFixtures(nextFixtures);
        }
      }
    } catch {
      setDataSource('hardcoded');
    }

    if (nextFixtures.length === 0) {
      nextFixtures = [...KNOWN_FIXTURES, ...generateRemainingFixtures(nextTeams, KNOWN_FIXTURES)];
      setFixtures(nextFixtures);
    }

    return { teams: nextTeams, fixtures: nextFixtures };
  }, [teams]);

  const runSimulation = useCallback(() => {
    setRunning(true);
    setPhase('Running base simulation...');

    setTimeout(() => {
      const results = simulate(teams, allFixtures, SIM_COUNT);
      setSimResults(results);

      setPhase('Running sensitivity analysis...');

      setTimeout(() => {
        const sensitivity = sensitivityScan(
          teams,
          allFixtures,
          selectedTeam,
          SENSITIVITY_SIMS,
          sensitivityMetric
        );
        setSensitivityResults(sensitivity);
        setRunning(false);
        setPhase('');
      }, 50);
    }, 50);
  }, [teams, allFixtures, selectedTeam, sensitivityMetric]);

  // Re-simulate with chapters applied (debounced)
  const runChapterSim = useCallback(() => {
    if (chapterTimerRef.current) clearTimeout(chapterTimerRef.current);

    if (activeChapters.length === 0) {
      setModifiedSimResults(null);
      return;
    }

    chapterTimerRef.current = setTimeout(() => {
      const modifiedFixtures = applyChapters(allFixtures, chapters);
      const results = simulate(teams, modifiedFixtures, SIM_COUNT);
      setModifiedSimResults(results);
    }, 120);
  }, [activeChapters.length, chapters, allFixtures, teams]);

  // Re-run chapter simulation when chapters change
  useEffect(() => {
    runChapterSim();
  }, [runChapterSim]);

  // Bring What-If controls into view when enabled
  useEffect(() => {
    if (!whatIfActive) return;
    const id = window.setTimeout(() => {
      whatIfPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(id);
  }, [whatIfActive]);

  // Auto-fetch + simulate on mount
  useEffect(() => {
    fetchData().then(({ teams: fetchedTeams, fixtures: fetchedFixtures }) => {
      setTimeout(() => {
        setRunning(true);
        setPhase('Running base simulation...');
        setTimeout(() => {
          const results = simulate(fetchedTeams, fetchedFixtures, SIM_COUNT);
          setSimResults(results);

          setPhase('Running sensitivity analysis...');
          setTimeout(() => {
            const sensitivity = sensitivityScan(
              fetchedTeams,
              fetchedFixtures,
              initialTeam,
              SENSITIVITY_SIMS,
              sensitivityMetric
            );
            setSensitivityResults(sensitivity);
            setRunning(false);
            setPhase('');
          }, 50);
        }, 50);
      }, 100);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When team changes, re-run sensitivity
  useEffect(() => {
    if (!simResults || running) return;

    setPhase('Updating sensitivity...');
    setTimeout(() => {
      const sensitivity = sensitivityScan(
        teams,
        allFixtures,
        selectedTeam,
        SENSITIVITY_SIMS,
        sensitivityMetric
      );
      setSensitivityResults(sensitivity);
      setPhase('');
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeam, sensitivityMetric]);

  // Chapter management handlers
  const handleAddChapter = useCallback((chapter: Chapter) => {
    setScenarioState((prev) => addChapter(prev, chapter));
  }, []);

  const handleRemoveChapter = useCallback((id: string) => {
    setScenarioState((prev) => removeChapter(prev, id));
  }, []);

  const handleToggleChapter = useCallback((id: string) => {
    setScenarioState((prev) => toggleChapter(prev, id));
  }, []);

  const handleResetChapters = useCallback(() => {
    setScenarioState(resetAllChapters());
    setModifiedSimResults(null);
  }, []);

  // What-If lock handler — creates/updates/removes chapters
  const handleToggleLock = useCallback(
    (fixtureId: string, result: 'home' | 'draw' | 'away') => {
      const existingChapter = chapters.find(
        (c) => c.type === 'fixture_lock' && c.fixtureLock?.fixtureId === fixtureId
      );

      if (existingChapter) {
        if (existingChapter.fixtureLock?.result === result) {
          // Toggle off
          setScenarioState((prev) => removeChapter(prev, existingChapter.id));
        } else {
          // Update to different result
          setScenarioState((prev) => ({
            ...prev,
            chapters: prev.chapters.map((c) =>
              c.id === existingChapter.id
                ? { ...c, fixtureLock: { fixtureId, result }, title: getFixtureLockTitle(fixtureId, result) }
                : c
            ),
          }));
        }
      } else {
        // New lock chapter
        const fixture = allFixtures.find((f) => f.id === fixtureId);
        if (!fixture) return;
        const chapter = createFixtureLockChapter(
          fixtureId,
          result,
          fixture.homeTeam,
          fixture.awayTeam
        );
        setScenarioState((prev) => addChapter(prev, chapter));
      }
    },
    [chapters, allFixtures]
  );

  // Helper to generate lock title on update
  const getFixtureLockTitle = useCallback(
    (fixtureId: string, result: 'home' | 'draw' | 'away') => {
      const fixture = allFixtures.find((f) => f.id === fixtureId);
      if (!fixture) return 'Unknown fixture';
      const resultLabels = {
        home: `${fixture.homeTeam} win`,
        draw: 'Draw',
        away: `${fixture.awayTeam} win`,
      };
      return `${fixture.homeTeam} vs ${fixture.awayTeam}: ${resultLabels[result]}`;
    },
    [allFixtures]
  );

  const handleResetLocks = useCallback(() => {
    // Remove only fixture lock chapters
    setScenarioState((prev) => ({
      ...prev,
      chapters: prev.chapters.filter((c) => c.type !== 'fixture_lock'),
    }));
  }, []);

  // Kyle mode handlers
  const handleKyleToggle = useCallback(() => {
    setKyleMode((prev) => {
      const next = !prev;
      writeKyleState(next);
      if (next && !sidebarOpen) setSidebarOpen(true);
      return next;
    });
  }, [sidebarOpen]);

  const handleChatClose = useCallback(() => {
    setSidebarOpen(false);
    setKyleMode(false);
    writeKyleState(false);
  }, []);

  const handleExitKyleMode = useCallback(() => {
    setKyleMode(false);
    writeKyleState(false);
  }, []);

  const dismissQuickStart = useCallback(() => {
    setShowQuickStart(false);
    try {
      window.localStorage.setItem('keepwatch.quickStartDismissed', '1');
    } catch {
      // Ignore storage failures and keep UX functional.
    }
  }, []);

  const noteFirstInteraction = useCallback(() => {
    if (!showQuickStart) return;
    dismissQuickStart();
  }, [dismissQuickStart, showQuickStart]);

  // Escape key exits Kyle mode (and closes chat)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        handleChatClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen, handleChatClose]);

  const kyleActive = kyleMode && sidebarOpen;

  // Find selected team data
  const sortedTeams = [...teams].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return b.goalsFor - a.goalsFor;
  });
  const currentTeam = teams.find((t) => t.abbr === selectedTeam);
  const teamPosition = sortedTeams.findIndex((t) => t.abbr === selectedTeam) + 1;
  const gamesRemaining = currentTeam ? 38 - currentTeam.played : 0;
  const primaryCard = teamContext?.relevantCards[0] ?? null;
  const primaryOdds =
    displayResult && primaryCard ? (displayResult[primaryCard.key] as number) : null;

  const currentModeLabel = (() => {
    if (kyleActive) return 'Focus Chat';
    if (whatIfActive && sidebarOpen) return 'Match Outcomes + Chat';
    if (whatIfActive) return 'Match Outcomes';
    if (sidebarOpen) return 'Chat Assistant';
    return 'Baseline View';
  })();
  const inBaselineView = !kyleActive && !whatIfActive && !sidebarOpen;

  const handleReturnToBaseline = useCallback(() => {
    setWhatIfActive(false);
    if (sidebarOpen) {
      handleChatClose();
    }
  }, [sidebarOpen, handleChatClose]);

  const handlePrimaryRun = useCallback(() => {
    noteFirstInteraction();
    runSimulation();
  }, [noteFirstInteraction, runSimulation]);

  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem('keepwatch.quickStartDismissed');
      setShowQuickStart(dismissed !== '1');
    } catch {
      setShowQuickStart(true);
    }
  }, []);

  useEffect(() => {
    if (!simResults || teams.length === 0 || allFixtures.length === 0) return;

    const controller = new AbortController();
    setDeepDivePreview((prev) => ({ ...prev, status: 'loading' }));

    const fetchDeepDivePreview = async () => {
      try {
        const res = await fetch('/api/deep-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetTeam: selectedTeam,
            targetMetric: sensitivityMetric,
            teams,
            fixtures: allFixtures,
            checkCacheOnly: true,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error('Failed to fetch deep dive preview');
        }

        const data = await res.json();
        if (controller.signal.aborted) return;

        if (data.cacheEnabled === false) {
          setDeepDivePreview({
            status: 'disabled',
            summary: '',
            keyScenario: '',
            cachedAt: null,
            cacheMatchType: null,
            targetMetric: sensitivityMetric,
          });
          return;
        }

        if (!data.cached || !data.preview) {
          setDeepDivePreview({
            status: 'missing',
            summary: '',
            keyScenario: '',
            cachedAt: null,
            cacheMatchType: null,
            targetMetric: sensitivityMetric,
          });
          return;
        }

        setDeepDivePreview({
          status: 'ready',
          summary: data.preview.summary ?? '',
          keyScenario: data.preview.keyScenario ?? '',
          cachedAt: typeof data.cachedAt === 'number' ? data.cachedAt : null,
          cacheMatchType:
            data.cacheMatchType === 'exact' || data.cacheMatchType === 'scenario_fallback'
              ? data.cacheMatchType
              : null,
          targetMetric: typeof data.preview.targetMetric === 'string' ? data.preview.targetMetric : sensitivityMetric,
        });
      } catch {
        if (controller.signal.aborted) return;
        setDeepDivePreview((prev) => ({
          ...prev,
          status: 'error',
        }));
      }
    };

    fetchDeepDivePreview();
    return () => controller.abort();
  }, [simResults, selectedTeam, sensitivityMetric, teams, allFixtures]);

  return (
    <div
      className={`bg-[#0a0a0a] text-white font-inter ${
        kyleActive ? 'h-screen overflow-hidden flex flex-col' : 'min-h-screen'
      }`}
    >
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
        <div className="max-w-[900px] mx-auto" style={sidebarOpen && !kyleActive ? { marginRight: '400px' } : undefined}>
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

      <div className="border-b border-white/[0.06] bg-[#0b0b0b]">
        <div className="max-w-[900px] mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap text-[12px]">
          <div className="flex items-center gap-2 text-white/55">
            <span className="text-white/35">You are in:</span>
            <span className="font-semibold text-white/90">{currentModeLabel}</span>
            {!inBaselineView && (
              <button
                type="button"
                onClick={handleReturnToBaseline}
                className="ml-2 px-2.5 py-1 rounded border border-white/[0.16] text-white/70 hover:text-white/90 hover:border-white/[0.3] transition-colors cursor-pointer"
              >
                Return to baseline
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 text-white/65 flex-wrap">
            {primaryCard && primaryOdds !== null && (
              <span className="inline-flex items-center gap-1.5 rounded border border-white/[0.1] px-2.5 py-1">
                <span className="text-white/40">Odds</span>
                <span className="font-semibold text-white/95">{primaryCard.label} {primaryOdds.toFixed(1)}%</span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded border border-white/[0.1] px-2.5 py-1">
              <span className="text-white/40">Remaining</span>
              <span className="font-semibold text-white/95">{gamesRemaining} fixtures</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded border border-white/[0.1] px-2.5 py-1">
              <span className="text-white/40">Baseline</span>
              <span className="font-semibold text-white/90">{SIM_COUNT.toLocaleString()} sims</span>
            </span>
          </div>
        </div>
      </div>

      {/* Content area with sidebar */}
      <div className={`flex ${kyleActive ? 'flex-1 min-h-0 overflow-hidden' : ''}`}>
        {/* Kyle Mini-Dashboard (left panel in Kyle mode) */}
        {kyleActive && teamContext && (
          <KyleMiniDashboard
            selectedTeam={selectedTeam}
            teams={teams}
            displayResult={displayResult}
            baselineResult={baselineTeamResult}
            sensitivityResults={sensitivityResults}
            cards={teamContext.relevantCards}
            hasActiveChapters={hasActiveChapters}
            accentColor={accentColor}
            textAccentColor={textColor}
            numSims={SIM_COUNT}
            sensitivityMetric={sensitivityMetric}
            sensitivityMetricLabel={sensitivityMetricLabel}
          />
        )}

        {/* Main content — hidden in Kyle mode */}
        <div
          className={`transition-all duration-300 ${kyleActive ? 'hidden' : 'flex-1'}`}
          style={sidebarOpen && !kyleActive ? { marginRight: '380px' } : undefined}
        >
          <div className="max-w-[900px] mx-auto px-4 py-6">
            {showQuickStart && (
              <div className="mb-6 rounded-xl border border-teal-400/30 bg-teal-400/[0.07] p-4">
                <div className="font-oswald text-[12px] tracking-[0.14em] uppercase text-teal-200/90 mb-1">
                  New here? Start in 3 steps
                </div>
                <div className="text-[12px] text-white/65 mb-3">
                  1) Run the baseline simulation, 2) try match outcomes, 3) ask the chat assistant for scenario ideas.
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={handlePrimaryRun}
                    className="px-4 py-2 rounded-lg text-xs font-bold font-oswald tracking-widest uppercase text-white bg-gradient-to-br from-teal-500 to-teal-700 hover:from-teal-400 hover:to-teal-600 transition-all cursor-pointer"
                  >
                    Start Guided Simulation
                  </button>
                  <button
                    type="button"
                    onClick={dismissQuickStart}
                    className="px-4 py-2 rounded-lg text-xs text-white/60 border border-white/[0.18] hover:text-white/80 hover:border-white/[0.32] transition-colors cursor-pointer"
                  >
                    Hide guide
                  </button>
                </div>
              </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center gap-4 mb-7 flex-wrap">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex flex-col gap-1">
                  <div className="text-[10px] tracking-[0.12em] uppercase text-white/28 font-oswald px-1">
                    Explore
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => {
                        noteFirstInteraction();
                        setWhatIfActive(!whatIfActive);
                      }}
                      className={`px-5 py-3.5 rounded-lg text-sm font-bold font-oswald tracking-widest uppercase transition-all border cursor-pointer ${
                        whatIfActive
                          ? 'text-white border-amber-500/50'
                          : 'bg-transparent text-white/55 border-white/[0.12] hover:border-white/20'
                      }`}
                      style={
                        whatIfActive
                          ? { background: 'rgba(245,158,11,0.15)' }
                          : undefined
                      }
                      title="Open match outcomes to lock specific results"
                    >
                      {whatIfActive ? 'Exit Match Outcomes' : 'Try Match Outcomes'}
                    </button>
                    <button
                      onClick={() => {
                        noteFirstInteraction();
                        if (sidebarOpen) {
                          handleChatClose();
                        } else {
                          setSidebarOpen(true);
                        }
                      }}
                      className={`px-5 py-3.5 rounded-lg text-sm font-bold font-oswald tracking-widest uppercase transition-all border cursor-pointer relative ${
                        sidebarOpen
                          ? 'text-white'
                          : 'bg-transparent text-white/55 border-white/[0.12] hover:border-white/20'
                      }`}
                      style={
                        sidebarOpen
                          ? { background: `${accentColor}20`, borderColor: `${accentColor}40` }
                          : undefined
                      }
                      title="Open guided scenario chat"
                    >
                      Ask Chat
                      {chapters.length > 0 && !sidebarOpen && (
                        <span
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
                          style={{ background: accentColor }}
                        >
                          {chapters.length}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-[10px] tracking-[0.12em] uppercase text-white/28 font-oswald px-1">
                    Advanced
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <KyleToggle
                      active={kyleActive}
                      onToggle={handleKyleToggle}
                      accentColor={accentColor}
                    />
                    <button
                      onClick={() => {
                        noteFirstInteraction();
                        setDeepAnalysisOpen(true);
                      }}
                      className="px-5 py-3.5 rounded-lg text-sm font-bold font-oswald tracking-widest uppercase transition-all border cursor-pointer bg-transparent text-white/55 border-white/[0.12] hover:border-white/20 hover:text-white/70 flex items-center gap-2"
                      title="Open a detailed long-form report with key swing fixtures"
                    >
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                        <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M7.5 4.5V8.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Detailed Report
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-white/[0.08] bg-white/[0.015] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="font-oswald text-[11px] tracking-[0.12em] uppercase text-white/68">
                      Deep Dive Snapshot
                    </div>
                  </div>

                  {deepDivePreview.status === 'loading' && (
                    <div className="text-[12px] text-white/45">
                      Checking cached deep dive summary...
                    </div>
                  )}

                  {deepDivePreview.status === 'ready' && (
                    <div className="text-[12px] text-white/67 leading-5">
                      {deepDivePreview.keyScenario || deepDivePreview.summary}
                    </div>
                  )}

                  {(deepDivePreview.status === 'missing' || deepDivePreview.status === 'disabled' || deepDivePreview.status === 'error') && (
                    <div className="text-[12px] text-white/50 leading-5">
                      {deepDivePreview.status === 'disabled'
                        ? 'Detailed-report cache is not configured for this deployment yet.'
                        : 'No deep dive yet for this scenario — run one now and we’ll show the key takeaway here.'}
                    </div>
                  )}

                </div>

                <button
                  type="button"
                  onClick={() => setDeepAnalysisOpen(true)}
                  className="shrink-0 self-center px-3 py-1.5 rounded-lg text-[10px] font-bold font-oswald tracking-[0.12em] uppercase text-white bg-gradient-to-br from-teal-500 to-teal-700 hover:from-teal-400 hover:to-teal-600 transition-all cursor-pointer"
                >
                  {deepDivePreview.status === 'ready' ? 'View Report' : 'Generate Report'}
                </button>
              </div>
            </div>

            {running && phase && (
              <div className="mb-6 text-sm flex items-center gap-2" style={{ color: `${textColor}cc` }}>
                <div
                  className="w-4 h-4 border-2 rounded-full animate-spin"
                  style={{ borderColor: `${accentColor}33`, borderTopColor: accentColor }}
                />
                {phase}
              </div>
            )}

            {/* Scenario Comparison Strip */}
            {hasActiveChapters && baselineTeamResult && modifiedTeamResult && teamContext && (
              <ScenarioComparison
                baselineResult={baselineTeamResult}
                modifiedResult={modifiedTeamResult}
                teamContext={teamContext}
                chapters={chapters}
              />
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
                  displayResult={displayResult}
                  baselineResult={baselineTeamResult}
                  cards={teamContext?.relevantCards ?? []}
                  hasActiveChapters={hasActiveChapters}
                  numSims={SIM_COUNT}
                />
              </div>
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
            {sensitivityResults && (
              <SensitivityChart
                results={sensitivityResults}
                selectedTeam={selectedTeam}
                teams={teams}
                metricLabel={sensitivityMetricLabel}
              />
            )}

            {/* League Projections */}
            {simResults && (
              <LeagueProjections
                results={simResults}
                selectedTeam={selectedTeam}
                accentColor={accentColor}
                textAccentColor={textColor}
                teams={teams}
              />
            )}

            {/* Fixture List */}
            <FixtureList
              fixtures={allFixtures}
              selectedTeam={selectedTeam}
              teams={teams}
              accentColor={accentColor}
              textAccentColor={textColor}
            />

            {/* Standings */}
            <StandingsTable
              teams={teams}
              selectedTeam={selectedTeam}
              accentColor={accentColor}
              textAccentColor={textColor}
            />

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
              <br />
              <br />
              <strong className="text-white/50">Scenarios</strong> stack multiple what-if
              assumptions (fixture locks and probability modifiers) to explore compound
              effects on qualification odds. Use the chat sidebar to describe scenarios
              in natural language.
              <div className="mt-3 text-white/25 italic">
                Standings as of March 21, 2026. European places assume standard
                allocation (no cup winners adjustments).
              </div>
            </div>

            {/* Low-priority refresh action at page bottom */}
            <div className="mb-2 pt-2 border-t border-white/[0.06]">
              <RefreshButton
                onRefresh={handlePrimaryRun}
                running={running}
                hasResults={simResults !== null}
                fixtureCount={allFixtures.filter((f) => f.status === 'SCHEDULED').length}
                simCount={SIM_COUNT}
                tonedDown
              />
            </div>
          </div>
        </div>

        {/* Chat Sidebar */}
        <ChatSidebar
          isOpen={sidebarOpen}
          kyleMode={kyleActive}
          onExitKyleMode={handleExitKyleMode}
          onClose={handleChatClose}
          chapters={chapters}
          onAddChapter={handleAddChapter}
          onRemoveChapter={handleRemoveChapter}
          onToggleChapter={handleToggleChapter}
          onResetChapters={handleResetChapters}
          selectedTeam={selectedTeam}
          teams={teams}
          accentColor={accentColor}
          sensitivityResults={sensitivityResults}
          baselineResult={baselineTeamResult}
          modifiedResult={modifiedTeamResult}
        />
      </div>

      {/* Deep Analysis Modal */}
      <DeepAnalysisModal
        open={deepAnalysisOpen}
        onClose={() => setDeepAnalysisOpen(false)}
        accentColor={accentColor}
        textAccentColor={textColor}
        selectedTeam={selectedTeam}
        teams={teams}
        fixtures={allFixtures}
        selectedTeamResult={baselineTeamResult}
        sensitivityResults={sensitivityResults}
        sensitivityMetric={sensitivityMetric}
        onWhatIfTrigger={(metric, label) => {
          setDeepAnalysisOpen(false);
          setWhatIfTarget({ metric: metric as keyof SimulationResult, label });
          setWhatIfOpen(true);
        }}
      />

      {/* What-If Analysis Modal */}
      {whatIfTarget && (
        <WhatIfAnalysis
          open={whatIfOpen}
          onClose={() => {
            setWhatIfOpen(false);
            setWhatIfTarget(null);
          }}
          accentColor={accentColor}
          textAccentColor={textColor}
          targetTeam={selectedTeam}
          targetMetric={whatIfTarget.metric}
          targetMetricLabel={whatIfTarget.label}
          teams={teams}
          fixtures={allFixtures}
        />
      )}
    </div>
  );
}

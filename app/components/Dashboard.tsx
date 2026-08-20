'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Team,
  Fixture,
  SimulationResult,
  SensitivityMetric,
  SensitivityScanSummary,
  TeamContext,
} from '@/lib/types';
import { Chapter } from '@/lib/chat-types';
import { FALLBACK_SEASON, ODDS_API_NAME_MAP } from '@/lib/constants';
import { generateRemainingFixtures } from '@/lib/fixture-generator';
import { simulate } from '@/lib/montecarlo';
import { DEFAULT_SENSITIVITY_SIMS, SENSITIVITY_SEED, sensitivityScanDetailed } from '@/lib/sensitivity';
import {
  ScoredLeverageWindow,
  roundsRemaining as computeRoundsRemaining,
  scoreLeverageWindows,
  selectLeverageUnit,
} from '@/lib/leverage/horizon';
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
import SensitivityChart from './SensitivityChart';
import WhatIfPanel from './WhatIfPanel';
import ScenarioComparison from './ScenarioComparison';
import ChatSidebar from './ChatSidebar';
import FixtureList from './FixtureList';
import StandingsTable from './StandingsTable';
import LeagueProjections from './LeagueProjections';
import KyleMiniDashboard from './KyleMiniDashboard';
import DeepAnalysisModal from './DeepAnalysisModal';
import WhatIfAnalysis from './WhatIfAnalysis';
import SignupForm from './SignupForm';

const SIM_COUNT = 10000;
const SENSITIVITY_SIMS = DEFAULT_SENSITIVITY_SIMS;
/**
 * Fixed seed for the displayed probabilities, so pressing Re-run on unchanged
 * data reproduces the same numbers instead of jittering by a few tenths.
 */
const SIM_SEED = SENSITIVITY_SEED;
const REPORT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
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
  weeklyReports?: WeeklyReportLink[];
}

type DashboardFeature = 'lock' | 'chat' | 'report' | 'weekly';

export interface WeeklyReportLink {
  id: string;
  kind: 'preview' | 'roundup';
  label: string;
  href: string;
  latestHref: string;
  matchday: number;
  season: string;
  generatedAt: number;
  status: 'draft' | 'published';
}

type DeepDivePreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'disabled' | 'error';
  summary: string;
  keyScenario: string;
  cachedAt: number | null;
  cacheMatchType: 'exact' | 'scenario_fallback' | null;
  targetMetric: string | null;
};

function toOrdinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

function formatPct(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '--';
}

function formatReportDate(value: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function getPositionColor(position: number): string {
  if (position <= 4) return '#22c55e';
  if (position === 5) return '#3b82f6';
  if (position === 6) return '#f97316';
  if (position === 7) return '#00ccaa';
  if (position >= 18) return '#ef4444';
  return 'rgba(255,255,255,0.22)';
}

function getTeamNarrative(input: {
  teamName: string;
  teamContext: TeamContext | null;
  primaryCard: TeamContext['relevantCards'][number] | null;
  primaryOdds: number | null;
}): string {
  const { teamName, teamContext, primaryCard, primaryOdds } = input;
  if (!teamContext || !primaryCard || primaryOdds === null) {
    return `${teamName} season outlook is loading`;
  }

  const odds = formatPct(primaryOdds);
  if (primaryCard.key === 'championPct') {
    return `${teamName} are in the title race - ${odds} title odds`;
  }
  if (primaryCard.key === 'top4Pct' || primaryCard.key === 'top5Pct') {
    return `${teamName} are pushing for Champions League - ${odds} odds`;
  }
  if (primaryCard.key === 'top6Pct' || primaryCard.key === 'top7Pct') {
    return `${teamName} are fighting for European qualification - ${odds} odds`;
  }
  if (primaryCard.key === 'relegationPct') {
    return `${teamName} are battling relegation - ${odds} risk`;
  }
  if (teamContext.zone === 'relegation') {
    return `${teamName} are battling to stay up - ${odds} survival odds`;
  }
  return `${teamName} are tracking ${primaryCard.label.toLowerCase()} - ${odds} odds`;
}

function TeamRail({
  teams,
  selectedTeam,
  onSelectTeam,
}: {
  teams: Team[];
  selectedTeam: string;
  onSelectTeam: (abbr: string) => void;
}) {
  const orderedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name));
  const positionByTeam = new Map(teams.map((team, index) => [team.abbr, index + 1]));

  return (
    <div className="pb-4">
      <div className="grid grid-cols-10 gap-1.5">
        {orderedTeams.map((team) => {
          const isSelected = team.abbr === selectedTeam;
          const color = getTeamColour(team.abbr);
          const textColor = getTeamTextColour(team.abbr);
          const position = positionByTeam.get(team.abbr);
          return (
            <button
              key={team.abbr}
              type="button"
              onClick={() => onSelectTeam(team.abbr)}
              title={`${team.name}${position ? `, ${toOrdinal(position)}` : ''}`}
              className="h-10 rounded-lg border px-1 text-center transition-transform hover:scale-[1.03] hover:opacity-100"
              style={{
                borderColor: isSelected ? color : `${color}55`,
                background: isSelected
                  ? `linear-gradient(135deg, ${color}, ${color}88)`
                  : `linear-gradient(135deg, ${color}33, ${color}14)`,
                boxShadow: isSelected ? `0 0 0 1px ${color}60, 0 10px 24px ${color}22` : undefined,
              }}
            >
              <span
                className="block font-oswald text-[10px] font-bold uppercase tracking-[0.08em]"
                style={{ color: isSelected ? '#ffffff' : textColor }}
              >
                {team.abbr}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DashboardHeader({
  accentColor,
  selectedTeam,
  sortedTeams,
  currentTeam,
  teamPosition,
  gamesRemaining,
  narrative,
  dataSource,
  onSelectTeam,
  shifted,
}: {
  accentColor: string;
  selectedTeam: string;
  sortedTeams: Team[];
  currentTeam: Team | undefined;
  teamPosition: number;
  gamesRemaining: number;
  narrative: string;
  dataSource: string;
  onSelectTeam: (abbr: string) => void;
  shifted: boolean;
}) {
  const stats = [
    { label: 'Position', value: teamPosition > 0 ? toOrdinal(teamPosition) : '--', color: accentColor },
    { label: 'Points', value: currentTeam?.points ?? '--', color: 'rgba(237,237,237,0.78)' },
    { label: 'Games left', value: gamesRemaining, color: 'rgba(237,237,237,0.78)' },
  ];

  return (
    <header
      className="border-b-2 bg-[#080808] px-4 pt-5 sm:px-6"
      style={{
        borderBottomColor: `${accentColor}28`,
        background: 'linear-gradient(160deg,#050505 0%,#101010 58%,#080808 100%)',
      }}
    >
      <div
        className="mx-auto max-w-[920px] transition-[margin] duration-300"
        style={shifted ? { marginRight: '400px' } : undefined}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border font-oswald text-[11px] font-bold text-white"
              style={{
                borderColor: `${accentColor}60`,
                background: `linear-gradient(135deg, ${accentColor}cc, ${accentColor}45)`,
              }}
            >
              {selectedTeam}
            </div>
            <div className="min-w-0">
              <h1 className="m-0 font-oswald text-[24px] font-bold uppercase leading-none tracking-[0.12em]">
                Keepwatch
              </h1>
              <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-white/32">
                EPL Season Simulator
              </div>
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-2">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="min-w-[64px] rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-center"
              >
                <div className="mb-1 text-[9px] uppercase tracking-[0.14em] text-white/28">
                  {stat.label}
                </div>
                <div className="font-mono text-[17px] font-semibold leading-none" style={{ color: stat.color }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-4 text-[12.5px] leading-6 text-white/45">
          {currentTeam ? (
            <>
              <span className="font-semibold" style={{ color: accentColor }}>
                {currentTeam.name}
              </span>{' '}
              <span className="text-white/70">{narrative.replace(`${currentTeam.name} `, '')}</span>
              {dataSource && <span className="ml-2 text-[10px] text-white/22">Data: {dataSource}</span>}
            </>
          ) : (
            'Loading team data'
          )}
        </div>

        <TeamRail teams={sortedTeams} selectedTeam={selectedTeam} onSelectTeam={onSelectTeam} />
      </div>
    </header>
  );
}

function FeatureStrip({
  activeFeature,
  lockedCount,
  accentColor,
  reportStatus,
  weeklyReports,
  onToggle,
  shifted,
}: {
  activeFeature: DashboardFeature | null;
  lockedCount: number;
  accentColor: string;
  reportStatus: DeepDivePreviewState['status'];
  weeklyReports: WeeklyReportLink[];
  onToggle: (feature: DashboardFeature) => void;
  shifted: boolean;
}) {
  const latestPreview = weeklyReports.find((report) => report.kind === 'preview');
  const latestRoundup = weeklyReports.find((report) => report.kind === 'roundup');
  const cards = [
    {
      id: 'lock' as const,
      glyph: 'X',
      label: 'Lock Outcomes',
      desc: 'Pin match results and watch odds shift as your scenario builds.',
      status: lockedCount > 0 ? `${lockedCount} locked` : 'No fixtures locked',
      color: '#f59e0b',
      alert: lockedCount > 0,
    },
    {
      id: 'chat' as const,
      glyph: '<>',
      label: 'AI Scenarios',
      desc: 'Ask scenario questions and convert the answer into quantified odds.',
      status: 'Claude-powered',
      color: accentColor,
      alert: false,
    },
    {
      id: 'report' as const,
      glyph: '▤',
      label: 'Generate Report',
      desc: 'Deep-dive AI analysis on your team path and swing fixtures.',
      status:
        reportStatus === 'ready'
          ? 'Saved report ready'
          : reportStatus === 'loading'
          ? 'Checking cache'
          : 'Ready to generate',
      color: '#00ccaa',
      alert: reportStatus === 'ready',
    },
    {
      id: 'weekly' as const,
      glyph: '◷',
      label: 'Weekly',
      desc: `${latestPreview ? latestPreview.label : 'No preview yet'} · ${
        latestRoundup ? latestRoundup.label : 'No roundup yet'
      }`,
      status: weeklyReports.length > 0 ? `${weeklyReports.length} saved reports` : 'No saved reports',
      color: '#818cf8',
      alert: weeklyReports.length > 0,
    },
  ];

  return (
    <section className="border-b border-white/[0.07] bg-[#0c0c0c] px-4 py-3 sm:px-6">
      <div
        className="mx-auto grid max-w-[920px] grid-cols-1 gap-2 transition-[margin] duration-300 sm:grid-cols-2 lg:grid-cols-4"
        style={shifted ? { marginRight: '400px' } : undefined}
      >
        {cards.map((card) => {
          const active = activeFeature === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onToggle(card.id)}
              className="relative min-h-[110px] rounded-lg border p-4 text-left transition-colors"
              style={{
                borderColor: active ? `${card.color}65` : 'rgba(255,255,255,0.075)',
                background: active ? `${card.color}12` : 'rgba(255,255,255,0.018)',
              }}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <span className="font-mono text-[15px]" style={{ color: active ? card.color : 'rgba(237,237,237,0.3)' }}>
                  {card.glyph}
                </span>
                {card.alert && !active && (
                  <span
                    className="rounded-full px-2 py-0.5 font-oswald text-[8px] uppercase tracking-[0.12em]"
                    style={{ background: `${card.color}22`, color: card.color }}
                  >
                    New
                  </span>
                )}
              </div>
              <div
                className="mb-1 font-oswald text-[12px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: active ? card.color : 'rgba(237,237,237,0.74)' }}
              >
                {card.label}
              </div>
              <div className="mb-3 text-[11px] leading-5 text-white/35">{card.desc}</div>
              <div className="font-mono text-[10px]" style={{ color: active ? card.color : 'rgba(237,237,237,0.28)' }}>
                {active ? 'active - click to close' : card.status}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WeeklyReportsPanel({
  reports,
  shifted,
}: {
  reports: WeeklyReportLink[];
  shifted: boolean;
}) {
  const latest = reports[0] ?? null;

  return (
    <section className="border-b border-white/[0.07] bg-[#080808] px-4 py-6 sm:px-6">
      <div
        className="mx-auto max-w-[920px] transition-[margin] duration-300"
        style={shifted ? { marginRight: '400px' } : undefined}
      >
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <div className="font-oswald text-[11px] uppercase tracking-[0.18em] text-white/35">
              Weekly Reports
            </div>
            <div className="mt-1 text-[12px] text-white/28">
              Previews and roundups generated for Newcastle.
            </div>
          </div>
          {latest && (
            <a
              href={latest.latestHref}
              className="rounded-lg border border-indigo-300/40 bg-indigo-300/15 px-4 py-2 font-oswald text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-100 transition-colors hover:border-indigo-200/70 hover:bg-indigo-300/20"
            >
              Open latest
            </a>
          )}
        </div>

        {latest ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)]">
            <a
              href={latest.latestHref}
              className="rounded-lg border border-indigo-300/45 bg-indigo-300/[0.12] p-5 transition-colors hover:border-indigo-200/70 hover:bg-indigo-300/[0.16]"
            >
              <div className="mb-3 inline-flex rounded-full bg-indigo-300/20 px-2.5 py-1 font-oswald text-[9px] uppercase tracking-[0.14em] text-indigo-100">
                Latest recommended
              </div>
              <div className="font-oswald text-[24px] font-bold uppercase leading-none text-white">
                {latest.label}
              </div>
              <div className="mt-2 text-[12px] text-white/42">
                Generated {formatReportDate(latest.generatedAt)} · {latest.season}
              </div>
            </a>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {reports.map((report, index) => {
                const isLatest = index === 0;
                return (
                  <a
                    key={report.id}
                    href={isLatest ? report.latestHref : report.href}
                    title={`Generated ${formatReportDate(report.generatedAt)}`}
                    className={`rounded-lg border px-4 py-3 transition-colors ${
                      isLatest
                        ? 'border-indigo-300/35 bg-indigo-300/[0.09] text-indigo-100'
                        : 'border-white/[0.08] bg-white/[0.02] text-white/58 hover:border-white/[0.18] hover:text-white/82'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-oswald text-[12px] font-semibold uppercase tracking-[0.1em]">
                        {report.label}
                      </div>
                      <div
                        className={`rounded-full px-2 py-0.5 text-[8px] uppercase tracking-[0.12em] ${
                          report.kind === 'preview'
                            ? 'bg-amber-300/12 text-amber-200/80'
                            : 'bg-blue-300/12 text-blue-200/80'
                        }`}
                      >
                        {report.kind}
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-white/28">
                      Generated {formatReportDate(report.generatedAt)}
                      {isLatest ? ' · latest' : ''}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-5 text-[12px] text-white/40">
            No weekly previews or roundups have been generated yet.
          </div>
        )}
      </div>
    </section>
  );
}

function MetricOverview({
  result,
  baselineResult,
  cards,
  hasActiveChapters,
  accentColor,
  numSims,
}: {
  result: SimulationResult;
  baselineResult: SimulationResult | null;
  cards: TeamContext['relevantCards'];
  hasActiveChapters: boolean;
  accentColor: string;
  numSims: number;
}) {
  const primary = cards[0];
  if (!primary) return null;

  const primaryValue = result[primary.key] as number;
  const baselineValue = baselineResult ? (baselineResult[primary.key] as number) : primaryValue;
  const showScenarioDelta = hasActiveChapters && Number.isFinite(baselineValue);
  const delta = primaryValue - baselineValue;
  const barColor = showScenarioDelta ? (delta >= 0 ? '#4ade80' : '#f87171') : primary.color;
  const secondary = cards.slice(1, 4);
  const dist = result.positionDistribution;
  const maxDist = Math.max(...dist, 1);

  return (
    <section className="mb-8">
      <div
        className="mb-3 rounded-lg border p-6 sm:p-7"
        style={{
          borderColor: `${accentColor}42`,
          background: `linear-gradient(135deg, ${accentColor}16 0%, rgba(255,255,255,0.018) 72%)`,
        }}
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="mb-2 font-oswald text-[10px] uppercase tracking-[0.2em] text-white/38">
              {primary.label} Probability · Primary Metric
            </div>
            <div className="flex items-baseline gap-3">
              {showScenarioDelta && (
                <span className="font-oswald text-[34px] font-semibold leading-none text-white/24 line-through">
                  {formatPct(baselineValue)}
                </span>
              )}
              <span className="font-oswald text-[76px] font-bold leading-none sm:text-[84px]" style={{ color: barColor }}>
                {primaryValue.toFixed(1)}
                <span className="text-[34px] opacity-70">%</span>
              </span>
            </div>
            <div className="mt-2 text-[12px] leading-5 text-white/42">
              {primary.sub}
              {showScenarioDelta && (
                <span className="ml-3 font-mono text-[11px]" style={{ color: barColor }}>
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(1)}pp from scenario
                </span>
              )}
            </div>
          </div>
          <div className="text-left md:text-right">
            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-white/28">Avg final pts</div>
            <div className="font-mono text-[30px] font-semibold leading-none text-white/72">
              {result.avgPoints.toFixed(1)}
            </div>
            <div className="mt-1 text-[10px] text-white/22">{numSims.toLocaleString()} sims</div>
          </div>
        </div>
        <div className="mt-5 h-1 overflow-hidden rounded-sm bg-white/[0.08]">
          <div
            className="h-full rounded-sm transition-[width] duration-700"
            style={{ width: `${Math.min(primaryValue, 100)}%`, background: barColor }}
          />
        </div>
      </div>

      {secondary.length > 0 && (
        <div className={`mb-8 grid grid-cols-1 gap-2 ${secondary.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {secondary.map((card) => {
            const value = result[card.key] as number;
            return (
              <div key={card.key} className="rounded-lg border border-white/[0.07] bg-white/[0.018] p-4">
                <div className="mb-1 font-oswald text-[10px] uppercase tracking-[0.18em] text-white/38">
                  {card.label}
                </div>
                <div className="mb-1 font-oswald text-[34px] font-bold leading-none" style={{ color: card.color }}>
                  {value.toFixed(1)}
                  <span className="text-[17px] opacity-70">%</span>
                </div>
                <div className="mb-3 text-[11px] text-white/28">{card.sub}</div>
                <div className="h-[3px] overflow-hidden rounded-sm bg-white/[0.08]">
                  <div
                    className="h-full rounded-sm transition-[width] duration-700"
                    style={{ width: `${Math.min(value, 100)}%`, background: card.color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <div className="mb-1 font-oswald text-[10px] uppercase tracking-[0.2em] text-white/38">
          Finishing Position Distribution
        </div>
        <div className="mb-4 text-[12px] text-white/24">
          Where this team finishes across {numSims.toLocaleString()} simulated seasons
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.014] px-3 pb-3 pt-4">
          <div className="flex h-[96px] items-end gap-[3px]">
            {dist.map((value, index) => (
              <div key={index} className="flex h-full flex-1 items-end">
                <div
                  className="w-full rounded-t-[2px]"
                  title={`${toOrdinal(index + 1)}: ${((value / numSims) * 100).toFixed(1)}%`}
                  style={{
                    height: `${Math.max((value / maxDist) * 100, value > 0 ? 3 : 0)}%`,
                    background: getPositionColor(index + 1),
                    opacity: value > 0 ? 0.78 : 0.08,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[3px]">
            {dist.map((_, index) => (
              <div key={index} className="flex-1 text-center font-mono text-[8px] text-white/18">
                {index + 1}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-white/28">
            {[
              ['#22c55e', 'UCL'],
              ['#3b82f6', 'UCL 5th'],
              ['#f97316', 'Europa'],
              ['#00ccaa', 'Conference'],
              ['rgba(255,255,255,0.22)', 'Mid'],
              ['#ef4444', 'Relegation'],
            ].map(([color, label]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Persistent, non-dismissible. The whole point is that a reader cannot mistake
 * last season's table for this season's, and cannot dismiss the warning and
 * keep reading numbers — because in this state there are no numbers.
 */
function StaleDataBanner() {
  return (
    <div
      role="alert"
      className="border-b border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 sm:px-6"
    >
      <div className="mx-auto flex max-w-[920px] items-start gap-3">
        <span aria-hidden className="mt-[1px] text-[13px] leading-none text-amber-300/90">&#9888;</span>
        <div className="text-[12.5px] leading-5 text-amber-100/85">
          <span className="font-semibold">Live data unavailable</span> &mdash; showing{' '}
          {FALLBACK_SEASON} final standings.{' '}
          <span className="font-semibold">These are not current.</span>
          <div className="mt-0.5 text-[11.5px] text-amber-100/55">
            Projections are suppressed until live data returns. A wrong number is
            worse than no number.
          </div>
        </div>
      </div>
    </div>
  );
}

function StaleDataOverview() {
  return (
    <section className="mb-8 rounded-lg border border-white/[0.07] bg-white/[0.018] p-8 text-center">
      <div className="font-oswald text-[13px] uppercase tracking-[0.14em] text-white/58">
        Projections unavailable
      </div>
      <div className="mx-auto mt-2 max-w-[420px] text-[12px] leading-5 text-white/32">
        Keepwatch could not reach live standings or fixtures, so there is nothing
        current to simulate. Nothing on this page is being computed from the{' '}
        {FALLBACK_SEASON} table shown above.
      </div>
    </section>
  );
}

function OverviewLoading({ phase, accentColor }: { phase: string; accentColor: string }) {
  return (
    <section className="mb-8 rounded-lg border border-white/[0.07] bg-white/[0.018] p-8 text-center">
      <div
        className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2"
        style={{ borderColor: `${accentColor}30`, borderTopColor: accentColor }}
      />
      <div className="font-oswald text-[13px] uppercase tracking-[0.14em] text-white/58">
        {phase || 'Running simulation'}
      </div>
      <div className="mt-2 text-[12px] text-white/30">
        Building the live dashboard from current standings and fixtures.
      </div>
    </section>
  );
}

export default function Dashboard({ initialTeam = 'NEW', weeklyReports = [] }: DashboardProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>(initialTeam);
  const [simResults, setSimResults] = useState<SimulationResult[] | null>(null);
  const [sensitivity, setSensitivity] = useState<SensitivityScanSummary | null>(null);
  const [leverageWindows, setLeverageWindows] = useState<ScoredLeverageWindow[] | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [dataSource, setDataSource] = useState<string>('');
  // True when any part of the snapshot fell back to last season's data. In this
  // state we render a banner and no probabilities at all — see the spec's 1.0.
  const [staleData, setStaleData] = useState(false);
  const [activeFeature, setActiveFeature] = useState<DashboardFeature | null>(null);

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
  const [deepAnalysisForceRefreshKey, setDeepAnalysisForceRefreshKey] = useState(0);
  const [deepDivePreviewRefreshKey, setDeepDivePreviewRefreshKey] = useState(0);

  // What-If Analysis modal state
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [whatIfTarget, setWhatIfTarget] = useState<{ metric: keyof SimulationResult; label: string } | null>(null);
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [metricOverride, setMetricOverride] = useState<SensitivityMetric | null>(null);
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

  const sortedWeeklyReports = useMemo(
    () => [...weeklyReports].sort((a, b) => b.generatedAt - a.generatedAt),
    [weeklyReports]
  );

  const allFixtures = fixtures;

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

  const autoMetric: SensitivityMetric = teamContext?.primaryMetric ?? 'top7Pct';
  const sensitivityMetric: SensitivityMetric = metricOverride ?? autoMetric;
  const sensitivityMetricLabel = SENSITIVITY_METRIC_LABELS[sensitivityMetric];

  // Available metric options from the team's relevant cards
  const metricOptions: { key: SensitivityMetric; label: string }[] = useMemo(() => {
    if (!teamContext) return [];
    return teamContext.relevantCards
      .filter((c) => {
        const k = c.key as string;
        return k in SENSITIVITY_METRIC_LABELS;
      })
      .map((c) => ({
        key: c.key as SensitivityMetric,
        label: SENSITIVITY_METRIC_LABELS[c.key as SensitivityMetric],
      }));
  }, [teamContext]);

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
    setMetricOverride(null); // Reset to auto-pick for new team
    setActiveFeature(null);
    setWhatIfActive(false);
    setSidebarOpen(false);
    setKyleMode(false);
    writeKyleState(false);
    const url = new URL(window.location.href);
    url.searchParams.set('team', abbr);
    window.history.replaceState({}, '', url.toString());
  }, []);

  const fetchData = useCallback(async (): Promise<{
    teams: Team[];
    fixtures: Fixture[];
    stale: boolean;
  }> => {
    let nextTeams = teams;
    let nextFixtures: Fixture[] = [];
    let stale = false;

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
          if (standingsData.source === 'stale-fallback') stale = true;
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
        if (fixturesData.source === 'stale-fallback') stale = true;
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
      setDataSource('stale-fallback');
      stale = true;
    }

    // Deliberately no fallback fixture synthesis here. If the fetch failed we have
    // nothing current to simulate, and an empty state is honest where last
    // season's fixtures dressed up as this season's are not.
    setStaleData(stale);

    return { teams: nextTeams, fixtures: nextFixtures, stale };
  }, [teams]);

  // One leverage pass: per-fixture deltas with measured error bars, plus the
  // window-level view for whatever horizon we are at. Both come from the same
  // paired engine and the same seed.
  const runLeverage = useCallback(
    (
      nextTeams: Team[],
      nextFixtures: Fixture[],
      target: string,
      metric: SensitivityMetric
    ): { summary: SensitivityScanSummary; windows: ScoredLeverageWindow[] } => {
      const summary = sensitivityScanDetailed(
        nextTeams,
        nextFixtures,
        target,
        SENSITIVITY_SIMS,
        metric,
        SENSITIVITY_SEED
      );

      const unit = selectLeverageUnit(computeRoundsRemaining(nextFixtures));
      const windows =
        unit === 'fixture'
          ? []
          : scoreLeverageWindows({
              teams: nextTeams,
              fixtures: nextFixtures,
              targetTeam: target,
              metric,
              unit,
              numSims: SENSITIVITY_SIMS,
              seed: SENSITIVITY_SEED,
            });

      return { summary, windows };
    },
    []
  );

  const runSimulation = useCallback(() => {
    if (staleData || teams.length === 0 || allFixtures.length === 0) return;
    setRunning(true);
    setPhase('Running base simulation...');

    setTimeout(() => {
      const results = simulate(teams, allFixtures, SIM_COUNT, SIM_SEED);
      setSimResults(results);

      // Compute correct metric from fresh results
      const teamResult = results.find((r) => r.team === selectedTeam);
      const teamData = teams.find((t) => t.abbr === selectedTeam);
      const ctx = teamData ? getTeamContext(teamData, teams, teamResult ?? undefined) : null;
      const correctMetric = ctx?.primaryMetric ?? sensitivityMetric;

      setPhase('Running sensitivity analysis...');

      setTimeout(() => {
        const { summary, windows } = runLeverage(teams, allFixtures, selectedTeam, correctMetric);
        setSensitivity(summary);
        setLeverageWindows(windows);
        setRunning(false);
        setPhase('');
      }, 50);
    }, 50);
  }, [teams, allFixtures, selectedTeam, sensitivityMetric, staleData, runLeverage]);

  // Re-simulate with chapters applied (debounced)
  const runChapterSim = useCallback(() => {
    if (chapterTimerRef.current) clearTimeout(chapterTimerRef.current);

    if (activeChapters.length === 0 || staleData) {
      setModifiedSimResults(null);
      return;
    }

    chapterTimerRef.current = setTimeout(() => {
      const modifiedFixtures = applyChapters(allFixtures, chapters);
      const results = simulate(teams, modifiedFixtures, SIM_COUNT, SIM_SEED);
      setModifiedSimResults(results);
    }, 120);
  }, [activeChapters.length, chapters, allFixtures, teams, staleData]);

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
    fetchData().then(({ teams: fetchedTeams, fixtures: fetchedFixtures, stale }) => {
      if (stale || fetchedTeams.length === 0 || fetchedFixtures.length === 0) return;
      setTimeout(() => {
        setRunning(true);
        setPhase('Running base simulation...');
        setTimeout(() => {
          const results = simulate(fetchedTeams, fetchedFixtures, SIM_COUNT, SIM_SEED);
          setSimResults(results);

          // Compute correct sensitivity metric from actual sim results
          // (the closure-captured sensitivityMetric is stale — still 'top7Pct')
          const teamResult = results.find((r) => r.team === initialTeam);
          const teamData = fetchedTeams.find((t) => t.abbr === initialTeam);
          const ctx = teamData ? getTeamContext(teamData, fetchedTeams, teamResult ?? undefined) : null;
          const correctMetric = ctx?.primaryMetric ?? 'top7Pct';

          setPhase('Measuring leverage...');
          setTimeout(() => {
            const { summary, windows } = runLeverage(
              fetchedTeams,
              fetchedFixtures,
              initialTeam,
              correctMetric
            );
            setSensitivity(summary);
            setLeverageWindows(windows);
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

    setPhase('Updating leverage...');
    setTimeout(() => {
      const { summary, windows } = runLeverage(
        teams,
        allFixtures,
        selectedTeam,
        sensitivityMetric
      );
      setSensitivity(summary);
      setLeverageWindows(windows);
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
    [chapters, allFixtures, getFixtureLockTitle]
  );

  const handleResetLocks = useCallback(() => {
    // Remove only fixture lock chapters
    setScenarioState((prev) => ({
      ...prev,
      chapters: prev.chapters.filter((c) => c.type !== 'fixture_lock'),
    }));
  }, []);

  const handleChatClose = useCallback(() => {
    setSidebarOpen(false);
    setKyleMode(false);
    setActiveFeature((feature) => (feature === 'chat' ? null : feature));
    writeKyleState(false);
  }, []);

  const handleExitKyleMode = useCallback(() => {
    setSidebarOpen(false);
    setKyleMode(false);
    setActiveFeature((feature) => (feature === 'chat' ? null : feature));
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
  const lockedCount = Object.keys(locks).length;
  const teamNarrative = getTeamNarrative({
    teamName: currentTeam?.name ?? selectedTeam,
    teamContext,
    primaryCard,
    primaryOdds,
  });
  const shiftForSidebar = sidebarOpen && !kyleActive;

  const inBaselineView = !kyleActive && !whatIfActive && !sidebarOpen;

  const handleReturnToBaseline = useCallback(() => {
    setActiveFeature(null);
    setWhatIfActive(false);
    if (sidebarOpen) {
      handleChatClose();
    }
  }, [sidebarOpen, handleChatClose]);

  const handlePrimaryRun = useCallback(() => {
    noteFirstInteraction();
    runSimulation();
  }, [noteFirstInteraction, runSimulation]);

  const handleFeatureToggle = useCallback(
    (feature: DashboardFeature) => {
      noteFirstInteraction();

      const nextFeature = activeFeature === feature ? null : feature;
      setActiveFeature(nextFeature);
      setWhatIfActive(nextFeature === 'lock');

      if (nextFeature === 'chat') {
        setSidebarOpen(true);
        setKyleMode(true);
        writeKyleState(true);
      } else if (activeFeature === 'chat' || feature === 'chat') {
        setSidebarOpen(false);
        setKyleMode(false);
        writeKyleState(false);
      }

      if (nextFeature === 'report') {
        setDeepAnalysisOpen(true);
      } else if (activeFeature === 'report' || feature === 'report') {
        setDeepAnalysisOpen(false);
      }
    },
    [activeFeature, noteFirstInteraction]
  );

  const isDeepDivePreviewStale =
    deepDivePreview.status === 'ready' &&
    deepDivePreview.cachedAt !== null &&
    Date.now() - deepDivePreview.cachedAt >= REPORT_STALE_AFTER_MS;

  const handleRegenerateStaleReport = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setDeepAnalysisOpen(true);
    setDeepAnalysisForceRefreshKey((key) => key + 1);
  }, []);

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
  }, [simResults, selectedTeam, sensitivityMetric, teams, allFixtures, deepDivePreviewRefreshKey]);

  return (
    <div
      className={`bg-[#0a0a0a] text-white font-inter ${
        kyleActive ? 'h-screen overflow-hidden flex flex-col' : 'min-h-screen'
      }`}
    >
      <DashboardHeader
        accentColor={accentColor}
        selectedTeam={selectedTeam}
        sortedTeams={sortedTeams}
        currentTeam={currentTeam}
        teamPosition={teamPosition}
        gamesRemaining={gamesRemaining}
        narrative={teamNarrative}
        dataSource={dataSource}
        onSelectTeam={handleSelectTeam}
        shifted={shiftForSidebar}
      />

      {staleData && <StaleDataBanner />}

      <FeatureStrip
        activeFeature={activeFeature}
        lockedCount={lockedCount}
        accentColor={accentColor}
        reportStatus={deepDivePreview.status}
        weeklyReports={sortedWeeklyReports}
        onToggle={handleFeatureToggle}
        shifted={shiftForSidebar}
      />

      {activeFeature === 'weekly' && (
        <WeeklyReportsPanel reports={sortedWeeklyReports} shifted={shiftForSidebar} />
      )}

      {/* Content area with sidebar */}
      <div className={`flex ${kyleActive ? 'flex-1 min-h-0 overflow-hidden' : ''}`}>
        {/* Kyle Mini-Dashboard (left panel in Kyle mode) */}
        {kyleActive && teamContext && (
          <KyleMiniDashboard
            selectedTeam={selectedTeam}
            teams={teams}
            displayResult={displayResult}
            baselineResult={baselineTeamResult}
            sensitivityResults={sensitivity?.ranked ?? null}
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
          style={shiftForSidebar ? { marginRight: '380px' } : undefined}
        >
          <div className="max-w-[920px] mx-auto px-4 py-7">
            <div className="mb-6 flex items-center justify-between gap-3 border-b border-white/[0.06] pb-4 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                {primaryCard && primaryOdds !== null && (
                  <span className="inline-flex items-center gap-1.5 rounded border border-white/[0.1] px-2.5 py-1 text-white/65">
                    <span className="text-white/35">{primaryCard.label}</span>
                    <span className="font-semibold text-white/90">{primaryOdds.toFixed(1)}%</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded border border-white/[0.1] px-2.5 py-1 text-white/65">
                  <span className="text-white/35">Sims</span>
                  <span className="font-semibold text-white/90">{SIM_COUNT.toLocaleString()}</span>
                </span>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handlePrimaryRun}
                disabled={running}
                className={`rounded-lg px-3 py-1.5 font-oswald text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                  running
                    ? 'cursor-wait bg-white/[0.05] text-white/35'
                    : 'cursor-pointer bg-teal-500/85 text-white hover:bg-teal-400/90'
                }`}
              >
                {running ? 'Simulating' : 'Re-run'}
              </button>
              {!inBaselineView && (
              <button
                  type="button"
                  onClick={handleReturnToBaseline}
                  className="rounded-lg border border-white/[0.12] px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:border-white/[0.24] hover:text-white/75"
                >
                  Reset View
              </button>
              )}
              </div>
            </div>

            {/* Report preview (only shown when a cached report exists) */}
            {deepDivePreview.status === 'ready' && (
              <div
                className="mb-6 rounded-lg border px-4 py-3 cursor-pointer hover:border-teal-400/40 transition-colors"
                style={{ borderColor: `${accentColor}25`, background: `${accentColor}08` }}
                onClick={() => setDeepAnalysisOpen(true)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-oswald text-[11px] tracking-[0.12em] uppercase text-white/55 mb-1">
                      Latest Report
                    </div>
                    <div className="text-[12.5px] text-white/70 leading-5">
                      {deepDivePreview.keyScenario || deepDivePreview.summary}
                    </div>
                  </div>
                  <div className="shrink-0 self-center flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeepAnalysisOpen(true); }}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-bold font-oswald tracking-[0.12em] uppercase text-white bg-gradient-to-br from-teal-500 to-teal-700 hover:from-teal-400 hover:to-teal-600 transition-all cursor-pointer"
                    >
                      View Report
                    </button>
                    {isDeepDivePreviewStale && (
                      <button
                        type="button"
                        onClick={handleRegenerateStaleReport}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-bold font-oswald tracking-[0.12em] uppercase text-amber-100 border border-amber-300/30 bg-amber-300/10 hover:bg-amber-300/20 hover:border-amber-300/45 transition-colors cursor-pointer"
                        title="This saved report is more than 7 days old"
                      >
                        Regenerate Report
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {running && phase && displayResult && (
              <div className="mb-6 text-sm flex items-center gap-2" style={{ color: `${textColor}cc` }}>
                <div
                  className="w-4 h-4 border-2 rounded-full animate-spin"
                  style={{ borderColor: `${accentColor}33`, borderTopColor: accentColor }}
                />
                {phase}
              </div>
            )}

            {displayResult && teamContext ? (
              <MetricOverview
                result={displayResult}
                baselineResult={baselineTeamResult}
                cards={teamContext.relevantCards}
                hasActiveChapters={hasActiveChapters}
                accentColor={accentColor}
                numSims={SIM_COUNT}
              />
            ) : staleData ? (
              <StaleDataOverview />
            ) : (
              <OverviewLoading phase={phase} accentColor={accentColor} />
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
                  sensitivityResults={sensitivity?.ranked ?? null}
                  teams={teams}
                  displayResult={displayResult}
                  baselineResult={baselineTeamResult}
                  cards={teamContext?.relevantCards ?? []}
                  hasActiveChapters={hasActiveChapters}
                  numSims={SIM_COUNT}
                />
              </div>
            )}

            {/* Sensitivity Chart */}
            {sensitivity && (
              <SensitivityChart
                results={sensitivity.ranked}
                summary={sensitivity}
                leverageWindows={leverageWindows ?? []}
                selectedTeam={selectedTeam}
                teams={teams}
                metricLabel={sensitivityMetricLabel}
                baselineValue={displayResult ? (displayResult[sensitivityMetric] as number) : null}
                metricOptions={metricOptions}
                activeMetric={sensitivityMetric}
                onMetricChange={setMetricOverride}
              />
            )}

            {/* Report CTA — nudge after sensitivity data */}
            {sensitivity && deepDivePreview.status !== 'ready' && (
              <div className="mb-8 rounded-xl border border-teal-400/20 bg-gradient-to-br from-teal-400/[0.06] to-transparent p-5">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-oswald text-[13px] tracking-[0.1em] uppercase text-white/75 mb-1">
                      Go deeper
                    </div>
                    <div className="text-[12px] text-white/50 leading-5 max-w-[480px]">
                      Generate an AI-powered report that analyses the key swing fixtures above and identifies what to watch for.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeepAnalysisOpen(true)}
                    className="shrink-0 px-5 py-3 rounded-lg text-[12px] font-bold font-oswald tracking-widest uppercase text-white bg-gradient-to-br from-teal-500 to-teal-700 hover:from-teal-400 hover:to-teal-600 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
                      <path d="M3 2.5h9M3 5.5h9M3 8.5h5M3 11.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                Generate Report
              </button>
            </div>
          </div>
        )}

            <SignupForm />

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
              time. Lock any fixture - not just the selected team&apos;s - since a
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

            {/* Re-run is now in the top status bar */}
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
          sensitivityResults={sensitivity?.ranked ?? null}
          baselineResult={baselineTeamResult}
          modifiedResult={modifiedTeamResult}
        />
      </div>

      {/* Deep Analysis Modal */}
      <DeepAnalysisModal
        open={deepAnalysisOpen}
        onClose={() => {
          setDeepAnalysisOpen(false);
          setActiveFeature((feature) => (feature === 'report' ? null : feature));
        }}
        accentColor={accentColor}
        textAccentColor={textColor}
        selectedTeam={selectedTeam}
        teams={teams}
        fixtures={allFixtures}
        selectedTeamResult={baselineTeamResult}
        sensitivityResults={sensitivity?.ranked ?? null}
        sensitivityMetric={sensitivityMetric}
        forceRefreshRequestKey={deepAnalysisForceRefreshKey}
        onReportGenerated={() => setDeepDivePreviewRefreshKey((key) => key + 1)}
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

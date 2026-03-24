'use client';

import { useMemo, useState } from 'react';
import {
  DeepAnalysis,
  PunditArchetype,
  PunditTake,
  SensitivityResult,
} from '@/lib/types';
import { PUNDIT_ARCHETYPES, PUNDIT_LABELS } from '@/lib/pundits';

interface Props {
  analysis: DeepAnalysis;
  selectedTeam: string;
  teamName: string;
  sensitivityResults: SensitivityResult[] | null;
  accentColor: string;
}

function metricToLabel(metric: string): string {
  switch (metric) {
    case 'championPct':
      return 'title odds';
    case 'top4Pct':
      return 'top-4 odds';
    case 'top5Pct':
      return 'top-5 odds';
    case 'top6Pct':
      return 'top-6 odds';
    case 'top7Pct':
      return 'European odds';
    case 'relegationPct':
      return 'relegation risk';
    case 'survivalPct':
      return 'survival odds';
    default:
      return metric;
  }
}

const ARCHETYPE_SUBTITLE: Record<PunditArchetype, string> = {
  analyst: 'Numbers and probabilities',
  coach: 'Tactics and game-state patterns',
  fan: 'Die-hard club-first energy',
  banter_merchant: 'Pub hot takes and jokes',
  skeptic: 'Variance and reality checks',
};

const ARCHETYPE_INITIALS: Record<PunditArchetype, string> = {
  analyst: 'AN',
  coach: 'CO',
  fan: 'FA',
  banter_merchant: 'BM',
  skeptic: 'SK',
};

export default function DeepAnalysisPunditPanel({
  analysis,
  selectedTeam,
  teamName,
  sensitivityResults,
  accentColor,
}: Props) {
  const [activeArchetype, setActiveArchetype] = useState<PunditArchetype>('analyst');
  const [takes, setTakes] = useState<Partial<Record<PunditArchetype, PunditTake>>>({});
  const [errors, setErrors] = useState<Partial<Record<PunditArchetype, string>>>({});
  const [rerolls, setRerolls] = useState<Partial<Record<PunditArchetype, number>>>({});
  const [loadingArchetype, setLoadingArchetype] = useState<PunditArchetype | null>(null);

  const fixture = useMemo(
    () => ({
      fixtureId:
        analysis.decisiveMatch.fixtureId ||
        analysis.matchesToWatch[0]?.fixtureId ||
        `${analysis.targetTeam}-fallback`,
      homeTeam: analysis.decisiveMatch.homeTeam || analysis.matchesToWatch[0]?.homeTeam || 'TBD',
      awayTeam: analysis.decisiveMatch.awayTeam || analysis.matchesToWatch[0]?.awayTeam || 'TBD',
      date: analysis.decisiveMatch.date || undefined,
    }),
    [analysis]
  );

  const topSensitivity = useMemo(() => {
    const source = sensitivityResults ?? [];
    return source.slice(0, 5).map((s) => ({
      fixtureId: s.fixtureId,
      homeTeam: s.homeTeam,
      awayTeam: s.awayTeam,
      maxAbsDelta: s.maxAbsDelta,
    }));
  }, [sensitivityResults]);

  const scenarioKey = `${analysis.id}:${analysis.generatedAt}`;
  const activeTake = takes[activeArchetype] ?? null;
  const activeRerolls = rerolls[activeArchetype] ?? 0;
  const canReroll = activeRerolls < 2;

  const requestTake = async (archetype: PunditArchetype, rerollIndex: number) => {
    setLoadingArchetype(archetype);
    setErrors((prev) => ({ ...prev, [archetype]: '' }));

    try {
      const res = await fetch('/api/pundit-take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioKey,
          archetype,
          rerollIndex,
          targetTeam: selectedTeam,
          targetTeamName: teamName,
          metricLabel: metricToLabel(analysis.targetMetric),
          baselineOdds: analysis.stateOfPlay.baselineOdds,
          fixture,
          topSensitivity,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const data = await res.json();
      const take = data.take as PunditTake | undefined;
      if (!take) {
        throw new Error('No take returned');
      }
      setTakes((prev) => ({ ...prev, [archetype]: take }));
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [archetype]: error instanceof Error ? error.message : 'Failed to generate take',
      }));
    } finally {
      setLoadingArchetype(null);
    }
  };

  const handleSelectArchetype = async (archetype: PunditArchetype) => {
    setActiveArchetype(archetype);
    if (!takes[archetype]) {
      await requestTake(archetype, rerolls[archetype] ?? 0);
    }
  };

  const handleRefresh = async () => {
    if (!canReroll || loadingArchetype) return;
    const next = activeRerolls + 1;
    setRerolls((prev) => ({ ...prev, [activeArchetype]: next }));
    await requestTake(activeArchetype, next);
  };

  return (
    <div className="h-full bg-[#0d0d0d] border-r border-white/[0.06] flex flex-col min-w-0">
      <div className="p-4 border-b border-white/[0.06]">
        <div className="font-oswald text-[11px] tracking-[0.16em] uppercase text-white/50">
          Pundit Panel
        </div>
        <div className="text-[11px] text-white/35 mt-1">Pick a voice, get a hot take</div>
      </div>

      <div className="p-4 space-y-3 overflow-y-auto">
        {PUNDIT_ARCHETYPES.map((archetype) => {
          const active = archetype === activeArchetype;
          return (
            <button
              key={archetype}
              onClick={() => handleSelectArchetype(archetype)}
              className="w-full text-left rounded-xl border px-3 py-2.5 transition-colors cursor-pointer"
              style={{
                borderColor: active ? `${accentColor}70` : 'rgba(255,255,255,0.12)',
                background: active ? `${accentColor}18` : 'rgba(255,255,255,0.02)',
              }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full border-2 flex items-center justify-center font-oswald text-[12px] tracking-wider"
                  style={{
                    borderColor: active ? `${accentColor}aa` : 'rgba(255,255,255,0.2)',
                    color: active ? accentColor : 'rgba(255,255,255,0.75)',
                    background: active ? `${accentColor}20` : 'rgba(255,255,255,0.04)',
                  }}
                >
                  {ARCHETYPE_INITIALS[archetype]}
                </div>
                <div className="min-w-0">
                  <div className="font-oswald text-[12px] tracking-wide text-white/90 truncate">
                    {PUNDIT_LABELS[archetype]}
                  </div>
                  <div className="text-[10px] text-white/40 truncate">{ARCHETYPE_SUBTITLE[archetype]}</div>
                </div>
              </div>
            </button>
          );
        })}

        <button
          onClick={handleRefresh}
          disabled={!canReroll || loadingArchetype !== null}
          className="w-full text-[10px] uppercase tracking-[0.1em] px-2.5 py-2 rounded border border-white/[0.15] text-white/60 disabled:opacity-40 cursor-pointer"
          title="Refresh the current pundit take"
        >
          Refresh take {activeRerolls}/2
        </button>
      </div>

      <div className="p-4 border-t border-white/[0.06]">
        {loadingArchetype === activeArchetype && (
          <div className="rounded-lg border border-white/[0.1] bg-white/[0.02] p-3.5 text-[12px] text-white/45">
            Generating {PUNDIT_LABELS[activeArchetype]}...
          </div>
        )}

        {errors[activeArchetype] && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-3.5 text-[12px] text-red-200/90">
            {errors[activeArchetype]}
          </div>
        )}

        {!loadingArchetype && !errors[activeArchetype] && activeTake && (
          <div className="rounded-lg border border-white/[0.1] bg-white/[0.02] p-3.5">
            <div className="text-[13px] text-white/80 leading-6">{activeTake.takeText}</div>
            <div className="mt-3 text-[11px] text-white/55">
              <span className="text-white/35 uppercase tracking-[0.08em]">Watch for: </span>
              {activeTake.watchFor}
            </div>
            <div className="mt-2 text-[10px] text-white/45 uppercase tracking-[0.08em]">
              Impact: {activeTake.impactOnTargetTeam} · Confidence: {activeTake.confidence}/5
            </div>
          </div>
        )}

        {!loadingArchetype && !errors[activeArchetype] && !activeTake && (
          <div className="rounded-lg border border-white/[0.1] bg-white/[0.02] p-3.5 text-[12px] text-white/45">
            Select a pundit to generate a take on {fixture.homeTeam} vs {fixture.awayTeam}.
          </div>
        )}
      </div>
    </div>
  );
}

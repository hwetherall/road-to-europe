'use client';

import { SimulationResult, TeamContext } from '@/lib/types';
import { Chapter } from '@/lib/chat-types';

interface Props {
  baselineResult: SimulationResult;
  modifiedResult: SimulationResult;
  teamContext: TeamContext;
  chapters: Chapter[];
}

export default function ScenarioComparison({
  baselineResult,
  modifiedResult,
  teamContext,
  chapters,
}: Props) {
  const activeCount = chapters.filter((c) => c.status === 'active').length;
  if (activeCount === 0) return null;

  const metric = teamContext.primaryMetric as keyof SimulationResult;
  const baseVal = baselineResult[metric] as number;
  const modVal = modifiedResult[metric] as number;
  const delta = modVal - baseVal;

  const isPositive =
    teamContext.zone === 'relegation'
      ? metric === 'relegationPct'
        ? delta < 0
        : delta > 0
      : delta > 0;

  const metricLabel =
    teamContext.relevantCards.find((c) => c.key === metric)?.label ?? metric;

  const ptsDelta = modifiedResult.avgPoints - baselineResult.avgPoints;

  return (
    <div
      className="mb-6 rounded-xl p-4 border"
      style={{
        background: isPositive ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
        borderColor: isPositive ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
      }}
    >
      <div className="text-[11px] text-white/40 mb-2">
        {activeCount} scenario{activeCount !== 1 ? 's' : ''} active
      </div>
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span className="text-white/50">
          {metricLabel}:{' '}
          <span className="text-white font-bold font-oswald">{baseVal.toFixed(1)}%</span>
        </span>
        <span className="text-white/30">&rarr;</span>
        <span className="text-white/50">
          <span className="text-white font-bold font-oswald">{modVal.toFixed(1)}%</span>
        </span>
        <span
          className="font-bold font-oswald"
          style={{ color: isPositive ? '#22c55e' : '#ef4444' }}
        >
          ({delta > 0 ? '+' : ''}
          {delta.toFixed(1)}pp)
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-white/40 mt-1">
        <span>
          Expected pts: {baselineResult.avgPoints.toFixed(1)} &rarr;{' '}
          {modifiedResult.avgPoints.toFixed(1)}{' '}
          <span
            style={{
              color: ptsDelta > 0 ? 'rgba(34,197,94,0.7)' : ptsDelta < 0 ? 'rgba(239,68,68,0.7)' : undefined,
            }}
          >
            ({ptsDelta > 0 ? '+' : ''}
            {ptsDelta.toFixed(1)})
          </span>
        </span>
      </div>
    </div>
  );
}

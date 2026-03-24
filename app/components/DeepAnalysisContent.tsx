'use client';

import { DeepAnalysis, CandidatePath } from '@/lib/types';

interface Props {
  accentColor: string;
  textAccentColor?: string;
  analysis: DeepAnalysis;
  teamName: string;
}

function SectionDivider({ accentColor }: { accentColor: string }) {
  return (
    <div className="my-10 flex items-center gap-4">
      <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}30, transparent)` }} />
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: `${accentColor}50` }} />
      <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}30, transparent)` }} />
    </div>
  );
}

function StatPill({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-5 py-4 text-center flex-1 min-w-[120px]">
      <div className="text-[9px] tracking-[0.15em] uppercase text-white/35 mb-1">{label}</div>
      <div className="font-oswald text-2xl font-bold" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-[10px] text-white/30 mt-0.5">{sub}</div>}
    </div>
  );
}

function ImpactRow({ result, odds, change, accent, highlight }: { result: string; odds: string; change: string; accent: string; highlight?: boolean }) {
  const isPositive = change.startsWith('+');
  const isNegative = change.startsWith('\u2212') || change.startsWith('-');
  return (
    <div
      className={`flex items-center justify-between px-5 py-3.5 ${highlight ? 'bg-white/[0.04]' : ''}`}
      style={highlight ? { borderLeft: `3px solid ${accent}` } : { borderLeft: '3px solid transparent' }}
    >
      <span className={`text-[13px] ${highlight ? 'text-white font-semibold' : 'text-white/70'}`}>{result}</span>
      <div className="flex items-center gap-6">
        <span className="font-oswald text-[15px] font-bold text-white/90 tabular-nums w-[52px] text-right">{odds}</span>
        <span
          className="font-oswald text-[13px] font-bold tabular-nums w-[56px] text-right"
          style={{ color: isPositive ? '#00ddb3' : isNegative ? '#ff5c5c' : 'rgba(255,255,255,0.4)' }}
        >
          {change}
        </span>
      </div>
    </div>
  );
}

function ScenarioPathway({ accent, bestPath, baselineOdds, threshold }: {
  accent: string;
  bestPath: CandidatePath | null;
  baselineOdds: number;
  threshold: number;
}) {
  if (!bestPath || bestPath.locks.length === 0) return null;

  // Build waterfall steps from baseline → each lock
  const steps: { label: string; value: number; delta?: string; isBase?: boolean }[] = [
    { label: 'Current baseline', value: Math.round(baselineOdds), isBase: true },
  ];

  // Distribute the total delta across locks proportionally
  const totalDelta = bestPath.resultingOdds - baselineOdds;
  const perLockDelta = bestPath.locks.length > 0 ? totalDelta / bestPath.locks.length : 0;
  let cumulative = baselineOdds;

  for (const lock of bestPath.locks) {
    cumulative += perLockDelta;
    steps.push({
      label: lock.resultLabel,
      value: Math.round(cumulative),
      delta: `+${Math.round(perLockDelta)}pp`,
    });
  }

  const maxVal = Math.max(threshold + 15, ...steps.map((s) => s.value + 10));

  return (
    <div className="mt-6">
      <div className="text-[10px] tracking-[0.12em] uppercase text-white/30 mb-4 text-center">
        The path to {threshold}%
      </div>
      <div className="space-y-0">
        {steps.map((step, i) => {
          const barWidth = (step.value / maxVal) * 100;
          const prevWidth = i > 0 ? (steps[i - 1].value / maxVal) * 100 : 0;
          const isLast = i === steps.length - 1;
          const crossedThreshold = step.value >= threshold;

          return (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="w-[140px] shrink-0 text-right">
                <div className={`text-[11px] leading-tight ${step.isBase ? 'text-white/35' : 'text-white/55'}`}>
                  {step.label}
                </div>
                {step.delta && (
                  <div className="text-[9px] font-semibold mt-0.5" style={{ color: accent }}>
                    {step.delta}
                  </div>
                )}
              </div>
              <div className="flex-1 h-[24px] relative">
                <div className="absolute inset-0 rounded bg-white/[0.03]" />
                {i > 0 && (
                  <div
                    className="absolute top-0 left-0 h-full rounded-l"
                    style={{ width: `${prevWidth}%`, background: `${accent}10` }}
                  />
                )}
                <div
                  className="absolute top-0 left-0 h-full rounded transition-all duration-700"
                  style={{
                    width: `${barWidth}%`,
                    background: crossedThreshold
                      ? `linear-gradient(90deg, ${accent}30, ${accent}70)`
                      : step.isBase
                        ? 'rgba(255,255,255,0.08)'
                        : `linear-gradient(90deg, ${accent}15, ${accent}40)`,
                    boxShadow: crossedThreshold ? `0 0 16px ${accent}30` : 'none',
                  }}
                />
                <div
                  className="absolute top-0 h-full w-px"
                  style={{ left: `${(threshold / maxVal) * 100}%`, background: 'rgba(255,255,255,0.15)' }}
                />
                {isLast && (
                  <div
                    className="absolute top-[-18px] text-[8px] tracking-wider uppercase text-white/25"
                    style={{ left: `${(threshold / maxVal) * 100}%`, transform: 'translateX(-50%)' }}
                  >
                    {threshold}% threshold
                  </div>
                )}
                <div
                  className="absolute top-0 h-full flex items-center pl-2"
                  style={{ left: `${barWidth}%` }}
                >
                  <span
                    className="font-oswald text-[12px] font-bold whitespace-nowrap"
                    style={{
                      color: crossedThreshold ? accent : step.isBase ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.6)',
                    }}
                  >
                    {step.value}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TacticalCard({ num, title, children, accent }: { num: number; title: string; children: React.ReactNode; accent: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl p-5 relative overflow-hidden">
      <div
        className="absolute top-0 left-0 w-1 h-full rounded-l-xl"
        style={{ background: `linear-gradient(180deg, ${accent}, ${accent}40)` }}
      />
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center font-oswald text-[13px] font-bold shrink-0"
          style={{ background: `${accent}15`, color: accent }}
        >
          {num}
        </div>
        <div className="font-oswald text-[14px] font-bold tracking-wide text-white/90 leading-snug pt-0.5">
          {title}
        </div>
      </div>
      <div className="text-[12.5px] text-white/55 leading-[1.75] pl-10">
        {children}
      </div>
    </div>
  );
}

function RiskCard({ title, children, threat }: { title: string; children: React.ReactNode; threat: 'high' | 'medium' }) {
  return (
    <div className="bg-red-500/[0.04] border border-red-500/[0.12] rounded-xl p-4 relative overflow-hidden">
      <div
        className="absolute top-0 left-0 w-1 h-full"
        style={{ background: threat === 'high' ? '#ff5c5c' : '#ff5c5c80' }}
      />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L13 12H1L7 1Z" stroke="#ff5c5c" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M7 5.5V8" stroke="#ff5c5c" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="7" cy="10" r="0.6" fill="#ff5c5c" />
          </svg>
          <span className="font-oswald text-[12px] font-bold tracking-wide text-red-400/90 uppercase">{title}</span>
        </div>
        <span
          className="text-[9px] tracking-wider uppercase px-2 py-0.5 rounded-full"
          style={{
            background: threat === 'high' ? 'rgba(255,92,92,0.12)' : 'rgba(255,92,92,0.06)',
            color: threat === 'high' ? '#ff7070' : '#ff707080',
            border: `1px solid ${threat === 'high' ? 'rgba(255,92,92,0.2)' : 'rgba(255,92,92,0.1)'}`,
          }}
        >
          {threat} threat
        </span>
      </div>
      <div className="text-[14px] text-white/55 leading-[1.75] pl-[22px]">
        {children}
      </div>
    </div>
  );
}

function FixtureCard({ title, why, detail, impact, accent, textAccent }: {
  title: string;
  why: string;
  detail: string;
  impact: string;
  accent: string;
  textAccent: string;
}) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl p-5">
      <div className="font-oswald text-[14px] font-bold tracking-wide text-white/90 mb-2">
        {title}
      </div>
      <div className="text-[10px] tracking-[0.1em] uppercase text-white/30 mb-2">Why it matters</div>
      <div className="text-[14px] text-white/60 leading-[1.75] mb-3">{why}</div>
      {detail && <div className="text-[14px] text-white/55 leading-[1.75] mb-3">{detail}</div>}
      <div
        className="text-[11px] px-3 py-2 rounded-lg leading-[1.6]"
        style={{ background: `${accent}08`, border: `1px solid ${accent}20`, color: textAccent }}
      >
        {impact}
      </div>
    </div>
  );
}

function WatchItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="3" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
          <circle cx="5" cy="5" r="1" fill="rgba(255,255,255,0.4)" />
        </svg>
      </div>
      <div className="text-[14px] text-white/60 leading-[1.75]">{children}</div>
    </div>
  );
}

function formatOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta.toFixed(0)}pp`;
  if (delta < 0) return `${delta.toFixed(0)}pp`;
  return '0pp';
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return dateStr;
  }
}

function getMetricLabel(metric: string): string {
  switch (metric) {
    case 'championPct': return 'Champion';
    case 'top4Pct': return 'Top-4';
    case 'top5Pct': return 'Top-5';
    case 'top6Pct': return 'Top-6';
    case 'top7Pct': return 'Top-7';
    case 'relegationPct': return 'Relegation';
    case 'survivalPct': return 'Survival';
    default: return metric.replace('Pct', '');
  }
}

function getHeroQuestion(metric: string, teamName: string): string {
  switch (metric) {
    case 'championPct': return `What needs to happen for ${teamName} to win the league?`;
    case 'relegationPct': return `How does ${teamName} avoid relegation?`;
    case 'survivalPct': return `How does ${teamName} secure survival?`;
    default: return `What needs to happen for ${teamName} to qualify for Europe?`;
  }
}

function getGapLabel(metric: string, metricLabel: string): string {
  if (metric === 'championPct') return 'Gap to 1st';
  if (metric === 'relegationPct') return 'Above drop zone';
  return `Gap to ${metricLabel}`;
}

export default function DeepAnalysisContent({ accentColor, textAccentColor = accentColor, analysis, teamName }: Props) {
  const { stateOfPlay, decisiveMatch, matchesToWatch, bottomLine } = analysis;
  const metricLabel = getMetricLabel(analysis.targetMetric);
  const isRelegation = analysis.targetMetric === 'relegationPct' || analysis.targetMetric === 'survivalPct';

  // Find the best path that crosses threshold for the waterfall
  const bestPath = null as CandidatePath | null; // Will be passed from parent if available

  return (
    <div className="max-w-[720px] mx-auto">
      {/* Hero */}
      <div className="text-center pt-8 pb-6">
        <div className="text-[10px] tracking-[0.2em] uppercase text-white/25 mb-4">
          Keepwatch Deep Analysis
        </div>
        <h1 className="font-oswald text-[26px] lg:text-[32px] font-bold tracking-wide leading-tight text-white/95">
          {getHeroQuestion(analysis.targetMetric, teamName)}
        </h1>
        <div className="text-[13px] text-white/35 mt-3">
          Based on {analysis.searchBudgetUsed > 0 ? `${analysis.searchBudgetUsed} web searches + ` : ''}10,000 Monte Carlo simulations &middot; {new Date(analysis.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      <SectionDivider accentColor={accentColor} />

      {/* State of Play */}
      <div>
        <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-5 text-center">
          The State of Play
        </div>

        <div className="flex gap-3 flex-wrap mb-6">
          <StatPill
            label="Position"
            value={formatOrdinal(stateOfPlay.position)}
            sub={`${stateOfPlay.points} points`}
            accent={accentColor}
          />
          <StatPill
            label={getGapLabel(analysis.targetMetric, metricLabel)}
            value={stateOfPlay.gapToTarget > 0 ? `${stateOfPlay.gapToTarget}pts` : 'None'}
            accent={stateOfPlay.gapToTarget > 0 ? (isRelegation ? '#00ddb3' : '#ff5c5c') : (isRelegation ? '#ff5c5c' : '#00ddb3')}
          />
          <StatPill
            label="Remaining"
            value={`${stateOfPlay.gamesRemaining}`}
            sub="matches"
            accent="rgba(255,255,255,0.7)"
          />
          <StatPill
            label={`${metricLabel} odds`}
            value={`~${stateOfPlay.baselineOdds.toFixed(0)}%`}
            sub="current baseline"
            accent={accentColor}
          />
        </div>

        <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 text-[15px] text-white/65 leading-[1.85]">
          {stateOfPlay.contextNarrative.split('\n').filter(Boolean).map((para, i) => (
            <p key={i} className={i > 0 ? 'mt-3' : ''}>{para}</p>
          ))}
        </div>

        {/* Optimal path callout */}
        <div
          className="mt-4 rounded-xl p-5 border"
          style={{ background: `${accentColor}06`, borderColor: `${accentColor}18` }}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="font-oswald text-[11px] tracking-[0.15em] uppercase" style={{ color: `${accentColor}aa` }}>
              The Optimal Path
            </div>
          </div>
          <div className="text-[14px] text-white/60 leading-[1.8]">
            {isRelegation ? (
              <>
                In the best-case scenario, {teamName}&apos;s relegation risk drops to{' '}
                <strong className="font-oswald" style={{ color: accentColor }}>
                  ~{stateOfPlay.optimalPathOdds.toFixed(0)}%
                </strong> — effectively safe. But the probability of all those results landing together is roughly{' '}
                <strong className="text-white/70">
                  {(stateOfPlay.optimalPathPlausibility * 100).toFixed(1)}%
                </strong>. That&apos;s the ceiling.
              </>
            ) : (
              <>
                In the best-case scenario, {metricLabel} odds rise to{' '}
                <strong className="font-oswald" style={{ color: accentColor }}>
                  ~{stateOfPlay.optimalPathOdds.toFixed(0)}%
                </strong>. But the probability of all those results landing together is roughly{' '}
                <strong className="text-white/70">
                  {(stateOfPlay.optimalPathPlausibility * 100).toFixed(1)}%
                </strong>. That&apos;s the ceiling.
              </>
            )}
          </div>
        </div>
      </div>

      <SectionDivider accentColor={accentColor} />

      {/* The Decisive Match */}
      {decisiveMatch.homeTeam && (
        <div>
          <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-2 text-center">
            The Decisive Match
          </div>
          <div className="text-center mb-6">
            <div className="font-oswald text-[24px] font-bold text-white/90 tracking-wide">
              {decisiveMatch.homeTeam} vs {decisiveMatch.awayTeam}
            </div>
            {decisiveMatch.date && (
              <div className="text-[13px] text-white/40 mt-1">{formatDate(decisiveMatch.date)}</div>
            )}
          </div>

          <div className="text-[15px] text-white/65 leading-[1.85] mb-6">
            This is the match that moves the needle the most. The simulation is unambiguous: no other single
            fixture has as much impact on {teamName}&apos;s odds.
          </div>

          {/* Impact table */}
          {decisiveMatch.outcomeTable.length > 0 && (
            <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl overflow-hidden mb-6">
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
                <span className="text-[10px] tracking-[0.12em] uppercase text-white/30">Result</span>
                <div className="flex items-center gap-6">
                  <span className="text-[10px] tracking-[0.12em] uppercase text-white/30 w-[52px] text-right">{metricLabel}</span>
                  <span className="text-[10px] tracking-[0.12em] uppercase text-white/30 w-[56px] text-right">Delta</span>
                </div>
              </div>
              {decisiveMatch.outcomeTable.map((row, i) => {
                const bestDelta = Math.max(...decisiveMatch.outcomeTable.map((r) => r.delta));
                return (
                  <ImpactRow
                    key={i}
                    result={row.result}
                    odds={`~${row.resultingOdds.toFixed(0)}%`}
                    change={formatDelta(row.delta)}
                    accent={accentColor}
                    highlight={row.delta === bestDelta}
                  />
                );
              })}
            </div>
          )}

          {/* Key Risks */}
          {decisiveMatch.risks.length > 0 && (
            <>
              <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-4">
                Key Risks
              </div>
              <div className="space-y-3 mb-10">
                {decisiveMatch.risks.map((risk, i) => (
                  <RiskCard key={i} title={`Risk ${i + 1}`} threat={i === 0 ? 'high' : 'medium'}>
                    {risk}
                  </RiskCard>
                ))}
              </div>
            </>
          )}

          {/* Angles */}
          {decisiveMatch.angles.length > 0 && (
            <>
              <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-4">
                Where the Matchup Favours {teamName}
              </div>
              <div className="space-y-4 mb-8">
                {decisiveMatch.angles.map((angle, i) => (
                  <TacticalCard key={i} num={i + 1} title={angle.title} accent={accentColor}>
                    {angle.analysis}
                  </TacticalCard>
                ))}
              </div>
            </>
          )}

          {/* What to Watch For */}
          {decisiveMatch.whatToWatch.length > 0 && (
            <>
              <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-3">
                What to Watch For
              </div>
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl px-5 py-3 mb-4">
                {decisiveMatch.whatToWatch.map((item, i) => (
                  <WatchItem key={i}>{item}</WatchItem>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <SectionDivider accentColor={accentColor} />

      {/* Matches to Watch */}
      {matchesToWatch.length > 0 && (
        <div>
          <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-2 text-center">
            Matches to Watch
          </div>
          <div className="text-center text-[13px] text-white/35 mb-6">
            Fixtures that move the needle on {teamName}&apos;s odds
          </div>

          <div className="space-y-4 mb-4">
            {matchesToWatch.map((match, i) => (
              <FixtureCard
                key={match.fixtureId || i}
                title={`${i + 1}. ${match.homeTeam} vs ${match.awayTeam}`}
                why={match.whyItMatters}
                detail={match.whyItsPlausible}
                impact={`Ideal: ${match.idealResult}. ${match.simulationImpact}`}
                accent={accentColor}
                textAccent={textAccentColor}
              />
            ))}
          </div>
        </div>
      )}

      <SectionDivider accentColor={accentColor} />

      {/* The Bottom Line */}
      <div className="mb-10">
        <div className="font-oswald text-[11px] tracking-[0.2em] uppercase text-white/35 mb-4 text-center">
          The Bottom Line
        </div>

        <div
          className="rounded-xl p-6 border"
          style={{
            background: `linear-gradient(135deg, ${accentColor}08, ${accentColor}03)`,
            borderColor: `${accentColor}20`,
          }}
        >
          <div className="text-[15px] text-white/70 leading-[1.9]">
            {bottomLine.summary.split('\n').filter(Boolean).map((para, i) => (
              <p key={i} className={i > 0 ? 'mt-3' : ''}>{para}</p>
            ))}
          </div>

          <div className="my-5 h-px" style={{ background: `${accentColor}15` }} />

          <ScenarioPathway
            accent={accentColor}
            bestPath={bestPath}
            baselineOdds={stateOfPlay.baselineOdds}
            threshold={analysis.targetThreshold}
          />

          <div className="mt-6" />

          <div
            className="rounded-lg px-5 py-4 text-center"
            style={{ background: `${accentColor}0a`, border: `1px solid ${accentColor}20` }}
          >
            <div className="text-[10px] tracking-[0.15em] uppercase text-white/30 mb-2">
              The Scenario to Build Towards
            </div>
            <div className="text-[15px] text-white/75 leading-[1.85]">
              {bottomLine.keyScenario}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center pb-10 text-[10px] text-white/20 leading-relaxed">
        Analysis generated by Keepwatch V4. Fixture probabilities derived from bookmaker odds via the-odds-api.com.
        <br />
        Simulation based on 10,000 Monte Carlo season outcomes.
        {analysis.sources.length > 0 && (
          <> Tactical intelligence sourced via {analysis.searchBudgetUsed} web searches.</>
        )}
      </div>
    </div>
  );
}

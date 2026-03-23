'use client';

import { useState, useEffect } from 'react';

interface Props {
  accentColor: string;
  teamName: string;
  onComplete: () => void;
  isReal?: boolean;
}

const STAGES = [
  { label: 'Running baseline simulation (10,000 seasons)', duration: 2000, icon: 'sim' },
  { label: 'Scanning fixture sensitivity (15 fixtures × 3 outcomes)', duration: 3000, icon: 'scan' },
  { label: 'Searching for optimal scenario paths', duration: 4000, icon: 'target' },
  { label: 'Branching at decision points', duration: 3000, icon: 'sim' },
  { label: 'Researching teams and tactical matchups', duration: 8000, icon: 'search' },
  { label: 'Composing analysis', duration: 5000, icon: 'write' },
] as const;

const REAL_MODE_TARGET_MS = 7 * 60 * 1000;
const REAL_STAGE_WEIGHTS = [14, 18, 20, 14, 22, 12] as const; // sums to 100

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = seconds % 60;
  return `${minutesPart}:${secondsPart.toString().padStart(2, '0')}`;
}

function StageIcon({ icon, active }: { icon: string; active: boolean }) {
  const color = active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.2)';
  const size = 16;
  switch (icon) {
    case 'scan':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="4" height="4" rx="0.5" stroke={color} strokeWidth="1.2" />
          <rect x="10" y="2" width="4" height="4" rx="0.5" stroke={color} strokeWidth="1.2" />
          <rect x="2" y="10" width="4" height="4" rx="0.5" stroke={color} strokeWidth="1.2" />
          <rect x="10" y="10" width="4" height="4" rx="0.5" stroke={color} strokeWidth="1.2" />
        </svg>
      );
    case 'sim':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M2 12L5 6L8 9L11 4L14 8" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'target':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke={color} strokeWidth="1.2" />
          <circle cx="8" cy="8" r="2.5" stroke={color} strokeWidth="1.2" />
          <circle cx="8" cy="8" r="0.8" fill={color} />
        </svg>
      );
    case 'search':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="4.5" stroke={color} strokeWidth="1.2" />
          <path d="M10.5 10.5L14 14" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'write':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M3 13L3 3L10 3L13 6L13 13Z" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10 3V6H13" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M5.5 8H10.5M5.5 10.5H9" stroke={color} strokeWidth="1" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

export default function DeepAnalysisLoader({ accentColor, teamName, onComplete, isReal }: Props) {
  const [currentStage, setCurrentStage] = useState(0);
  const [stageProgress, setStageProgress] = useState(0);
  const [overallProgress, setOverallProgress] = useState(0);
  const [remainingMs, setRemainingMs] = useState(REAL_MODE_TARGET_MS);

  useEffect(() => {
    if (!isReal) {
      // Original fake timer mode
      const totalDuration = STAGES.reduce((sum, s) => sum + s.duration, 0);
      let elapsed = 0;
      let stageIdx = 0;
      let stageElapsed = 0;

      const interval = setInterval(() => {
        elapsed += 30;
        stageElapsed += 30;

        if (stageIdx < STAGES.length && stageElapsed >= STAGES[stageIdx].duration) {
          stageIdx++;
          stageElapsed = 0;
          setCurrentStage(stageIdx);
        }

        if (stageIdx < STAGES.length) {
          setStageProgress(Math.min((stageElapsed / STAGES[stageIdx].duration) * 100, 100));
        }

        setOverallProgress(Math.min((elapsed / totalDuration) * 100, 100));

        if (elapsed >= totalDuration) {
          clearInterval(interval);
          setTimeout(onComplete, 400);
        }
      }, 30);

      return () => clearInterval(interval);
    }

    // Real mode: pace loader against a 7-minute budget while API works
    const realStageDurations = REAL_STAGE_WEIGHTS.map((weight) => (REAL_MODE_TARGET_MS * weight) / 100);
    let stageIdx = 0;
    let stageElapsed = 0;
    let totalElapsed = 0;

    const interval = setInterval(() => {
      totalElapsed += 100;
      stageElapsed += 100;
      setRemainingMs(Math.max(REAL_MODE_TARGET_MS - totalElapsed, 0));

      if (stageIdx < STAGES.length - 1 && stageElapsed >= realStageDurations[stageIdx]) {
        stageIdx++;
        stageElapsed = 0;
        setCurrentStage(stageIdx);
      }

      // Stage progress
      if (stageIdx < STAGES.length) {
        const dur = realStageDurations[stageIdx];
        if (stageIdx < STAGES.length - 1) {
          setStageProgress(Math.min((stageElapsed / dur) * 100, 100));
        } else {
          // Last stage: ease to 92% by seven minutes, then pulse while waiting
          if (totalElapsed <= REAL_MODE_TARGET_MS) {
            const stagePct = Math.min((stageElapsed / dur) * 100, 92);
            setStageProgress(stagePct);
          } else {
            const phase = ((totalElapsed - REAL_MODE_TARGET_MS) % 5000) / 5000;
            setStageProgress(84 + Math.sin(phase * Math.PI) * 8);
          }
        }
      }

      // Overall: approach 95% over 7 minutes, then hold until API completes
      const elapsedRatio = Math.min(totalElapsed / REAL_MODE_TARGET_MS, 1);
      setOverallProgress(10 + elapsedRatio * 85);
    }, 100);

    return () => clearInterval(interval);
  }, [onComplete, isReal]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#050505] flex items-center justify-center">
      {/* Background glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.06]"
        style={{ background: `radial-gradient(circle, ${accentColor}, transparent 70%)` }}
      />

      <div className="relative z-10 w-full max-w-md px-8">
        {/* Title */}
        <div className="text-center mb-12">
          <div className="font-oswald text-[11px] tracking-[0.25em] uppercase text-white/30 mb-3">
            Keepwatch
          </div>
          <div className="font-oswald text-xl font-bold tracking-wide uppercase text-white/90">
            Deep Analysis
          </div>
          <div className="text-[12px] text-white/30 mt-2">
            Analyzing {teamName}&apos;s season scenarios
          </div>
        </div>

        {/* Stages */}
        <div className="space-y-4 mb-10">
          {STAGES.map((stage, i) => {
            const isActive = i === currentStage;
            const isDone = i < currentStage;
            const isPending = i > currentStage;

            return (
              <div
                key={i}
                className="flex items-center gap-3 transition-all duration-300"
                style={{ opacity: isPending ? 0.25 : isDone ? 0.5 : 1 }}
              >
                <div className="w-6 flex items-center justify-center shrink-0">
                  {isDone ? (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2.5 7L5.5 10L11.5 4" stroke={accentColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : isActive ? (
                    <div className="relative">
                      <StageIcon icon={stage.icon} active />
                      <div
                        className="absolute -inset-1 rounded-full animate-ping opacity-30"
                        style={{ background: accentColor }}
                      />
                    </div>
                  ) : (
                    <StageIcon icon={stage.icon} active={false} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-[12px] transition-colors duration-300"
                    style={{ color: isActive ? 'rgba(255,255,255,0.9)' : isDone ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)' }}
                  >
                    {stage.label}
                  </div>
                  {isActive && (
                    <div className="mt-1.5 h-[2px] rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-100"
                        style={{ width: `${stageProgress}%`, background: accentColor }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Overall progress */}
        <div className="h-[3px] rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-100"
            style={{
              width: `${overallProgress}%`,
              background: `linear-gradient(90deg, ${accentColor}80, ${accentColor})`,
            }}
          />
        </div>
        <div className="text-center mt-3 text-[10px] text-white/20 tracking-wider">
          {isReal
            ? remainingMs > 0
              ? `Estimated time remaining ${formatClock(remainingMs)}`
              : 'Finalizing analysis...'
            : `${Math.round(overallProgress)}%`}
        </div>
      </div>
    </div>
  );
}

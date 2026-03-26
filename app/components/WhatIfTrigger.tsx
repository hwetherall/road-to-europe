'use client';

interface WhatIfTriggerProps {
  teamName: string;
  targetMetricLabel: string;
  variant: 'inline' | 'banner';
  accentColor?: string;
  onTrigger: () => void;
}

export default function WhatIfTrigger({
  teamName,
  targetMetricLabel,
  variant,
  accentColor = '#00aaaa',
  onTrigger,
}: WhatIfTriggerProps) {
  if (variant === 'inline') {
    return (
      <button
        onClick={onTrigger}
        className="text-[10px] mt-1 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
        style={{ color: accentColor }}
      >
        What if? &rarr;
      </button>
    );
  }

  return (
    <div
      className="mt-4 p-4 rounded-lg"
      style={{
        background: `linear-gradient(135deg, ${accentColor}12, ${accentColor}06)`,
        border: `1px solid ${accentColor}30`,
      }}
    >
      <div className="text-[12px] text-white/70 mb-2">
        {teamName} has a <span className="text-white font-medium">0%</span> chance of{' '}
        <span className="text-white font-medium">{targetMetricLabel}</span> under current conditions.
      </div>
      <div className="text-[11px] text-white/50 mb-3">
        Want to explore what structural changes could make it possible?
      </div>
      <button
        onClick={onTrigger}
        className="px-4 py-1.5 rounded text-[11px] font-medium transition-all hover:brightness-110 cursor-pointer"
        style={{
          background: `linear-gradient(135deg, ${accentColor}60, ${accentColor}40)`,
          color: 'white',
        }}
      >
        Explore &ldquo;What If&rdquo;
      </button>
    </div>
  );
}

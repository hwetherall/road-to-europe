'use client';

import { SimulationResult } from '@/lib/types';

interface Props {
  result: SimulationResult;
  numSims: number;
}

function getZoneColor(position: number): string {
  if (position <= 4) return '#22c55e';
  if (position === 5) return '#3b82f6';
  if (position === 6) return '#f97316';
  if (position === 7) return '#00ccaa';
  if (position >= 18) return '#ef4444';
  return 'rgba(255,255,255,0.2)';
}

export default function KyleMiniHistogram({ result, numSims }: Props) {
  const dist = result.positionDistribution;
  const maxCount = Math.max(...dist, 1);

  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height: '80px' }}>
        {dist.map((count, i) => {
          const pct = (count / numSims) * 100;
          const height = (count / maxCount) * 100;
          const position = i + 1;
          return (
            <div
              key={i}
              className="flex-1 h-full flex flex-col justify-end items-center group relative"
            >
              <div
                className="w-full rounded-t-sm transition-all duration-500 min-h-[1px]"
                style={{
                  height: `${Math.max(height, count > 0 ? 2 : 0)}%`,
                  background: getZoneColor(position),
                  opacity: count > 0 ? 0.8 : 0.1,
                }}
              />
              {count > 0 && (
                <div className="absolute bottom-full mb-1 hidden group-hover:block bg-black/90 border border-white/20 rounded px-1.5 py-0.5 text-[9px] text-white whitespace-nowrap z-10">
                  Pos {position}: {pct.toFixed(1)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* X-axis: every 5th position */}
      <div className="flex gap-[2px] mt-1">
        {dist.map((_, i) => {
          const pos = i + 1;
          const show = pos === 1 || pos % 5 === 0 || pos === 20;
          return (
            <div key={i} className="flex-1 text-center text-[8px] text-white/25">
              {show ? pos : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

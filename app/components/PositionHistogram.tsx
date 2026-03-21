'use client';

import { SimulationResult } from '@/lib/types';

interface Props {
  result: SimulationResult;
  accentColor: string;
  numSims: number;
}

function getZoneColor(position: number): string {
  if (position <= 4) return '#22c55e';    // UCL
  if (position === 5) return '#3b82f6';   // UCL expanded
  if (position === 6) return '#f97316';   // Europa
  if (position === 7) return '#00ccaa';   // Conference
  if (position >= 18) return '#ef4444';   // Relegation
  return 'rgba(255,255,255,0.2)';
}

export default function PositionHistogram({ result, numSims }: Props) {
  const dist = result.positionDistribution;
  const maxCount = Math.max(...dist, 1);

  return (
    <div className="mb-8">
      <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50 mb-2">
        Finishing Position Distribution
      </h2>
      <p className="text-xs text-white/30 mb-3">
        Where this team finishes across {numSims.toLocaleString()} simulations
      </p>
      <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4">
        <div className="flex items-end gap-[3px] h-[100px]">
          {dist.map((count, i) => {
            const pct = count / numSims * 100;
            const height = (count / maxCount) * 100;
            const position = i + 1;
            return (
              <div key={i} className="flex-1 h-full flex flex-col justify-end items-center group relative">
                <div
                  className="w-full rounded-t-sm transition-all duration-500 min-h-[1px]"
                  style={{
                    height: `${Math.max(height, count > 0 ? 2 : 0)}%`,
                    background: getZoneColor(position),
                    opacity: count > 0 ? 0.8 : 0.1,
                  }}
                />
                {/* Tooltip */}
                {count > 0 && (
                  <div className="absolute bottom-full mb-1 hidden group-hover:block bg-black/90 border border-white/20 rounded px-2 py-1 text-[10px] text-white whitespace-nowrap z-10">
                    {pct.toFixed(1)}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* X-axis labels */}
        <div className="flex gap-[3px] mt-1">
          {dist.map((_, i) => (
            <div
              key={i}
              className="flex-1 text-center text-[9px] text-white/30"
            >
              {i + 1}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex gap-3 mt-3 text-[9px] text-white/30 flex-wrap">
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#22c55e' }} /> UCL</span>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#3b82f6' }} /> UCL 5th</span>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#f97316' }} /> Europa</span>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#00ccaa' }} /> Conference</span>
          <span><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#ef4444' }} /> Relegation</span>
        </div>
      </div>
    </div>
  );
}

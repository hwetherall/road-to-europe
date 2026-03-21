'use client';

import { SimulationResult } from '@/lib/types';

interface Props {
  result: SimulationResult;
}

const CARDS = [
  { key: 'top4Pct' as const, label: 'Champions League', sub: 'Top 4', color: '#FFD700' },
  { key: 'top5Pct' as const, label: 'UCL (expanded)', sub: 'Top 5', color: '#C0C0C0' },
  { key: 'top6Pct' as const, label: 'Europa League', sub: 'Top 6', color: '#FF6B35' },
  { key: 'top7Pct' as const, label: 'Any Europe', sub: 'Top 7', color: '#00CCAA' },
];

function OddsBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 rounded-sm bg-white/[0.08] overflow-hidden w-full">
      <div
        className="h-full rounded-sm transition-all duration-700 ease-out"
        style={{ width: `${Math.min(value, 100)}%`, background: color }}
      />
    </div>
  );
}

export default function QualificationCards({ result }: Props) {
  return (
    <div className="mb-8">
      <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50 mb-4">
        Qualification Odds
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {CARDS.map((card) => {
          const value = result[card.key];
          return (
            <div
              key={card.key}
              className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 text-center"
            >
              <div className="text-[11px] text-white/45 tracking-widest uppercase mb-1">
                {card.label}
              </div>
              <div className="text-[10px] text-white/30 mb-3">{card.sub}</div>
              <div
                className="text-4xl font-extrabold font-oswald leading-none"
                style={{ color: card.color }}
              >
                {value.toFixed(1)}%
              </div>
              <div className="mt-3">
                <OddsBar value={value} color={card.color} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

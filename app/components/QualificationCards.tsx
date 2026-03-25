'use client';

import { SimulationResult, CardConfig } from '@/lib/types';

interface Props {
  result: SimulationResult;
  cards: CardConfig[];
}

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

export default function QualificationCards({ result, cards }: Props) {
  return (
    <div className="mb-8">
      <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/70 mb-1">
        Qualification Odds
      </h2>
      <div className="text-[12px] text-white/40 mb-4">
        Current baseline odds from 10,000 season simulations.
      </div>
      <div className={`grid grid-cols-2 ${cards.length > 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3`}>
        {cards.map((card, idx) => {
          const value = result[card.key] as number;
          const isPrimaryCard = idx === 0;
          return (
            <div
              key={card.key}
              className={`rounded-xl p-5 text-center border ${
                isPrimaryCard
                  ? 'bg-white/[0.06] border-white/[0.2]'
                  : 'bg-white/[0.03] border-white/[0.08]'
              }`}
            >
              <div className="text-[11px] text-white/55 tracking-widest uppercase mb-1">
                {card.label}
              </div>
              <div className="text-[10px] text-white/38 mb-3">
                {isPrimaryCard ? 'Primary watch metric' : card.sub}
              </div>
              <div
                className={`${isPrimaryCard ? 'text-5xl' : 'text-4xl'} font-extrabold font-oswald leading-none`}
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
      {/* Expected final stats */}
      <div className="flex gap-4 mt-3 text-xs text-white/50">
        <span>
          Expected points: <span className="text-white/80 font-semibold">{result.avgPoints.toFixed(1)}</span>
        </span>
        <span>
          Expected finish: <span className="text-white/80 font-semibold">{result.avgPosition.toFixed(1)}</span>
        </span>
      </div>
    </div>
  );
}

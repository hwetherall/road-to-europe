'use client';

import { SimulationResult, CardConfig } from '@/lib/types';

interface Props {
  result: SimulationResult;
  baselineResult: SimulationResult | null;
  cards: CardConfig[];
  hasActiveChapters: boolean;
}

export default function KyleQualCards({ result, baselineResult, cards, hasActiveChapters }: Props) {
  return (
    <div className="space-y-3">
      {cards.map((card) => {
        const value = result[card.key] as number;
        const baseValue = baselineResult ? (baselineResult[card.key] as number) : null;
        const delta = hasActiveChapters && baseValue !== null ? value - baseValue : null;
        const showDelta = delta !== null && Math.abs(delta) >= 0.1;

        return (
          <div key={card.key}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[9px] tracking-[0.12em] uppercase text-white/40">
                {card.label}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="font-oswald text-[16px] font-bold"
                  style={{ color: card.color }}
                >
                  {value.toFixed(1)}%
                </span>
                {showDelta && (
                  <span
                    className="text-[9px] font-semibold"
                    style={{ color: delta! > 0 ? '#00ccaa' : '#ef4444' }}
                  >
                    {delta! > 0 ? '+' : ''}{delta!.toFixed(1)}pp
                  </span>
                )}
              </div>
            </div>
            <div className="h-[3px] rounded-sm bg-white/[0.08] overflow-hidden w-full">
              <div
                className="h-full rounded-sm transition-all duration-500"
                style={{
                  width: `${Math.min(value, 100)}%`,
                  background: card.color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

'use client';

import { Fixture } from '@/lib/types';
import { HARDCODED_STANDINGS } from '@/lib/constants';

interface Props {
  fixtures: Fixture[];
}

function getTeamName(abbr: string): string {
  return HARDCODED_STANDINGS.find((t) => t.abbr === abbr)?.name ?? abbr;
}

export default function FixtureList({ fixtures }: Props) {
  const newcastleFixtures = fixtures.filter(
    (f) => f.homeTeam === 'NEW' || f.awayTeam === 'NEW'
  );

  if (newcastleFixtures.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50 mb-4">
        Newcastle Remaining Fixtures
      </h2>
      <div className="flex flex-col gap-1.5">
        {newcastleFixtures.map((f) => {
          const isHome = f.homeTeam === 'NEW';
          const opp = isHome ? f.awayTeam : f.homeTeam;
          const winProb = isHome ? (f.homeWinProb ?? 0.4) : (f.awayWinProb ?? 0.3);
          const probColor =
            winProb > 0.5 ? '#00ddbb' : winProb > 0.35 ? '#ffaa00' : '#ff6644';

          return (
            <div
              key={f.id}
              className="flex items-center justify-between bg-white/[0.02] border border-white/[0.05] rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-[180px]">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded tracking-wider ${
                    isHome
                      ? 'bg-teal-500/15 text-teal-400'
                      : 'bg-white/[0.06] text-white/40'
                  }`}
                >
                  {isHome ? 'HOME' : 'AWAY'}
                </span>
                <span className="font-medium text-sm">
                  vs {getTeamName(opp)}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-24 h-2 rounded-sm bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-sm transition-all duration-500"
                    style={{
                      width: `${winProb * 100}%`,
                      background: probColor,
                    }}
                  />
                </div>
                <span
                  className="text-sm font-bold font-oswald min-w-[3rem] text-right"
                  style={{ color: probColor }}
                >
                  {(winProb * 100).toFixed(0)}%
                </span>
                {f.probSource === 'elo_estimated' && (
                  <span className="text-[9px] text-white/25 tracking-wider">
                    EST
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

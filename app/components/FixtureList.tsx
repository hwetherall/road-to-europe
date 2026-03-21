'use client';

import { Fixture, Team } from '@/lib/types';

interface Props {
  fixtures: Fixture[];
  selectedTeam: string;
  teams: Team[];
  accentColor: string;
}

function getTeamName(abbr: string, teams: Team[]): string {
  return teams.find((t) => t.abbr === abbr)?.name ?? abbr;
}

export default function FixtureList({ fixtures, selectedTeam, teams, accentColor }: Props) {
  const teamFixtures = fixtures.filter(
    (f) => f.status === 'SCHEDULED' && (f.homeTeam === selectedTeam || f.awayTeam === selectedTeam)
  );

  if (teamFixtures.length === 0) return null;

  const teamName = getTeamName(selectedTeam, teams);

  return (
    <div className="mb-8">
      <h2 className="font-oswald text-sm tracking-[0.15em] uppercase text-white/50 mb-4">
        {teamName} Remaining Fixtures
      </h2>
      <div className="flex flex-col gap-1.5">
        {teamFixtures.map((f) => {
          const isHome = f.homeTeam === selectedTeam;
          const opp = isHome ? f.awayTeam : f.homeTeam;
          const winProb = isHome ? (f.homeWinProb ?? 0.4) : (f.awayWinProb ?? 0.3);
          const probColor =
            winProb > 0.5 ? accentColor : winProb > 0.35 ? '#ffaa00' : '#ff6644';

          return (
            <div
              key={f.id}
              className="flex items-center justify-between bg-white/[0.02] border border-white/[0.05] rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-[180px]">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wider"
                  style={
                    isHome
                      ? { background: `${accentColor}22`, color: accentColor }
                      : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)' }
                  }
                >
                  {isHome ? 'HOME' : 'AWAY'}
                </span>
                <span className="font-medium text-sm">
                  vs {getTeamName(opp, teams)}
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

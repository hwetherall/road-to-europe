'use client';

import { Fixture, Team } from '@/lib/types';

interface Props {
  fixtures: Fixture[];
  selectedTeam: string;
  teams: Team[];
  accentColor: string;
  textAccentColor: string;
}

function getTeamName(abbr: string, teams: Team[]): string {
  return teams.find((t) => t.abbr === abbr)?.name ?? abbr;
}

function getTeamPerspectiveProbs(fixture: Fixture, isHome: boolean) {
  const rawHome = fixture.homeWinProb ?? 0.4;
  const rawDraw = fixture.drawProb ?? 0.25;
  const rawAway = fixture.awayWinProb ?? 0.35;
  const total = rawHome + rawDraw + rawAway || 1;

  const home = rawHome / total;
  const draw = rawDraw / total;
  const away = rawAway / total;

  if (isHome) {
    return { win: home, draw, lose: away };
  }
  return { win: away, draw, lose: home };
}

export default function FixtureList({ fixtures, selectedTeam, teams, accentColor, textAccentColor }: Props) {
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
      <p className="text-xs text-white/35 mb-3">
        <span className="text-emerald-300/60">LIVE</span> = current bookmaker odds &middot;{' '}
        <span className="text-blue-300/55">SNAP</span> = from a previous odds snapshot &middot;{' '}
        <span className="text-white/40">EST</span> = Elo-estimated (bookmakers haven&apos;t listed these yet)
      </p>
      <div className="flex flex-col gap-1.5">
        {teamFixtures.map((f) => {
          const isHome = f.homeTeam === selectedTeam;
          const opp = isHome ? f.awayTeam : f.homeTeam;
          const probs = getTeamPerspectiveProbs(f, isHome);
          const winProb = probs.win;
          const drawProb = probs.draw;
          const loseProb = probs.lose;
          const winColor = winProb > 0.5 ? accentColor : winProb > 0.35 ? '#ffaa00' : '#ff6644';

          return (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 bg-white/[0.02] border border-white/[0.05] rounded-lg px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-[180px]">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wider"
                  style={
                    isHome
                      ? { background: `${accentColor}22`, color: textAccentColor }
                      : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)' }
                  }
                >
                  {isHome ? 'HOME' : 'AWAY'}
                </span>
                <span className="font-medium text-sm">
                  vs {getTeamName(opp, teams)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="grid grid-cols-3 gap-2 min-w-[260px]">
                  <div className="text-right">
                    <div className="text-[9px] tracking-wider text-white/35 uppercase">Win</div>
                    <div className="text-sm font-bold font-oswald" style={{ color: winColor }}>
                      {(winProb * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] tracking-wider text-white/35 uppercase">Draw</div>
                    <div className="text-sm font-bold font-oswald text-white/65">
                      {(drawProb * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] tracking-wider text-white/35 uppercase">Lose</div>
                    <div className="text-sm font-bold font-oswald text-red-400/90">
                      {(loseProb * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
                {f.probSource === 'elo_estimated' && (
                  <span className="text-[9px] text-white/35 tracking-wider border border-white/10 rounded px-1.5 py-0.5" title="Estimated from Elo ratings — no bookmaker odds available yet">
                    EST
                  </span>
                )}
                {f.probSource === 'odds_stored' && (
                  <span className="text-[9px] text-blue-300/65 tracking-wider border border-blue-300/20 rounded px-1.5 py-0.5" title="From stored bookmaker odds snapshot — not currently listed by bookmakers">
                    SNAP
                  </span>
                )}
                {f.probSource === 'odds_api' && (
                  <span className="text-[9px] text-emerald-300/75 tracking-wider border border-emerald-300/20 rounded px-1.5 py-0.5" title="Live bookmaker odds">
                    LIVE
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

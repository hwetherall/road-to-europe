export function oddsToProb(homeOdds: number, drawOdds: number, awayOdds: number) {
  const rawHome = 1 / homeOdds;
  const rawDraw = 1 / drawOdds;
  const rawAway = 1 / awayOdds;
  const overround = rawHome + rawDraw + rawAway;

  return {
    homeWin: rawHome / overround,
    draw: rawDraw / overround,
    awayWin: rawAway / overround,
  };
}

export function averageBookmakerOdds(
  bookmakers: Array<{ homeOdds: number; drawOdds: number; awayOdds: number }>
) {
  if (bookmakers.length === 0) return null;

  const probs = bookmakers.map((b) => oddsToProb(b.homeOdds, b.drawOdds, b.awayOdds));
  const n = probs.length;

  const avg = {
    homeWin: probs.reduce((s, p) => s + p.homeWin, 0) / n,
    draw: probs.reduce((s, p) => s + p.draw, 0) / n,
    awayWin: probs.reduce((s, p) => s + p.awayWin, 0) / n,
  };

  // Re-normalise after averaging
  const total = avg.homeWin + avg.draw + avg.awayWin;
  return {
    homeWin: avg.homeWin / total,
    draw: avg.draw / total,
    awayWin: avg.awayWin / total,
  };
}

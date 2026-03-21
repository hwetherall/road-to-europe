import { useState, useCallback, useMemo } from "react";

// ──────────────────────────────────────────────
// DATA: Real EPL standings as of March 21 2026
// ──────────────────────────────────────────────
const TEAMS = [
  { abbr: "ARS", name: "Arsenal", pts: 70, gd: 42, played: 31 },
  { abbr: "MCI", name: "Man City", pts: 61, gd: 31, played: 30 },
  { abbr: "MUN", name: "Man United", pts: 55, gd: 18, played: 31 },
  { abbr: "AVL", name: "Aston Villa", pts: 51, gd: 12, played: 30 },
  { abbr: "CFC", name: "Chelsea", pts: 49, gd: 14, played: 31 },
  { abbr: "LFC", name: "Liverpool", pts: 49, gd: 10, played: 31 },
  { abbr: "BRE", name: "Brentford", pts: 45, gd: 4, played: 30 },
  { abbr: "FUL", name: "Fulham", pts: 44, gd: 2, played: 31 },
  { abbr: "EVE", name: "Everton", pts: 44, gd: 5, played: 31 },
  { abbr: "BRI", name: "Brighton", pts: 43, gd: 3, played: 31 },
  { abbr: "NEW", name: "Newcastle", pts: 42, gd: 1, played: 30 },
  { abbr: "BOU", name: "Bournemouth", pts: 42, gd: -2, played: 31 },
  { abbr: "SUN", name: "Sunderland", pts: 40, gd: -1, played: 30 },
  { abbr: "CRY", name: "Crystal Palace", pts: 39, gd: -5, played: 30 },
  { abbr: "LEE", name: "Leeds", pts: 32, gd: -12, played: 30 },
  { abbr: "TOT", name: "Tottenham", pts: 30, gd: -14, played: 30 },
  { abbr: "NFO", name: "Nott'm Forest", pts: 29, gd: -19, played: 30 },
  { abbr: "WHU", name: "West Ham", pts: 29, gd: -21, played: 30 },
  { abbr: "BUR", name: "Burnley", pts: 20, gd: -30, played: 31 },
  { abbr: "WOL", name: "Wolves", pts: 17, gd: -38, played: 31 },
];

// Known upcoming fixtures with SportRadar win probabilities
const KNOWN_FIXTURES = [
  { home: "EVE", away: "CFC", hWin: 0.325, draw: 0.278, aWin: 0.397 },
  { home: "LEE", away: "BRE", hWin: 0.388, draw: 0.278, aWin: 0.334 },
  { home: "NEW", away: "SUN", hWin: 0.571, draw: 0.241, aWin: 0.188 },
  { home: "AVL", away: "WHU", hWin: 0.495, draw: 0.261, aWin: 0.244 },
  { home: "TOT", away: "NFO", hWin: 0.418, draw: 0.279, aWin: 0.303 },
  { home: "WHU", away: "WOL", hWin: 0.538, draw: 0.245, aWin: 0.217 },
  { home: "ARS", away: "BOU", hWin: 0.719, draw: 0.172, aWin: 0.109 },
  { home: "BRE", away: "EVE", hWin: 0.445, draw: 0.279, aWin: 0.276 },
  { home: "BUR", away: "BRI", hWin: 0.222, draw: 0.250, aWin: 0.528 },
  { home: "LFC", away: "FUL", hWin: 0.629, draw: 0.201, aWin: 0.170 },
  { home: "CRY", away: "NEW", hWin: 0.341, draw: 0.272, aWin: 0.387 },
];

// Generate remaining fixtures based on team strength
function generateRemainingFixtures(teams) {
  const strength = {};
  teams.forEach(t => { strength[t.abbr] = t.pts / t.played; });

  const knownSet = new Set(KNOWN_FIXTURES.map(f => `${f.home}-${f.away}`));
  const gamesNeeded = {};
  teams.forEach(t => { gamesNeeded[t.abbr] = 38 - t.played; });

  // Subtract known fixtures
  KNOWN_FIXTURES.forEach(f => {
    if (gamesNeeded[f.home] > 0) gamesNeeded[f.home]--;
    if (gamesNeeded[f.away] > 0) gamesNeeded[f.away]--;
  });

  const generated = [];
  const abbrs = teams.map(t => t.abbr);

  // Generate plausible fixtures to fill remaining games
  for (let i = 0; i < abbrs.length; i++) {
    for (let j = i + 1; j < abbrs.length; j++) {
      const a = abbrs[i], b = abbrs[j];
      if (knownSet.has(`${a}-${b}`) || knownSet.has(`${b}-${a}`)) continue;
      if (gamesNeeded[a] <= 0 || gamesNeeded[b] <= 0) continue;

      const home = Math.random() > 0.5 ? a : b;
      const away = home === a ? b : a;
      const hStr = strength[home], aStr = strength[away];
      const total = hStr + aStr;
      const hAdv = 0.08; // home advantage
      const hWin = Math.min(0.85, Math.max(0.08, (hStr / total) + hAdv));
      const aWin = Math.min(0.85, Math.max(0.08, (aStr / total) - hAdv));
      const drawBase = 1 - hWin - aWin;
      const draw = Math.max(0.07, drawBase);
      const norm = hWin + aWin + draw;

      generated.push({
        home, away,
        hWin: hWin / norm,
        draw: draw / norm,
        aWin: aWin / norm,
        estimated: true,
      });
      gamesNeeded[home]--;
      gamesNeeded[away]--;
    }
  }
  return generated;
}

// ──────────────────────────────────────────────
// MONTE CARLO ENGINE
// ──────────────────────────────────────────────
function runSimulation(teams, fixtures, numSims = 10000) {
  const positionCounts = {};
  const europeCounts = {};
  teams.forEach(t => {
    positionCounts[t.abbr] = new Array(20).fill(0);
    europeCounts[t.abbr] = { top4: 0, top5: 0, top6: 0, top7: 0, relegation: 0 };
  });

  for (let sim = 0; sim < numSims; sim++) {
    const points = {};
    const gdSim = {};
    teams.forEach(t => {
      points[t.abbr] = t.pts;
      gdSim[t.abbr] = t.gd;
    });

    fixtures.forEach(f => {
      const rand = Math.random();
      if (rand < f.hWin) {
        points[f.home] += 3;
        gdSim[f.home] += 1;
        gdSim[f.away] -= 1;
      } else if (rand < f.hWin + f.draw) {
        points[f.home] += 1;
        points[f.away] += 1;
      } else {
        points[f.away] += 3;
        gdSim[f.away] += 1;
        gdSim[f.home] -= 1;
      }
    });

    const sorted = teams.map(t => ({
      abbr: t.abbr,
      pts: points[t.abbr],
      gd: gdSim[t.abbr],
    })).sort((a, b) => b.pts - a.pts || b.gd - a.gd);

    sorted.forEach((t, i) => {
      positionCounts[t.abbr][i]++;
      if (i < 4) europeCounts[t.abbr].top4++;
      if (i < 5) europeCounts[t.abbr].top5++;
      if (i < 6) europeCounts[t.abbr].top6++;
      if (i < 7) europeCounts[t.abbr].top7++;
      if (i >= 17) europeCounts[t.abbr].relegation++;
    });
  }

  return { positionCounts, europeCounts, numSims };
}

// ──────────────────────────────────────────────
// COMPONENTS
// ──────────────────────────────────────────────
const pct = (n, total) => ((n / total) * 100).toFixed(1);
const barStyle = (val) => ({
  width: `${Math.min(val, 100)}%`,
  height: "100%",
  borderRadius: 2,
  transition: "width 0.6s cubic-bezier(.22,1,.36,1)",
});

function OddsBar({ value, color = "#fff", bg = "rgba(255,255,255,0.08)" }) {
  return (
    <div style={{ height: 8, borderRadius: 3, background: bg, overflow: "hidden", width: "100%" }}>
      <div style={{ ...barStyle(value), background: color }} />
    </div>
  );
}

function QualCard({ label, value, icon, color, sub }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12,
      padding: "20px 16px",
      textAlign: "center",
      flex: 1,
      minWidth: 130,
    }}>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 4, letterSpacing: 1, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 10 }}>{sub}</div>
      <div style={{ fontSize: 36, fontWeight: 800, color, fontFamily: "'Oswald', sans-serif", lineHeight: 1 }}>
        {value}%
      </div>
      <div style={{ marginTop: 10 }}>
        <OddsBar value={parseFloat(value)} color={color} />
      </div>
    </div>
  );
}

export default function NewcastleSimulator() {
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [simCount, setSimCount] = useState(10000);
  const [showTable, setShowTable] = useState(false);

  const allFixtures = useMemo(() => {
    return [...KNOWN_FIXTURES, ...generateRemainingFixtures(TEAMS)];
  }, []);

  const newcastleFixtures = useMemo(() =>
    allFixtures.filter(f => f.home === "NEW" || f.away === "NEW"),
  [allFixtures]);

  const simulate = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      const res = runSimulation(TEAMS, allFixtures, simCount);
      setResults(res);
      setRunning(false);
    }, 50);
  }, [allFixtures, simCount]);

  const newOdds = results?.europeCounts?.NEW;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#fff",
      fontFamily: "'Inter', -apple-system, sans-serif",
      padding: 0,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #000 0%, #1a1a1a 50%, #000 100%)",
        borderBottom: "2px solid rgba(255,255,255,0.06)",
        padding: "32px 24px 28px",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -40, right: -40, width: 200, height: 200,
          background: "radial-gradient(circle, rgba(0,170,170,0.1) 0%, transparent 70%)",
        }} />
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 8,
              background: "linear-gradient(135deg, #fff 50%, #000 50%)",
              border: "2px solid rgba(255,255,255,0.2)",
            }} />
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontFamily: "'Oswald', sans-serif", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>
                Newcastle United
              </h1>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 2, textTransform: "uppercase" }}>
                European Qualification Simulator
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 16, fontSize: 13 }}>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>Position: <span style={{ color: "#fff", fontWeight: 600 }}>11th</span></span>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>Points: <span style={{ color: "#fff", fontWeight: 600 }}>42</span></span>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>GD: <span style={{ color: "#fff", fontWeight: 600 }}>+1</span></span>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>Remaining: <span style={{ color: "#fff", fontWeight: 600 }}>8 games</span></span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>

        {/* Simulate Button */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
          <button
            onClick={simulate}
            disabled={running}
            style={{
              background: running ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #00aaaa, #008888)",
              color: "#fff",
              border: "none",
              padding: "14px 32px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "'Oswald', sans-serif",
              letterSpacing: 1.5,
              textTransform: "uppercase",
              cursor: running ? "wait" : "pointer",
              transition: "all 0.2s",
            }}
          >
            {running ? "Simulating..." : results ? "↻ Re-run Simulation" : "▶ Run Simulation"}
          </button>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
            {simCount.toLocaleString()} Monte Carlo simulations × {allFixtures.length} remaining fixtures
          </div>
        </div>

        {/* Results Cards */}
        {newOdds && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>
              Qualification Odds
            </h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <QualCard label="Champions League" sub="Top 4" value={pct(newOdds.top4, results.numSims)} color="#FFD700" />
              <QualCard label="UCL (expanded)" sub="Top 5" value={pct(newOdds.top5, results.numSims)} color="#C0C0C0" />
              <QualCard label="Europa League" sub="Top 6" value={pct(newOdds.top6, results.numSims)} color="#FF6B35" />
              <QualCard label="Any Europe" sub="Top 7" value={pct(newOdds.top7, results.numSims)} color="#00CCAA" />
            </div>
          </div>
        )}

        {/* Full Table Toggle */}
        {results && (
          <div style={{ marginBottom: 28 }}>
            <button
              onClick={() => setShowTable(!showTable)}
              style={{
                background: "none", border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.6)", padding: "8px 18px", borderRadius: 6,
                fontSize: 12, cursor: "pointer", letterSpacing: 1, textTransform: "uppercase",
              }}
            >
              {showTable ? "Hide" : "Show"} Full League Projections
            </button>
          </div>
        )}

        {showTable && results && (
          <div style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            overflow: "hidden",
            marginBottom: 32,
          }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {["#", "Team", "Pts", "Top 4", "Top 5", "Top 6", "Top 7", "Releg."].map(h => (
                      <th key={h} style={{
                        padding: "12px 10px", textAlign: h === "Team" ? "left" : "center",
                        color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: 1.2,
                        textTransform: "uppercase", fontWeight: 600,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TEAMS.map((t, i) => {
                    const e = results.europeCounts[t.abbr];
                    const isNew = t.abbr === "NEW";
                    return (
                      <tr key={t.abbr} style={{
                        background: isNew ? "rgba(0,170,170,0.08)" : "transparent",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}>
                        <td style={{ padding: "10px", textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 12 }}>{i + 1}</td>
                        <td style={{ padding: "10px", fontWeight: isNew ? 700 : 400, color: isNew ? "#00ddbb" : "rgba(255,255,255,0.8)" }}>
                          {t.name}
                        </td>
                        <td style={{ padding: "10px", textAlign: "center", fontWeight: 600 }}>{t.pts}</td>
                        {[e.top4, e.top5, e.top6, e.top7].map((v, j) => (
                          <td key={j} style={{ padding: "10px", textAlign: "center", color: v / results.numSims > 0.5 ? "#00ddbb" : "rgba(255,255,255,0.5)" }}>
                            {pct(v, results.numSims)}%
                          </td>
                        ))}
                        <td style={{ padding: "10px", textAlign: "center", color: e.relegation / results.numSims > 0.3 ? "#ff4444" : "rgba(255,255,255,0.35)" }}>
                          {pct(e.relegation, results.numSims)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Newcastle Upcoming Fixtures */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>
            Newcastle Remaining Fixtures
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {newcastleFixtures.map((f, i) => {
              const isHome = f.home === "NEW";
              const opp = isHome ? f.away : f.home;
              const oppTeam = TEAMS.find(t => t.abbr === opp);
              const winProb = isHome ? f.hWin : f.aWin;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 8, padding: "12px 16px",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 180 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                      background: isHome ? "rgba(0,170,170,0.15)" : "rgba(255,255,255,0.06)",
                      color: isHome ? "#00ddbb" : "rgba(255,255,255,0.4)",
                      letterSpacing: 1,
                    }}>{isHome ? "HOME" : "AWAY"}</span>
                    <span style={{ fontWeight: 500 }}>vs {oppTeam?.name || opp}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 100 }}>
                      <OddsBar value={winProb * 100} color={winProb > 0.5 ? "#00ddbb" : winProb > 0.35 ? "#ffaa00" : "#ff6644"} />
                    </div>
                    <span style={{
                      fontSize: 14, fontWeight: 700, fontFamily: "'Oswald', sans-serif",
                      color: winProb > 0.5 ? "#00ddbb" : winProb > 0.35 ? "#ffaa00" : "#ff6644",
                      minWidth: 48, textAlign: "right",
                    }}>
                      {(winProb * 100).toFixed(0)}%
                    </span>
                    {f.estimated && (
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: 0.5 }}>EST</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Current Standings */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>
            Current Standings
          </h2>
          <div style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12, overflow: "hidden",
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["#", "Team", "P", "Pts", "GD"].map(h => (
                    <th key={h} style={{
                      padding: "10px 12px", textAlign: h === "Team" ? "left" : "center",
                      color: "rgba(255,255,255,0.35)", fontSize: 10, letterSpacing: 1.2,
                      textTransform: "uppercase", fontWeight: 600,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TEAMS.map((t, i) => {
                  const isNew = t.abbr === "NEW";
                  const zone = i < 4 ? "ucl" : i < 5 ? "ucl5" : i < 6 ? "uel" : i < 7 ? "uecl" : i >= 17 ? "rel" : null;
                  const zoneColors = { ucl: "#1a3a1a", ucl5: "#1a2a3a", uel: "#3a2a1a", uecl: "#1a3a3a", rel: "#3a1a1a" };
                  return (
                    <tr key={t.abbr} style={{
                      background: isNew ? "rgba(0,170,170,0.08)" : (zone ? zoneColors[zone] : "transparent"),
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      borderLeft: isNew ? "3px solid #00aaaa" : "3px solid transparent",
                    }}>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 12 }}>{i + 1}</td>
                      <td style={{ padding: "10px 12px", fontWeight: isNew ? 700 : 400, color: isNew ? "#00ddbb" : "rgba(255,255,255,0.85)" }}>{t.name}</td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: "rgba(255,255,255,0.4)" }}>{t.played}</td>
                      <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>{t.pts}</td>
                      <td style={{ padding: "10px 12px", textAlign: "center", color: t.gd > 0 ? "#00ddbb" : t.gd < 0 ? "#ff6644" : "rgba(255,255,255,0.4)" }}>
                        {t.gd > 0 ? "+" : ""}{t.gd}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.3)", flexWrap: "wrap" }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#1a3a1a", borderRadius: 2, marginRight: 4 }} /> Champions League</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#1a2a3a", borderRadius: 2, marginRight: 4 }} /> UCL (5th)</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#3a2a1a", borderRadius: 2, marginRight: 4 }} /> Europa League</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#1a3a3a", borderRadius: 2, marginRight: 4 }} /> Conference League</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#3a1a1a", borderRadius: 2, marginRight: 4 }} /> Relegation</span>
          </div>
        </div>

        {/* Methodology Note */}
        <div style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12, padding: 20, marginBottom: 32,
          fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.8,
        }}>
          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
            Methodology
          </div>
          Monte Carlo simulation of {simCount.toLocaleString()} season outcomes. Match probabilities sourced from SportRadar for known fixtures (marked with win %), and estimated from points-per-game with home advantage adjustment for unannounced fixtures (marked EST).
          Each simulation randomly resolves all remaining matches, calculates final standings, and records finishing positions. Goal difference is simplified (±1 per result) as a tiebreaker proxy.
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.25)", fontStyle: "italic" }}>
            V1 Prototype — Standings as of March 21, 2026. European places assume standard allocation (no cup winners adjustments).
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Team } from '@/lib/types';

interface OddsSnapshot {
  id: string;
  market: string;
  team: string;
  opponent: string | null;
  odds_decimal: number | null;
  implied_prob: number;
  snapshot_at: string;
  matchday: number | null;
}

interface Props {
  selectedTeam: string;
  teams: Team[];
  accentColor: string;
}

type MarketFilter = 'h2h';

const TEAM_COLORS: Record<string, string> = {
  ARS: '#EF0107', MCI: '#6CABDD', MUN: '#DA291C', AVL: '#95BFE5',
  CFC: '#034694', LFC: '#C8102E', BRE: '#E30613', FUL: '#000000',
  EVE: '#003399', BRI: '#0057B8', NEW: '#241F20', BOU: '#DA291C',
  SUN: '#EB172B', CRY: '#1B458F', LEE: '#FFCD00', TOT: '#132257',
  NFO: '#DD0000', WHU: '#7A263A', BUR: '#6C1D45', WOL: '#FDB913',
};

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function OddsMovementChart({ selectedTeam, teams, accentColor }: Props) {
  const [snapshots, setSnapshots] = useState<OddsSnapshot[]>([]);
  const market: MarketFilter = 'h2h';
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/odds/history?market=${market}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSnapshots(data.snapshots ?? []);
      })
      .catch(() => {
        if (!cancelled) setSnapshots([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [market]);

  // Build chart data: pivot snapshots into { date, ARS: prob, MCI: prob, ... }
  const { chartData, teamsInData } = useMemo(() => {
    if (snapshots.length === 0) return { chartData: [], teamsInData: [] };

    const dateTeamMap = new Map<string, Record<string, number>>();
    const teamSet = new Set<string>();

    for (const snap of snapshots) {
      const dateKey = snap.snapshot_at.split('T')[0];
      teamSet.add(snap.team);

      if (!dateTeamMap.has(dateKey)) {
        dateTeamMap.set(dateKey, { date: dateKey } as unknown as Record<string, number>);
      }
      const row = dateTeamMap.get(dateKey)!;
      row[snap.team] = snap.implied_prob;
    }

    const allTeams = Array.from(teamSet).sort();
    const data = Array.from(dateTeamMap.values()).sort((a, b) =>
      String(a.date ?? '').localeCompare(String(b.date ?? ''))
    );

    return { chartData: data, teamsInData: allTeams };
  }, [snapshots]);

  const visibleTeams = teamsInData.filter((t) => t === selectedTeam);

  // Detect significant moves for the selected team
  const alerts = useMemo(() => {
    if (chartData.length < 2) return [];
    const result: string[] = [];

    for (let i = 1; i < chartData.length; i++) {
      const prev = chartData[i - 1][selectedTeam] as number | undefined;
      const curr = chartData[i][selectedTeam] as number | undefined;
      if (prev === undefined || curr === undefined) continue;

      const shift = Math.abs(curr - prev);
      if (shift > 0.10) {
        const direction = curr > prev ? 'up' : 'down';
        const dateStr = String(chartData[i].date ?? '');
        result.push(
          `${formatDate(dateStr)}: ${formatPct(prev)} → ${formatPct(curr)} (${direction} ${formatPct(shift)})`
        );
      }
    }
    return result;
  }, [chartData, selectedTeam]);

  const teamName = teams.find((t) => t.abbr === selectedTeam)?.name ?? selectedTeam;

  return (
    <div className="mb-8 bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="font-oswald text-[13px] tracking-widest uppercase text-white/50 mb-1">
            Odds Movement
          </div>
          <div className="text-[11px] text-white/35">
            Bookmaker implied probability over time
          </div>
        </div>

      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-white/30 text-sm">
          Loading odds data...
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-white/30 text-sm">
          <div className="mb-2">No odds history available yet</div>
          <div className="text-[11px] text-white/20">
            Snapshots are recorded daily at 06:30 UTC. Data will appear after the first cron run.
          </div>
        </div>
      ) : (
        <div className="w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="date"
                tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
                tickFormatter={(v: string) => formatDate(v)}
                stroke="rgba(255,255,255,0.1)"
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
                tickFormatter={(v: number) => formatPct(v)}
                stroke="rgba(255,255,255,0.1)"
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(15,15,20,0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.8)',
                }}
                formatter={(value: unknown, name: unknown) => [
                  formatPct(Number(value)),
                  teams.find((t) => t.abbr === String(name))?.name ?? String(name),
                ]}
                labelFormatter={(label: unknown) => formatDate(String(label))}
              />
              {visibleTeams.length > 1 && (
                <Legend
                  formatter={(value: string) => teams.find((t) => t.abbr === value)?.name ?? value}
                  wrapperStyle={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}
                />
              )}
              {visibleTeams.map((teamAbbr) => (
                <Line
                  key={teamAbbr}
                  type="monotone"
                  dataKey={teamAbbr}
                  stroke={teamAbbr === selectedTeam ? accentColor : (TEAM_COLORS[teamAbbr] ?? '#888')}
                  strokeWidth={teamAbbr === selectedTeam ? 2.5 : 1}
                  dot={false}
                  strokeOpacity={teamAbbr === selectedTeam ? 1 : 0.5}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Significant movement alerts */}
      {alerts.length > 0 && (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <div className="text-[10px] font-oswald tracking-widest uppercase text-amber-400/70 mb-2">
            Significant Moves ({teamName})
          </div>
          {alerts.map((alert, i) => (
            <div key={i} className="text-[11px] text-white/50 mb-1 flex items-center gap-2">
              <span className="text-amber-400">&#9888;</span>
              {alert}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Team } from '@/lib/types';

interface PaperBet {
  id: string;
  team: string;
  market: string;
  model_prob: number;
  bookmaker_odds: number;
  bookmaker_implied_prob: number;
  edge: number;
  stake: number;
  expected_value: number;
  status: string;
  pnl: number | null;
  placed_at: string;
  settled_at: string | null;
  season: string;
  matchday: number | null;
}

interface Summary {
  totalBets: number;
  openBets: number;
  settledBets: number;
  totalStaked: number;
  totalPnl: number;
  openExpectedValue: number;
  roi: number;
  avgEdge: number;
}

interface Props {
  teams: Team[];
  accentColor: string;
}

const MARKET_LABELS: Record<string, string> = {
  h2h_win: 'Match Win',
  outright_winner: 'League Winner',
  outright_relegation: 'Relegation',
};

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMoney(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}$${value.toFixed(2)}`;
}

function formatDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ValueBetTracker({ teams, accentColor }: Props) {
  const [bets, setBets] = useState<PaperBet[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch('/api/value-bets?season=2025-26')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setBets(data.bets ?? []);
          setSummary(data.summary ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBets([]);
          setSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  const teamName = (abbr: string) => teams.find((t) => t.abbr === abbr)?.name ?? abbr;

  if (loading) {
    return (
      <div className="mb-8 bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
        <div className="font-oswald text-[13px] tracking-widest uppercase text-white/50 mb-4">
          Value Bet Tracker
        </div>
        <div className="text-white/30 text-sm py-8 text-center">Loading paper bets...</div>
      </div>
    );
  }

  if (bets.length === 0) {
    return (
      <div className="mb-8 bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
        <div className="font-oswald text-[13px] tracking-widest uppercase text-white/50 mb-2">
          Value Bet Tracker
        </div>
        <div className="text-[11px] text-white/35 mb-4">
          Paper bets are placed when the model identifies a 5%+ edge over bookmaker match odds
        </div>
        <div className="text-white/30 text-sm py-8 text-center flex flex-col items-center">
          <div className="mb-2">No paper bets recorded yet</div>
          <div className="text-[11px] text-white/20 max-w-md">
            Bets are automatically placed during the daily odds snapshot when our model&apos;s
            win probability exceeds the bookmaker implied probability by at least 5%.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="font-oswald text-[13px] tracking-widest uppercase text-white/50 mb-1">
            Value Bet Tracker
          </div>
          <div className="text-[11px] text-white/35">
            Paper bets at $100 stake when model edge exceeds 5%
          </div>
        </div>
        <div className="text-[10px] font-oswald tracking-widest uppercase text-white/30">
          Season 2025-26
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <SummaryCard label="Total Bets" value={String(summary.totalBets)} />
          <SummaryCard label="Open Bets" value={String(summary.openBets)} />
          <SummaryCard
            label="Settled P&L"
            value={formatMoney(summary.totalPnl)}
            valueColor={summary.totalPnl >= 0 ? '#22c55e' : '#ef4444'}
          />
          <SummaryCard
            label="Open EV"
            value={formatMoney(summary.openExpectedValue)}
            valueColor={summary.openExpectedValue >= 0 ? '#22c55e' : '#ef4444'}
          />
          <SummaryCard label="Total Staked" value={`$${summary.totalStaked.toFixed(0)}`} />
          <SummaryCard
            label="ROI (Settled)"
            value={`${summary.roi.toFixed(1)}%`}
            valueColor={summary.roi >= 0 ? '#22c55e' : '#ef4444'}
          />
          <SummaryCard label="Avg Edge" value={`${summary.avgEdge.toFixed(1)}%`} />
          <SummaryCard label="Settled" value={String(summary.settledBets)} />
        </div>
      )}

      {/* Thesis callout */}
      <div
        className="rounded-lg border px-4 py-3 mb-4 text-[11px] leading-5"
        style={{ borderColor: `${accentColor}25`, background: `${accentColor}08`, color: 'rgba(255,255,255,0.5)' }}
      >
        <strong className="text-white/70">Paper betting thesis:</strong> Whenever our model assigns a
        match win probability at least 5 percentage points higher than the bookmaker implies,
        place a $100 paper bet. Over the season, the P&L reveals whether our model
        systematically identifies value against the market.
      </div>

      {/* Bet table */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="bg-transparent border border-white/[0.12] text-white/60 px-4 py-1.5 rounded-md text-[10px] tracking-widest uppercase cursor-pointer hover:border-white/20 transition-colors mb-4"
      >
        {expanded ? 'Hide' : 'Show'} All Bets ({bets.length})
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                {['Date', 'Team', 'Market', 'Model', 'Book', 'Edge', 'Odds', 'EV', 'Status', 'P&L'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-2 py-2.5 text-[9px] tracking-widest uppercase font-semibold text-white/40 text-center whitespace-nowrap"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => (
                <tr
                  key={bet.id}
                  className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-2 py-2 text-[11px] text-white/50 text-center whitespace-nowrap">
                    {formatDate(bet.placed_at)}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-white/70 text-center font-medium">
                    {teamName(bet.team)}
                  </td>
                  <td className="px-2 py-2 text-[10px] text-white/40 text-center uppercase">
                    {MARKET_LABELS[bet.market] ?? bet.market}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-white/60 text-center">
                    {formatPct(bet.model_prob)}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-white/60 text-center">
                    {formatPct(bet.bookmaker_implied_prob)}
                  </td>
                  <td
                    className="px-2 py-2 text-[11px] text-center font-medium"
                    style={{ color: '#22c55e' }}
                  >
                    +{formatPct(bet.edge)}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-white/60 text-center">
                    {bet.bookmaker_odds.toFixed(2)}
                  </td>
                  <td
                    className="px-2 py-2 text-[11px] text-center font-medium"
                    style={{ color: bet.expected_value >= 0 ? '#22c55e' : '#ef4444' }}
                  >
                    {formatMoney(bet.expected_value)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <StatusBadge status={bet.status} />
                  </td>
                  <td
                    className="px-2 py-2 text-[11px] text-center font-medium"
                    style={{
                      color: bet.pnl === null
                        ? 'rgba(255,255,255,0.3)'
                        : bet.pnl >= 0
                        ? '#22c55e'
                        : '#ef4444',
                    }}
                  >
                    {bet.pnl !== null ? formatMoney(bet.pnl) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2.5">
      <div className="text-[9px] font-oswald tracking-widest uppercase text-white/35 mb-1">
        {label}
      </div>
      <div
        className="text-[15px] font-semibold"
        style={{ color: valueColor ?? 'rgba(255,255,255,0.75)' }}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    open: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
    won: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e' },
    lost: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
    void: { bg: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.4)' },
  };
  const c = colors[status] ?? colors.void;

  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-[9px] font-oswald tracking-widest uppercase font-semibold"
      style={{ background: c.bg, color: c.text }}
    >
      {status}
    </span>
  );
}

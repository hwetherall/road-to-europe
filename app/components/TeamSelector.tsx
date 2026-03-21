'use client';

import { Team } from '@/lib/types';
import { TEAM_COLOURS } from '@/lib/team-colours';

interface Props {
  teams: Team[];
  selectedTeam: string;
  onSelectTeam: (abbr: string) => void;
}

export default function TeamSelector({ teams, selectedTeam, onSelectTeam }: Props) {
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      {/* Desktop: Badge grid */}
      <div className="hidden md:flex flex-wrap gap-1.5 mt-4">
        {sorted.map((t) => {
          const isSelected = t.abbr === selectedTeam;
          const color = TEAM_COLOURS[t.abbr] ?? '#888';
          return (
            <button
              key={t.abbr}
              onClick={() => onSelectTeam(t.abbr)}
              title={t.name}
              className={`w-11 h-11 rounded-lg text-[10px] font-bold font-oswald tracking-wider transition-all border-2 cursor-pointer ${
                isSelected
                  ? 'scale-110 shadow-lg'
                  : 'border-white/10 hover:border-white/30 opacity-60 hover:opacity-100'
              }`}
              style={{
                background: isSelected ? color : `${color}33`,
                borderColor: isSelected ? color : undefined,
                color: isSelected ? '#fff' : 'rgba(255,255,255,0.7)',
              }}
            >
              {t.abbr}
            </button>
          );
        })}
      </div>

      {/* Mobile: Dropdown */}
      <div className="md:hidden mt-4">
        <select
          value={selectedTeam}
          onChange={(e) => onSelectTeam(e.target.value)}
          className="bg-white/[0.06] border border-white/[0.12] rounded-lg px-4 py-2.5 text-sm text-white w-full cursor-pointer appearance-none"
          style={{ backgroundImage: 'none' }}
        >
          {sorted.map((t) => (
            <option key={t.abbr} value={t.abbr} className="bg-[#1a1a1a]">
              {t.name} — {t.points} pts
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

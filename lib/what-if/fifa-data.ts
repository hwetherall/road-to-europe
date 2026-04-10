import fs from 'fs';
import path from 'path';
import { PlayerQuality } from './types';

// ── Club Name → Team Abbreviation Mapping ──
// FIFA/FC uses short club names; our system uses 3-letter abbreviations

const CLUB_TO_ABBR: Record<string, string> = {
  // Exact names from FC26 dataset
  'Arsenal': 'ARS',
  'Manchester City': 'MCI',
  'Manchester United': 'MUN',
  'Aston Villa': 'AVL',
  'Chelsea': 'CFC',
  'Liverpool': 'LFC',
  'Brentford': 'BRE',
  'Fulham FC': 'FUL',
  'Fulham': 'FUL',
  'Everton': 'EVE',
  'Brighton & Hove Albion': 'BRI',
  'Brighton': 'BRI',
  'Newcastle United': 'NEW',
  'Newcastle': 'NEW',
  'AFC Bournemouth': 'BOU',
  'Bournemouth': 'BOU',
  'Sunderland': 'SUN',
  'Crystal Palace': 'CRY',
  'Leeds United': 'LEE',
  'Leeds': 'LEE',
  'Tottenham Hotspur': 'TOT',
  'Tottenham': 'TOT',
  'Nottingham Forest': 'NFO',
  "Nott'm Forest": 'NFO',
  'West Ham United': 'WHU',
  'West Ham': 'WHU',
  'Burnley': 'BUR',
  'Wolverhampton Wanderers': 'WOL',
  'Wolves': 'WOL',
};

// Reverse map: abbreviation → canonical FIFA club name (first matching entry)
const ABBR_TO_CLUB: Record<string, string> = {};
for (const [club, abbr] of Object.entries(CLUB_TO_ABBR)) {
  if (!ABBR_TO_CLUB[abbr]) ABBR_TO_CLUB[abbr] = club;
}

export function getClubAbbr(clubName: string): string | undefined {
  return CLUB_TO_ABBR[clubName] ?? CLUB_TO_ABBR[clubName.replace(/ FC$/, '')];
}

export function getClubName(abbr: string): string | undefined {
  return ABBR_TO_CLUB[abbr];
}

// ── CSV Parsing ──

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

// ── Data Loading ──

let playerCache: PlayerQuality[] | null = null;

function num(val: string | undefined): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function mapRow(row: Record<string, string>): PlayerQuality {
  // FC26_20250921.csv column names (lowercase, underscore-separated)
  return {
    name: row['short_name'] || row['long_name'] || row['Name'] || row['LongName'] || '',
    overall: num(row['overall'] || row['Overall'] || row['OVA']),
    potential: num(row['potential'] || row['Potential'] || row['POT']),
    age: num(row['age'] || row['Age']),
    positions: (row['player_positions'] || row['Positions'] || row['Best Position'] || '')
      .split(/[,/]/)
      .map((p) => p.trim())
      .filter(Boolean),
    club: row['club_name'] || row['Club'] || '',
    valueEuro: num(row['value_eur'] || (row['Value'] || '0').replace(/[^0-9]/g, '')),
    wageEuro: num(row['wage_eur'] || (row['Wage'] || '0').replace(/[^0-9]/g, '')),
    pace: num(row['pace'] || row['PAC'] || row['Pace']),
    shooting: num(row['shooting'] || row['SHO'] || row['Shooting']),
    passing: num(row['passing'] || row['PAS'] || row['Passing']),
    dribbling: num(row['dribbling'] || row['DRI'] || row['Dribbling']),
    defending: num(row['defending'] || row['DEF'] || row['Defending']),
    physical: num(row['physic'] || row['PHY'] || row['Physicality'] || row['Physical']),
  };
}

function isEnglishPL(row: Record<string, string>): boolean {
  // league_id 13 = English Premier League (avoids Ukrainian PL which is also 'Premier League')
  if (row['league_id']) return Number(row['league_id']) === 13;
  return row['league_name'] === 'Premier League';
}

// Try multiple possible filenames
const CSV_FILENAMES = ['FC26_20250921.csv', 'fc26-players.csv'];

export async function loadFIFAData(): Promise<PlayerQuality[]> {
  if (playerCache) return playerCache;

  for (const filename of CSV_FILENAMES) {
    const csvPath = path.join(process.cwd(), 'data', filename);

    try {
      if (!fs.existsSync(csvPath)) continue;

      const csv = fs.readFileSync(csvPath, 'utf-8');
      const rows = parseCSV(csv);

      // Filter to PL players only (avoids loading 18K+ players)
      // but keep all players if league_name column isn't present
      const hasLeagueCol = rows.length > 0 && 'league_name' in rows[0];
      const filtered = hasLeagueCol ? rows.filter(isEnglishPL) : rows;

      playerCache = filtered
        .map(mapRow)
        .filter((p) => p.overall > 0 && p.club.length > 0);

      console.log(`[FIFA] Loaded ${playerCache.length} PL players from ${filename}`);
      return playerCache;
    } catch (e) {
      console.warn(`[FIFA] Error reading ${filename}:`, e instanceof Error ? e.message : e);
    }
  }

  console.warn('[FIFA] No CSV found, using empty dataset');
  playerCache = [];
  return playerCache;
}

// ── Query Functions ──

export async function getPlayersForClub(clubNameOrAbbr: string): Promise<PlayerQuality[]> {
  const players = await loadFIFAData();
  if (players.length === 0) return [];

  // Try direct match on abbreviation
  const abbrClubName = ABBR_TO_CLUB[clubNameOrAbbr];
  if (abbrClubName) {
    const result = players.filter((p) => p.club === abbrClubName || getClubAbbr(p.club) === clubNameOrAbbr);
    if (result.length > 0) return result;
  }

  // Try direct match on club name
  const byName = players.filter(
    (p) => p.club === clubNameOrAbbr || p.club.toLowerCase().includes(clubNameOrAbbr.toLowerCase())
  );
  return byName;
}

export async function lookupPlayer(name: string, fuzzy = true): Promise<PlayerQuality[]> {
  const players = await loadFIFAData();
  if (players.length === 0) return [];

  const lower = name.toLowerCase();

  // Exact match
  const exact = players.filter((p) => p.name.toLowerCase() === lower);
  if (exact.length > 0) return exact;

  if (!fuzzy) return [];

  // Contains match
  const contains = players.filter((p) => p.name.toLowerCase().includes(lower));
  if (contains.length > 0) return contains.slice(0, 5);

  // Last name match
  const lastNameMatches = players.filter((p) => {
    const parts = p.name.toLowerCase().split(/\s+/);
    return parts.some((part) => part === lower);
  });
  return lastNameMatches.slice(0, 5);
}

export function clearCache(): void {
  playerCache = null;
}

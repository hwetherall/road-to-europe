import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { CLUBS, CLUB_ABBRS, abbrFor, clubByAbbr } from '@/lib/clubs';
import { TEAM_COLOURS } from '@/lib/team-colours';
import { NUM_TEAMS } from '@/lib/constants';

describe('club registry', () => {
  it('holds exactly one entry per club, with unique codes', () => {
    expect(CLUBS.length).toBe(NUM_TEAMS);
    expect(new Set(CLUB_ABBRS).size).toBe(NUM_TEAMS);
    expect(new Set(CLUBS.map((c) => c.footballDataName)).size).toBe(NUM_TEAMS);
  });

  it('gives every club a colour', () => {
    for (const club of CLUBS) {
      expect(TEAM_COLOURS[club.abbr]).toBe(club.colour);
      expect(club.colour).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(Object.keys(TEAM_COLOURS).length).toBe(NUM_TEAMS);
  });

  it('resolves every known spelling of every club', () => {
    for (const club of CLUBS) {
      for (const name of [
        club.abbr,
        club.name,
        club.footballDataName,
        club.footballDataTla,
        ...club.aliases,
      ]) {
        expect(abbrFor(name)).toBe(club.abbr);
      }
    }
  });

  it('is tolerant about case and surrounding whitespace', () => {
    expect(abbrFor('  newcastle united  ')).toBe('NEW');
    expect(abbrFor('MANCHESTER CITY')).toBe('MCI');
  });

  /**
   * The failure this registry exists to prevent. A provider's own three-letter
   * code is not Keepwatch's, and the old `TEAM_NAME_MAP[name] || tla` fallback
   * silently substituted the provider's — consistently enough across standings
   * and fixtures that nothing looked wrong, while the club dropped out of the
   * priors table, the colours and the odds.
   */
  it('maps provider codes that disagree with ours back to ours', () => {
    expect(abbrFor('BHA')).toBe('BRI'); // football-data and ESPN
    expect(abbrFor('CHE')).toBe('CFC');
    expect(abbrFor('LIV')).toBe('LFC');
    expect(abbrFor('NOT')).toBe('NFO'); // football-data
    expect(abbrFor('MNC')).toBeUndefined(); // ESPN-only; not a football-data tla
  });

  it('returns undefined rather than guessing', () => {
    expect(abbrFor('Real Madrid')).toBeUndefined();
    expect(abbrFor('')).toBeUndefined();
    expect(abbrFor(undefined)).toBeUndefined();
    expect(abbrFor(null)).toBeUndefined();
    expect(clubByAbbr('XXX')).toBeUndefined();
  });

  it('has no alias that resolves to two different clubs', () => {
    const seen = new Map<string, string>();
    for (const club of CLUBS) {
      for (const name of [club.name, club.footballDataName, ...club.aliases]) {
        const key = name.toLowerCase();
        const prior = seen.get(key);
        expect(prior === undefined || prior === club.abbr).toBe(true);
        seen.set(key, club.abbr);
      }
    }
  });

  /**
   * The Python injury scraper cannot import from TypeScript, so its map is the
   * one hand-maintained copy left. This test is what makes forgetting it a test
   * failure rather than a season of missing injury data.
   */
  it('agrees with the Python injury scraper club map', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'injury-scraper', 'injury-scraper.py'),
      'utf-8'
    );
    const block = src.match(/CLUB_ABBR_MAP: dict\[str, str\] = \{([\s\S]*?)\n\}/);
    expect(block).not.toBeNull();

    const pairs = [...(block as RegExpMatchArray)[1].matchAll(/"([^"]+)":\s*"([A-Z]{3})"/g)];
    const pythonAbbrs = new Set(pairs.map((m) => m[2]));

    expect([...pythonAbbrs].sort()).toEqual([...CLUB_ABBRS].sort());
    // Every spelling the scraper knows must resolve to the same club here.
    for (const [, name, abbr] of pairs) expect(abbrFor(name)).toBe(abbr);
  });
});

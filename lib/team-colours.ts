export const TEAM_COLOURS: Record<string, string> = {
  ARS: '#EF0107',
  MCI: '#6CABDD',
  MUN: '#DA291C',
  AVL: '#670E36',
  CFC: '#034694',
  LFC: '#C8102E',
  BRE: '#e30613',
  FUL: '#CC0000',
  EVE: '#003399',
  BRI: '#0057B8',
  NEW: '#00aaaa',
  BOU: '#DA291C',
  SUN: '#EB172B',
  CRY: '#1B458F',
  LEE: '#FFCD00',
  TOT: '#132257',
  NFO: '#DD0000',
  WHU: '#7A263A',
  BUR: '#6C1D45',
  WOL: '#FDB913',
};

// Lighter variants for text on dark backgrounds where the accent is too dark
export const TEAM_TEXT_COLOURS: Record<string, string> = {
  AVL: '#9B3A6B',
  CFC: '#4A8BCC',
  TOT: '#5B6FA0',
  WHU: '#B8506A',
  BUR: '#A85080',
};

export function getTeamColour(abbr: string): string {
  return TEAM_COLOURS[abbr] ?? '#00aaaa';
}

export function getTeamTextColour(abbr: string): string {
  return TEAM_TEXT_COLOURS[abbr] ?? TEAM_COLOURS[abbr] ?? '#00aaaa';
}

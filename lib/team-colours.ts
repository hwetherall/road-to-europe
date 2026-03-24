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

// Preferred text variants on dark backgrounds for clubs with very dark primary colours.
const TEAM_TEXT_COLOURS: Record<string, string> = {
  AVL: '#9B3A6B',
  CFC: '#4A8BCC',
  TOT: '#5B6FA0',
  WHU: '#B8506A',
  BUR: '#A85080',
};

const MIN_TEXT_LUMINANCE = 0.22;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function blendWithWhite(rgb: { r: number; g: number; b: number }, mix: number) {
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * mix),
    g: Math.round(rgb.g + (255 - rgb.g) * mix),
    b: Math.round(rgb.b + (255 - rgb.b) * mix),
  };
}

export function getTeamColour(abbr: string): string {
  return TEAM_COLOURS[abbr] ?? '#00aaaa';
}

export function getTeamTextColour(abbr: string): string {
  const preferred = TEAM_TEXT_COLOURS[abbr];
  const base = preferred ?? TEAM_COLOURS[abbr] ?? '#00aaaa';
  const rgb = hexToRgb(base);
  if (!rgb) return '#8ad9d9';

  if (luminance(rgb.r, rgb.g, rgb.b) >= MIN_TEXT_LUMINANCE) {
    return base;
  }

  for (let mix = 0.1; mix <= 0.7; mix += 0.1) {
    const lifted = blendWithWhite(rgb, mix);
    if (luminance(lifted.r, lifted.g, lifted.b) >= MIN_TEXT_LUMINANCE) {
      return rgbToHex(lifted.r, lifted.g, lifted.b);
    }
  }

  const fallback = blendWithWhite(rgb, 0.7);
  return rgbToHex(fallback.r, fallback.g, fallback.b);
}

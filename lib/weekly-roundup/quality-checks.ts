import {
  RoundupDossier,
  RoundupQaIssue,
  RoundupSectionArtifact,
} from '@/lib/weekly-roundup/types';

type ProbabilityMetric = 'championPct' | 'top4Pct' | 'top7Pct' | 'survivalPct';

const TEAM_ALIASES: Record<string, string[]> = {
  ARS: ['Arsenal'],
  AVL: ['Aston Villa', 'Villa'],
  BOU: ['Bournemouth'],
  BRE: ['Brentford'],
  BRI: ['Brighton'],
  BUR: ['Burnley'],
  CFC: ['Chelsea'],
  CRY: ['Crystal Palace', 'Palace'],
  EVE: ['Everton'],
  FUL: ['Fulham'],
  LEE: ['Leeds United', 'Leeds'],
  LFC: ['Liverpool'],
  MCI: ['Manchester City', 'Man City', 'City'],
  MUN: ['Manchester United', 'Man United', 'United'],
  NEW: ['Newcastle United', 'Newcastle'],
  NFO: ['Nottingham Forest', 'Forest'],
  SUN: ['Sunderland'],
  TOT: ['Tottenham Hotspur', 'Tottenham', 'Spurs'],
  WHU: ['West Ham United', 'West Ham'],
  WOL: ['Wolverhampton Wanderers', 'Wolves'],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitSentences(markdown: string): string[] {
  return markdown
    .replace(/\|.*\|/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function aliasesForTeam(dossier: RoundupDossier, teamAbbr: string): string[] {
  const teamName = dossier.teams.find((team) => team.abbr === teamAbbr)?.name;
  const aliases = new Set<string>([teamAbbr, ...(TEAM_ALIASES[teamAbbr] ?? [])]);
  if (teamName) aliases.add(teamName);
  return [...aliases].sort((a, b) => b.length - a.length);
}

function findTeamMention(
  dossier: RoundupDossier,
  text: string,
  anchorIndex?: number
): string | null {
  let bestMatch: { team: string; distance: number } | null = null;

  for (const shift of dossier.probabilityShifts) {
    for (const alias of aliasesForTeam(dossier, shift.team)) {
      const pattern = new RegExp(`(^|[^a-zA-Z])${escapeRegExp(alias)}([^a-zA-Z]|$)`, 'i');
      const match = pattern.exec(text);
      if (!match) continue;

      if (anchorIndex === undefined) return shift.team;

      const distance = Math.abs(match.index - anchorIndex);
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { team: shift.team, distance };
      }
    }
  }
  return bestMatch?.team ?? null;
}

function extractFirstPercent(text: string): number | null {
  const match = text.match(/([-+−–]?\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return Number(match[1].replace('−', '-').replace('–', '-'));
}

function extractFirstPp(text: string): number | null {
  const match = text.match(/([-+−–]?\d+(?:\.\d+)?)\s*pp/i);
  if (!match) return null;
  return Number(match[1].replace('−', '-').replace('–', '-'));
}

function inferMetric(text: string): ProbabilityMetric {
  if (/\b(top[-\s]?four|champions league|top 4)\b/i.test(text)) return 'top4Pct';
  if (/\b(europe|european|top[-\s]?seven|top 7)\b/i.test(text)) return 'top7Pct';
  if (/\b(survival|relegation|safe|drop)\b/i.test(text)) return 'survivalPct';
  return 'championPct';
}

function metricLabel(metric: ProbabilityMetric): string {
  switch (metric) {
    case 'championPct':
      return 'title';
    case 'top4Pct':
      return 'top-four';
    case 'top7Pct':
      return 'top-seven';
    case 'survivalPct':
      return 'survival';
  }
}

function findFavouriteContradictions(
  dossier: RoundupDossier,
  section: RoundupSectionArtifact
): RoundupQaIssue[] {
  const issues: RoundupQaIssue[] = [];
  const favouritePattern = /\b(favou?rites?|front-?runners?|leading the race)\b/i;

  splitSentences(section.markdown).forEach((sentence, index) => {
    const favouriteMatch = favouritePattern.exec(sentence);
    if (!favouriteMatch) return;

    const team = findTeamMention(dossier, sentence, favouriteMatch.index);
    const statedPct = extractFirstPercent(sentence);
    if (!team || statedPct === null) return;

    const metric = inferMetric(sentence);
    const leader = dossier.probabilityShifts.reduce((best, current) =>
      current.postRound[metric] > best.postRound[metric] ? current : best
    );

    if (leader.team === team || leader.postRound[metric] <= statedPct + 0.05) return;

    issues.push({
      issueId: `det-favourite-${section.sectionId}-${index + 1}`,
      severity: 'high',
      category: 'logical_contradiction',
      sectionId: section.sectionId,
      originalExcerpt: sentence,
      explanation: `${team} is described as leading the ${metricLabel(metric)} race at ${statedPct.toFixed(1)}%, but ${leader.team} has the higher post-round probability at ${leader.postRound[metric].toFixed(1)}%.`,
      correction: `Do not call ${team} favourites; describe their swing or momentum while naming ${leader.team} as the higher-probability side.`,
      promptTuningNote: `Before using favourites/front-runners language, compare the named team's post-round probability with every rival in the same race.`,
    });
  });

  return issues;
}

function findActualSwingContradictions(
  dossier: RoundupDossier,
  section: RoundupSectionArtifact
): RoundupQaIssue[] {
  const issues: RoundupQaIssue[] = [];

  splitSentences(section.markdown).forEach((sentence, index) => {
    if (!/\bactual\b/i.test(sentence) || !/\bswing\b/i.test(sentence)) return;
    const statedSwing = extractFirstPp(sentence);
    if (statedSwing === null) return;

    const expectedSwing = dossier.targetClubDeltaTop7Pp;
    if (Math.abs(statedSwing - expectedSwing) < 0.2) return;

    issues.push({
      issueId: `det-actual-swing-${section.sectionId}-${index + 1}`,
      severity: 'high',
      category: 'numeric_consistency',
      sectionId: section.sectionId,
      originalExcerpt: sentence,
      explanation: `The prose states an actual swing of ${statedSwing.toFixed(1)}pp, but the target club's top-seven swing is ${expectedSwing.toFixed(1)}pp.`,
      correction: `Use ${expectedSwing.toFixed(1)}pp for Newcastle's actual top-seven swing, or remove the explicit figure if discussing a different metric.`,
      promptTuningNote: `When writing Perfect Weekend commentary, use targetClubDeltaTop7Pp for the actual Newcastle top-seven swing and do not substitute fixture-level deltas.`,
    });
  });

  return issues;
}

export function runRoundupQualityChecks(
  dossier: RoundupDossier,
  sections: RoundupSectionArtifact[]
): RoundupQaIssue[] {
  return sections.flatMap((section) => [
    ...findFavouriteContradictions(dossier, section),
    ...findActualSwingContradictions(dossier, section),
  ]);
}

export function filterIssuesBySeverity(
  issues: RoundupQaIssue[],
  severities: Array<RoundupQaIssue['severity']>
): RoundupQaIssue[] {
  const severitySet = new Set(severities);
  return issues.filter((issue) => severitySet.has(issue.severity));
}

export function issueCounts(issues: RoundupQaIssue[]) {
  return {
    highCount: issues.filter((issue) => issue.severity === 'high').length,
    mediumCount: issues.filter((issue) => issue.severity === 'medium').length,
    lowCount: issues.filter((issue) => issue.severity === 'low').length,
  };
}

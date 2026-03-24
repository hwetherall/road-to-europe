import {
  PunditArchetype,
  PunditFixtureContext,
  PunditSensitivitySnapshot,
  PunditTake,
} from '@/lib/types';

export const PUNDIT_ARCHETYPES: PunditArchetype[] = [
  'analyst',
  'coach',
  'fan',
  'banter_merchant',
  'skeptic',
];

export const PUNDIT_LABELS: Record<PunditArchetype, string> = {
  analyst: 'The Analyst',
  coach: 'The Coach',
  fan: 'The Fan',
  banter_merchant: 'The Banter Merchant',
  skeptic: 'The Skeptic',
};

const PUNDIT_STYLE_GUIDANCE: Record<PunditArchetype, string> = {
  analyst:
    'Prioritise numbers, probabilities, and leverage deltas. Sound precise and measured.',
  coach:
    'Prioritise tactical matchups, shape, spacing, pressing, and game-state management.',
  fan:
    'Speak as a die-hard fan of TARGET CLUB. Emotional and optimistic, but still tied to the given fixture context.',
  banter_merchant:
    'Punchy, witty, pub-style hot takes with one playful line, but still grounded in provided data.',
  skeptic:
    'Challenge overconfidence, highlight variance and uncertainty, and stress what could break the rosy scenario.',
};

type PunditCacheRecord = {
  take: PunditTake;
  cachedAt: number;
};

const punditCache = new Map<string, PunditCacheRecord>();

export function createPunditCacheKey(input: {
  scenarioKey: string;
  archetype: PunditArchetype;
  fixtureId: string;
  rerollIndex: number;
}): string {
  const dayBucket = new Date().toISOString().slice(0, 10);
  return `${input.scenarioKey}::${input.archetype}::${input.fixtureId}::${dayBucket}::r${input.rerollIndex}`;
}

export function getCachedPunditTake(cacheKey: string): PunditTake | null {
  const hit = punditCache.get(cacheKey);
  return hit?.take ?? null;
}

export function setCachedPunditTake(cacheKey: string, take: PunditTake): void {
  punditCache.set(cacheKey, { take, cachedAt: Date.now() });
}

export function getPunditSystemPrompt(params: {
  archetype: PunditArchetype;
  targetTeamName: string;
}): string {
  const { archetype, targetTeamName } = params;
  const label = PUNDIT_LABELS[archetype];
  const style = PUNDIT_STYLE_GUIDANCE[archetype];

  return `You are ${label} in a football analysis app.

STYLE GUIDANCE:
${style}

HARD RULES:
- This app is club-agnostic. The target club in this request is "${targetTeamName}".
- If archetype is fan, your voice MUST be from "${targetTeamName}" fan perspective.
- Output exactly 2-3 sentences in takeText.
- Mention one concrete fixture from the provided context.
- Include one clear watch-for trigger.
- Keep claims grounded in provided data only.
- Avoid impersonating real people.

Return JSON only with this exact schema:
{
  "archetype": "analyst|coach|fan|banter_merchant|skeptic",
  "targetTeam": "string",
  "fixtureId": "string",
  "takeText": "string",
  "impactOnTargetTeam": "positive|negative|neutral",
  "watchFor": "string",
  "confidence": "1|2|3|4|5"
}`;
}

export function getPunditUserPrompt(params: {
  archetype: PunditArchetype;
  targetTeam: string;
  targetTeamName: string;
  metricLabel: string;
  baselineOdds: number;
  fixture: PunditFixtureContext;
  topSensitivity: PunditSensitivitySnapshot[];
}): string {
  const { archetype, targetTeam, targetTeamName, metricLabel, baselineOdds, fixture, topSensitivity } = params;

  const sensitivityText = topSensitivity
    .map(
      (s) =>
        `- ${s.homeTeam} vs ${s.awayTeam} (${s.fixtureId}): max swing ${s.maxAbsDelta.toFixed(1)}pp`
    )
    .join('\n');

  return `Generate one pundit hot take.

Archetype: ${archetype}
Target club: ${targetTeamName} (${targetTeam})
Current metric: ${metricLabel}
Baseline odds: ${baselineOdds.toFixed(1)}%

Primary fixture:
- Fixture ID: ${fixture.fixtureId}
- Match: ${fixture.homeTeam} vs ${fixture.awayTeam}
- Date: ${fixture.date ?? 'unknown'}

Top leverage fixtures:
${sensitivityText || '- none'}

Return only valid JSON.`;
}

function countSentences(text: string): number {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 0;
  return cleaned.split(/[.!?]+/).filter(Boolean).length;
}

export function parseAndValidatePunditTake(raw: string): PunditTake | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : raw;

  const objectLike = candidate.match(/\{[\s\S]*\}/);
  const jsonText = objectLike ? objectLike[0] : candidate;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;

  const archetype = record.archetype;
  const targetTeam = record.targetTeam;
  const fixtureId = record.fixtureId;
  const takeText = record.takeText;
  const impact = record.impactOnTargetTeam;
  const watchFor = record.watchFor;
  const confidence = record.confidence;

  if (
    !PUNDIT_ARCHETYPES.includes(archetype as PunditArchetype) ||
    typeof targetTeam !== 'string' ||
    typeof fixtureId !== 'string' ||
    typeof takeText !== 'string' ||
    !['positive', 'negative', 'neutral'].includes(String(impact)) ||
    typeof watchFor !== 'string' ||
    ![1, 2, 3, 4, 5].includes(Number(confidence))
  ) {
    return null;
  }

  const sentenceCount = countSentences(takeText);
  if (sentenceCount < 2 || sentenceCount > 3) {
    return null;
  }

  if (!takeText.includes('vs') && !takeText.includes('-')) {
    return null;
  }

  return {
    archetype: archetype as PunditArchetype,
    targetTeam,
    fixtureId,
    takeText: takeText.trim(),
    impactOnTargetTeam: impact as PunditTake['impactOnTargetTeam'],
    watchFor: watchFor.trim(),
    confidence: Number(confidence) as PunditTake['confidence'],
  };
}

export function buildFallbackTake(params: {
  archetype: PunditArchetype;
  targetTeam: string;
  fixture: PunditFixtureContext;
}): PunditTake {
  const { archetype, targetTeam, fixture } = params;
  const fixtureText = `${fixture.homeTeam} vs ${fixture.awayTeam}`;
  const takeByArchetype: Record<PunditArchetype, string> = {
    analyst: `${fixtureText} carries meaningful leverage for ${targetTeam}, so the outcome can still shift the current probability picture. The biggest swing usually comes from who controls transitions after halftime and turns pressure into quality chances.`,
    coach: `${fixtureText} is all about game-state control for ${targetTeam}'s wider objective, especially who wins the midfield second balls and territory. If one side can break the first line and pin the other full-backs, the tactical momentum can flip quickly.`,
    fan: `${targetTeam} fans should be glued to ${fixtureText}, because this one can absolutely bend the run-in. If the right side starts fast and the crowd feels the swing, this could be the kind of weekend where belief grows again.`,
    banter_merchant: `${fixtureText} has proper season-swing energy for ${targetTeam}, and one weird bounce could rewrite the table chat by Sunday night. Whoever loses their head first might become the punchline in the pub for a week.`,
    skeptic: `${fixtureText} matters for ${targetTeam}, but one headline result should not be mistaken for a guaranteed trend. Variance is brutal in run-ins, so a single red card or set-piece deflection can make every confident prediction look silly.`,
  };

  const watchByArchetype: Record<PunditArchetype, string> = {
    analyst: `Expected-threat quality in the first 30 minutes and whether shots come from central zones.`,
    coach: `Press resistance under pressure and whether either side can consistently access the half-spaces.`,
    fan: `Early intensity, duels won, and whether momentum feels with the team that helps ${targetTeam}.`,
    banter_merchant: `Who blinks first under pressure and which defender starts making comedy-clearance decisions.`,
    skeptic: `Set-piece variance and discipline moments, because one random event can dominate the narrative.`,
  };

  return {
    archetype,
    targetTeam,
    fixtureId: fixture.fixtureId,
    takeText: takeByArchetype[archetype],
    impactOnTargetTeam: 'neutral',
    watchFor: watchByArchetype[archetype],
    confidence: 3,
  };
}

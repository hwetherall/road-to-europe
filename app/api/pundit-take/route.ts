import { NextRequest, NextResponse } from 'next/server';
import {
  buildFallbackTake,
  createPunditCacheKey,
  getCachedPunditTake,
  getPunditSystemPrompt,
  getPunditUserPrompt,
  parseAndValidatePunditTake,
  setCachedPunditTake,
} from '@/lib/pundits';
import {
  PunditArchetype,
  PunditFixtureContext,
  PunditSensitivitySnapshot,
} from '@/lib/types';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const PUNDIT_MODEL = process.env.PUNDIT_MODEL ?? 'x-ai/grok-4.1-fast';

interface PunditTakeRequest {
  scenarioKey: string;
  archetype: PunditArchetype;
  rerollIndex: number;
  targetTeam: string;
  targetTeamName: string;
  metricLabel: string;
  baselineOdds: number;
  fixture: PunditFixtureContext;
  topSensitivity: PunditSensitivitySnapshot[];
}

function isValidArchetype(value: string): value is PunditArchetype {
  return ['analyst', 'coach', 'fan', 'banter_merchant', 'skeptic'].includes(value);
}

async function callOpenRouter(system: string, user: string): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: PUNDIT_MODEL,
      max_tokens: 350,
      temperature: 0.9,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<PunditTakeRequest>;
    const {
      scenarioKey,
      archetype,
      rerollIndex,
      targetTeam,
      targetTeamName,
      metricLabel,
      baselineOdds,
      fixture,
      topSensitivity,
    } = body;

    if (
      typeof scenarioKey !== 'string' ||
      typeof archetype !== 'string' ||
      !isValidArchetype(archetype) ||
      typeof rerollIndex !== 'number' ||
      typeof targetTeam !== 'string' ||
      typeof targetTeamName !== 'string' ||
      typeof metricLabel !== 'string' ||
      typeof baselineOdds !== 'number' ||
      !fixture ||
      typeof fixture.fixtureId !== 'string' ||
      typeof fixture.homeTeam !== 'string' ||
      typeof fixture.awayTeam !== 'string' ||
      !Array.isArray(topSensitivity)
    ) {
      return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
    }

    const boundedRerollIndex = Math.max(0, Math.min(2, Math.floor(rerollIndex)));
    const cacheKey = createPunditCacheKey({
      scenarioKey,
      archetype,
      fixtureId: fixture.fixtureId,
      rerollIndex: boundedRerollIndex,
    });
    const cached = getCachedPunditTake(cacheKey);
    if (cached) {
      return NextResponse.json({ take: cached, cacheStatus: 'hit' });
    }

    const systemPrompt = getPunditSystemPrompt({
      archetype,
      targetTeamName,
    });
    const userPrompt = getPunditUserPrompt({
      archetype,
      targetTeam,
      targetTeamName,
      metricLabel,
      baselineOdds,
      fixture,
      topSensitivity: topSensitivity.slice(0, 5),
    });

    let take = buildFallbackTake({
      archetype,
      targetTeam,
      fixture,
    });

    if (OPENROUTER_API_KEY) {
      const raw = await callOpenRouter(systemPrompt, userPrompt);
      const parsed = parseAndValidatePunditTake(raw);
      if (parsed) {
        take = parsed;
      }
    }

    setCachedPunditTake(cacheKey, take);

    return NextResponse.json({ take, cacheStatus: 'miss' });
  } catch (error) {
    console.error('Pundit take API error:', error);
    return NextResponse.json(
      { error: `Pundit take failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

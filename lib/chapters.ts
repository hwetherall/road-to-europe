import { Chapter, ScenarioModification, ScenarioState } from './chat-types';

export function addChapter(state: ScenarioState, chapter: Chapter): ScenarioState {
  return {
    ...state,
    chapters: [...state.chapters, { ...chapter, status: 'active' }],
  };
}

export function removeChapter(state: ScenarioState, chapterId: string): ScenarioState {
  return {
    ...state,
    chapters: state.chapters.filter((c) => c.id !== chapterId),
  };
}

export function toggleChapter(state: ScenarioState, chapterId: string): ScenarioState {
  return {
    ...state,
    chapters: state.chapters.map((c) =>
      c.id === chapterId
        ? { ...c, status: c.status === 'disabled' ? 'active' : 'disabled' }
        : c
    ),
  };
}

export function updateChapterModification(
  state: ScenarioState,
  chapterId: string,
  modification: ScenarioModification
): ScenarioState {
  return {
    ...state,
    chapters: state.chapters.map((c) =>
      c.id === chapterId ? { ...c, modification } : c
    ),
  };
}

export function updateChapterLock(
  state: ScenarioState,
  chapterId: string,
  fixtureLock: { fixtureId: string; result: 'home' | 'draw' | 'away' }
): ScenarioState {
  return {
    ...state,
    chapters: state.chapters.map((c) =>
      c.id === chapterId ? { ...c, fixtureLock } : c
    ),
  };
}

export function resetAllChapters(): ScenarioState {
  return { chapters: [] };
}

export function createFixtureLockChapter(
  fixtureId: string,
  result: 'home' | 'draw' | 'away',
  homeTeam: string,
  awayTeam: string
): Chapter {
  const resultLabels = {
    home: `${homeTeam} win`,
    draw: 'Draw',
    away: `${awayTeam} win`,
  };
  return {
    id: crypto.randomUUID(),
    title: `${homeTeam} vs ${awayTeam}: ${resultLabels[result]}`,
    type: 'fixture_lock',
    status: 'active',
    createdAt: Date.now(),
    fixtureLock: { fixtureId, result },
    confidence: 'high',
  };
}

// ── Chapter System ──

/**
 * A team-level fixture lock: lock all remaining fixtures for a team to a result.
 * `result` is team-relative: 'win' means the team wins, 'lose' means they lose.
 */
export interface TeamFixtureLock {
  team: string;           // Team abbreviation (e.g., "TOT")
  result: 'win' | 'lose' | 'draw';
}

export interface Chapter {
  id: string;
  title: string;
  type: 'probability_modifier' | 'fixture_lock' | 'compound';
  status: 'draft' | 'active' | 'disabled';
  createdAt: number;

  // For probability modifiers (from agent analysis)
  modification?: ScenarioModification;

  // For fixture locks (from manual what-if or chat instruction)
  fixtureLock?: {
    fixtureId: string;
    result: 'home' | 'draw' | 'away';
  };

  // For compound scenarios: team-level fixture locks + optional probability modifiers
  // e.g., "Tottenham lose all remaining" + "injury reduces Arsenal's odds"
  teamFixtureLocks?: TeamFixtureLock[];

  // Agent reasoning (displayed in chapter detail)
  reasoning?: string;
  confidence?: 'high' | 'medium' | 'low';
  mode?: 'fast' | 'deep';
  sources?: string[];
}

export interface ScenarioModification {
  description: string;
  teamModifications: TeamModification[];
  fixtureSpecificOverrides?: FixtureOverride[];
}

export interface TeamModification {
  team: string;
  homeWinDelta: number;
  awayWinDelta: number;
  drawDelta: number;
}

export interface FixtureOverride {
  fixtureId: string;
  homeWinDelta?: number;
  awayWinDelta?: number;
  drawDelta?: number;
}

// ── Chat System ──

export interface ProposedOption {
  title: string;
  modification?: ScenarioModification;
  fixtureLock?: { fixtureId: string; result: 'home' | 'draw' | 'away' };
  teamFixtureLocks?: TeamFixtureLock[];
  confidence?: 'high' | 'medium' | 'low';
  reasoning?: string;
  type: 'scenario_modification' | 'fixture_lock' | 'compound';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;

  // Agent-specific metadata
  researchPlan?: string[];
  proposedModification?: ScenarioModification;
  proposedOptions?: ProposedOption[];
  chapterId?: string;
  toolCalls?: ToolCall[];
  isThinking?: boolean;
}

export interface ToolCall {
  id: string;
  type: 'web_search';
  query: string;
  status: 'pending' | 'complete' | 'error';
  results?: string;
}

export interface ChatState {
  messages: ChatMessage[];
  isProcessing: boolean;
  mode: 'fast' | 'deep';
  pendingModification: ScenarioModification | null;
}

// ── Combined Scenario State ──

export interface ScenarioState {
  chapters: Chapter[];
}

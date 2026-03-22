# CLAUDE-V3A.md — Keepwatch: Chat Scenario Interface (UI + Plumbing)

## Overview

V3A adds the chat sidebar, the chapters system, and the state management layer that connects user-driven scenarios to the existing simulation engine. This is the "shell" that V3B's agent brain plugs into.

**V3A does NOT include:** The agent reasoning pipeline, web research execution, or quantification logic. Those are in V3B. V3A provides the UI, state management, and integration points that V3B's agent uses.

### What V3A Delivers
- Chat sidebar with conversation thread and input
- Active chapters panel (scenario list with remove/edit)
- Fast/Deep mode toggle
- Chapter state management (create, stack, remove, reset)
- Simulation integration (chapters → probability modifications → re-simulation → dashboard update)
- Comparison strips showing baseline vs scenario-modified odds
- V2 what-if locks unified into the chapter system
- All plumbing needed for V3B's agent to plug in

---

## Prerequisites

V3A assumes V2 is complete:
- Team selector working with URL state
- Context-sensitive qualification cards
- Position histogram
- What-if mode with manual fixture locks
- Dynamic team accent colours

---

## New/Modified Files

```
app/
├── page.tsx                              # MODIFY: Add sidebar layout wrapper
├── components/
│   ├── Dashboard.tsx                     # MODIFY: Accept chapters state, pass to simulation
│   ├── ChatSidebar.tsx                   # NEW: Main sidebar container
│   ├── ChatThread.tsx                    # NEW: Message display (user + agent messages)
│   ├── ChatInput.tsx                     # NEW: Input box with fast/deep toggle + send
│   ├── ChaptersPanel.tsx                 # NEW: Active scenarios list above chat
│   ├── ChapterCard.tsx                   # NEW: Individual chapter display with remove/edit
│   ├── ScenarioComparison.tsx            # NEW: Baseline vs modified odds strip
│   ├── WhatIfPanel.tsx                   # MODIFY: Lock clicks create chapters instead of direct state
│   ├── QualificationCards.tsx            # MODIFY: Show deltas when chapters active
│   ├── SensitivityChart.tsx              # MODIFY: Re-run with chapter modifications applied
│   └── [all other components unchanged]
│
├── api/
│   ├── chat/route.ts                     # NEW: Chat endpoint (proxies to OpenRouter)
│   └── [existing routes unchanged]
│
lib/
├── types.ts                              # MODIFY: Add Chapter, ChatMessage, ScenarioModification types
├── chapters.ts                           # NEW: Chapter state management logic
├── modification-engine.ts                # NEW: Apply chapters to fixture probabilities
├── chat-types.ts                         # NEW: Chat-specific type definitions
└── [all other lib files unchanged]
```

---

## New Types

```typescript
// Add to lib/types.ts or new lib/chat-types.ts

// ── Chapter System ──

interface Chapter {
  id: string;                              // unique ID (uuid)
  title: string;                           // e.g. "Bruno Guimarães injured"
  type: 'probability_modifier' | 'fixture_lock';
  status: 'draft' | 'active' | 'disabled';
  createdAt: number;                       // timestamp
  
  // For probability modifiers (from agent analysis)
  modification?: ScenarioModification;
  
  // For fixture locks (from manual what-if or chat instruction)
  fixtureLock?: {
    fixtureId: string;
    result: 'home' | 'draw' | 'away';
  };
  
  // Agent reasoning (displayed in chapter detail)
  reasoning?: string;
  confidence?: 'high' | 'medium' | 'low';
  mode?: 'fast' | 'deep';
  sources?: string[];                      // URLs from research (deep mode)
}

interface ScenarioModification {
  description: string;
  teamModifications: TeamModification[];
  fixtureSpecificOverrides?: FixtureOverride[];
}

interface TeamModification {
  team: string;                            // team abbr
  homeWinDelta: number;                    // e.g. -0.10 (reduce by 10pp)
  awayWinDelta: number;                    // e.g. -0.12
  drawDelta: number;                       // e.g. +0.04
  // Remainder automatically goes to opponent win probability
}

interface FixtureOverride {
  fixtureId: string;
  homeWinDelta?: number;
  awayWinDelta?: number;
  drawDelta?: number;
}

// ── Chat System ──

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  
  // Agent-specific metadata
  researchPlan?: string[];                 // Steps the agent plans to take
  proposedModification?: ScenarioModification;  // What the agent is proposing
  chapterId?: string;                      // If this message created/modified a chapter
  toolCalls?: ToolCall[];                  // Search tool invocations (deep mode)
  isThinking?: boolean;                    // Show thinking indicator
}

interface ToolCall {
  id: string;
  type: 'web_search';
  query: string;
  status: 'pending' | 'complete' | 'error';
  results?: string;                        // Summarised search results
}

interface ChatState {
  messages: ChatMessage[];
  isProcessing: boolean;
  mode: 'fast' | 'deep';
  pendingModification: ScenarioModification | null;  // Awaiting user approval
}

// ── Combined Scenario State ──

interface ScenarioState {
  chapters: Chapter[];
  baselineResults: SimulationResult[] | null;    // Simulation with no chapters
  modifiedResults: SimulationResult[] | null;    // Simulation with all active chapters
}
```

---

## Chapter State Management (lib/chapters.ts)

```typescript
// Core chapter operations

function addChapter(state: ScenarioState, chapter: Chapter): ScenarioState {
  return {
    ...state,
    chapters: [...state.chapters, { ...chapter, status: 'active' }],
  };
}

function removeChapter(state: ScenarioState, chapterId: string): ScenarioState {
  return {
    ...state,
    chapters: state.chapters.filter(c => c.id !== chapterId),
  };
}

function disableChapter(state: ScenarioState, chapterId: string): ScenarioState {
  // Disable without removing — keeps it in the list but excluded from simulation
  return {
    ...state,
    chapters: state.chapters.map(c =>
      c.id === chapterId ? { ...c, status: c.status === 'disabled' ? 'active' : 'disabled' } : c
    ),
  };
}

function updateChapterModification(
  state: ScenarioState,
  chapterId: string,
  modification: ScenarioModification
): ScenarioState {
  return {
    ...state,
    chapters: state.chapters.map(c =>
      c.id === chapterId ? { ...c, modification } : c
    ),
  };
}

function resetAllChapters(): ScenarioState {
  return { chapters: [], baselineResults: null, modifiedResults: null };
}

// Convert a V2-style fixture lock into a chapter
function createFixtureLockChapter(
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
    confidence: 'high',  // User explicitly chose this
  };
}
```

---

## Modification Engine (lib/modification-engine.ts)

This is the bridge between chapters and the simulation. It takes the base fixture list and all active chapters, and produces a modified fixture list with adjusted probabilities.

```typescript
function applyChapters(
  fixtures: Fixture[],
  chapters: Chapter[]
): Fixture[] {
  // Start with a deep clone of fixtures
  let modified = fixtures.map(f => ({ ...f }));

  // Apply chapters in order (chronological — oldest first)
  const activeChapters = chapters
    .filter(c => c.status === 'active')
    .sort((a, b) => a.createdAt - b.createdAt);

  for (const chapter of activeChapters) {
    if (chapter.type === 'fixture_lock' && chapter.fixtureLock) {
      // Simple: set fixture to deterministic outcome
      modified = modified.map(f => {
        if (f.id !== chapter.fixtureLock!.fixtureId) return f;
        return {
          ...f,
          homeWinProb: chapter.fixtureLock!.result === 'home' ? 1.0 : 0.0,
          drawProb: chapter.fixtureLock!.result === 'draw' ? 1.0 : 0.0,
          awayWinProb: chapter.fixtureLock!.result === 'away' ? 1.0 : 0.0,
        };
      });
    }

    if (chapter.type === 'probability_modifier' && chapter.modification) {
      const mod = chapter.modification;

      // Apply team-wide modifications
      for (const teamMod of mod.teamModifications) {
        modified = modified.map(f => {
          const isHome = f.homeTeam === teamMod.team;
          const isAway = f.awayTeam === teamMod.team;
          if (!isHome && !isAway) return f;
          if (f.status !== 'SCHEDULED') return f;

          // Check for fixture-specific override
          const fixtureOverride = mod.fixtureSpecificOverrides?.find(
            o => o.fixtureId === f.id
          );

          let hDelta = 0, dDelta = 0, aDelta = 0;

          if (fixtureOverride) {
            hDelta = fixtureOverride.homeWinDelta ?? 0;
            dDelta = fixtureOverride.drawDelta ?? 0;
            aDelta = fixtureOverride.awayWinDelta ?? 0;
          } else if (isHome) {
            hDelta = teamMod.homeWinDelta;
            dDelta = teamMod.drawDelta;
            // Away win absorbs the remainder
            aDelta = -(hDelta + dDelta);
          } else {
            // Team is away in this fixture
            aDelta = teamMod.awayWinDelta;
            dDelta = teamMod.drawDelta;
            // Home win absorbs the remainder
            hDelta = -(aDelta + dDelta);
          }

          // Apply deltas and clamp to valid range
          const newHome = clamp(f.homeWinProb! + hDelta, 0.01, 0.98);
          const newDraw = clamp(f.drawProb! + dDelta, 0.01, 0.98);
          const newAway = clamp(f.awayWinProb! + aDelta, 0.01, 0.98);

          // Re-normalise to sum to 1.0
          const total = newHome + newDraw + newAway;
          return {
            ...f,
            homeWinProb: newHome / total,
            drawProb: newDraw / total,
            awayWinProb: newAway / total,
          };
        });
      }
    }
  }

  return modified;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
```

---

## Simulation Integration

The Dashboard component manages the simulation pipeline. When chapters change:

```typescript
// In Dashboard.tsx — the core simulation loop

// 1. Baseline (no chapters) — only re-run on data refresh, not on chapter changes
const baselineResults = useMemo(
  () => simulate(teams, allFixtures, SIM_COUNT),
  [teams, allFixtures]
);

// 2. Modified (with chapters) — re-run whenever chapters change
const modifiedFixtures = useMemo(
  () => applyChapters(allFixtures, chapters),
  [allFixtures, chapters]
);

const modifiedResults = useMemo(
  () => chapters.length > 0 ? simulate(teams, modifiedFixtures, SIM_COUNT) : null,
  [teams, modifiedFixtures, chapters]
);

// 3. The "active" results shown in the dashboard
const displayResults = modifiedResults ?? baselineResults;

// 4. Deltas for comparison strip
const selectedTeamBaseline = baselineResults.find(r => r.team === selectedTeam);
const selectedTeamModified = modifiedResults?.find(r => r.team === selectedTeam);
const hasDelta = selectedTeamModified != null;
```

**Performance note:** `useMemo` ensures re-simulation only runs when inputs actually change. The 10K-sim Tier 1 run at ~200ms is fast enough that chapter changes feel instant. Sensitivity scan (Tier 2) should NOT re-run on every chapter change — only on explicit refresh.

---

## Chat Sidebar Layout

```
┌─────────────────────────────────┐
│  SCENARIOS                      │
│  ┌───────────────────────────┐  │
│  │ ✕ Bruno G. injured        │  │
│  │   NEW -12pp/match · deep  │  │
│  ├───────────────────────────┤  │
│  │ ✕ CFC vs ARS: Away win   │  │
│  │   Fixture lock            │  │
│  ├───────────────────────────┤  │
│  │        [Reset All]        │  │
│  └───────────────────────────┘  │
│                                 │
│  ─────── Chat Thread ────────   │
│                                 │
│  🔵 What if Bruno Guimarães    │
│     gets injured?               │
│                                 │
│  🤖 I'll assess this. First,   │
│     let me verify Bruno's       │
│     current situation...        │
│     🔍 Searching: "Bruno        │
│     Guimarães Newcastle 2026"   │
│     ...                         │
│     Based on my research:       │
│     [Proposed modification]     │
│     [Apply] [Adjust]            │
│                                 │
│  🔵 Make it more severe, he's  │
│     been their best player      │
│                                 │
│  🤖 Revised: -14pp/match       │
│     [Apply] [Adjust]            │
│                                 │
│  🔵 Apply it                    │
│                                 │
│  🤖 ✅ Chapter created.         │
│     Newcastle's European odds   │
│     dropped from 18.7% to 9.2% │
│                                 │
│  ─────────────────────────────  │
│  [Fast ◉ | ○ Deep]             │
│  ┌───────────────────────────┐  │
│  │ Describe a scenario...    │  │
│  └───────────────────────────┘  │
│              [Send]             │
└─────────────────────────────────┘
```

### Sidebar Behaviour
- **Width:** 380px on desktop. Full-screen overlay on mobile with a toggle button.
- **Toggle:** A button in the main toolbar opens/closes the sidebar. Icon: chat bubble or brain icon.
- **When closed:** Dashboard takes full width (same as V2).
- **When open:** Dashboard compresses. On screens <1024px, sidebar overlays instead.
- **Persists across team switches:** Chat history and chapters remain. Dashboard re-renders for new team.

### Chat Thread Messages

Each message type has a distinct visual treatment:

**User messages:** Right-aligned, accent-coloured bubble (team colour). Brief, conversational.

**Agent messages:** Left-aligned, dark background bubble. May contain:
- Plain text (reasoning, explanation)
- Research plan (numbered list with checkmarks as steps complete)
- Tool call indicators (search icon + query text, with loading → results states)
- Proposed modification card (structured: team, delta, confidence)
- Action buttons: [Apply] [Adjust] — only on messages with pending modifications
- Chapter confirmation: checkmark + summary of what changed

**System messages:** Centred, muted. "Chapter removed" / "All scenarios reset" / "Switched to deep mode."

### Action Buttons

When the agent proposes a modification, the message includes interactive buttons:

- **[Apply]** — Creates the chapter, adds to active list, triggers re-simulation
- **[Adjust]** — Scrolls to input, pre-fills "I'd like to adjust..." (or just focuses input for the user to type their refinement)

These buttons become disabled after the user takes an action. Once applied, the message shows "✅ Applied as Chapter N" in place of the buttons.

### Fast/Deep Toggle

A segmented control at the bottom of the sidebar, above the input. Two options:
- **Fast** — Agent uses minimal search (1-2 quick grounding queries) and LLM reasoning. Response in 3-5 seconds.
- **Deep** — Agent generates research plan, user confirms, full multi-step research. Response in 15-45 seconds with visible progress.

The toggle persists within the session. Default: Fast.

Visual treatment: the toggle should be subtle — not the focus of the UI. Perhaps small text labels with a pill-style selector.

---

## Chat API Endpoint (app/api/chat/route.ts)

This is the backend that proxies between the frontend and OpenRouter. It handles:
1. Forwarding messages to the LLM
2. Managing tool calls (web search) for deep mode
3. Returning structured responses with proposed modifications

```typescript
// POST /api/chat
// Body: {
//   messages: ChatMessage[],
//   mode: 'fast' | 'deep',
//   context: {
//     selectedTeam: string,
//     standings: Team[],
//     activeChapters: Chapter[],
//     sensitivityResults: SensitivityResult[],  // so agent knows what matters
//   }
// }
//
// Response: streaming or single response with:
//   - Agent text
//   - Proposed ScenarioModification (if applicable)
//   - Tool calls made (for display)

// The system prompt and agent logic are defined in V3B (CLAUDE-V3B.md).
// This endpoint just handles the plumbing: auth, message formatting,
// tool call execution loop, and response parsing.

// Tool call loop (for deep mode):
// 1. Send messages to OpenRouter with tool definitions
// 2. If response contains tool_use blocks, execute the tool (web search)
// 3. Append tool results to messages
// 4. Re-send to OpenRouter for next step
// 5. Repeat until agent responds with text (no more tool calls)
// 6. Parse final response for proposed modification
// 7. Return to frontend
```

---

## Migrating V2 What-If Locks to Chapters

V2's `WhatIfPanel.tsx` currently manages lock state directly. In V3A, clicking a lock button creates a chapter instead:

```typescript
// BEFORE (V2): Direct state management
const [locks, setLocks] = useState<Record<string, 'home' | 'draw' | 'away'>>({});
const handleLock = (fixtureId: string, result: 'home' | 'draw' | 'away') => {
  setLocks(prev => ({ ...prev, [fixtureId]: result }));
};

// AFTER (V3A): Create chapters
const handleLock = (fixtureId: string, result: 'home' | 'draw' | 'away') => {
  const fixture = fixtures.find(f => f.id === fixtureId);
  if (!fixture) return;
  
  // Check if there's already a lock chapter for this fixture — replace it
  const existingChapter = chapters.find(
    c => c.type === 'fixture_lock' && c.fixtureLock?.fixtureId === fixtureId
  );
  
  if (existingChapter) {
    if (existingChapter.fixtureLock?.result === result) {
      // Same result clicked again — remove the lock (toggle off)
      removeChapter(existingChapter.id);
    } else {
      // Different result — update the lock
      updateChapter(existingChapter.id, { fixtureLock: { fixtureId, result } });
    }
  } else {
    // New lock
    addChapter(createFixtureLockChapter(
      fixtureId, result, fixture.homeTeam, fixture.awayTeam
    ));
  }
};
```

The what-if panel continues to show lock buttons per fixture. Locked fixtures are visually indicated as before. The only difference is the state flows through the chapter system.

---

## Comparison Strip (app/components/ScenarioComparison.tsx)

Appears at the top of the dashboard content area when any chapters are active. Shows the delta between baseline and scenario-modified odds for the selected team's primary metric.

```
┌──────────────────────────────────────────────────────────────┐
│  3 scenarios active                                          │
│  Any Europe:  18.7% baseline  →  9.2% modified  (Δ -9.5pp)  │
│  Expected pts: 52.3  →  48.1  (Δ -4.2)                      │
└──────────────────────────────────────────────────────────────┘
```

Design:
- Full width, sits between toolbar and qualification cards
- Background: subtle gradient indicating direction (green tint = improved, red = worsened)
- Shows: chapter count, primary metric delta, expected points delta
- Clicking expands to show per-chapter breakdown:
  - "Bruno G. injured: -4.2pp"
  - "CFC vs ARS locked: +1.1pp"
  - "Palmer injured: +3.1pp (indirect — weakens rival)"

The per-chapter breakdown requires running the simulation N+1 times (once baseline, once per chapter in isolation) to attribute the delta. This is expensive for many chapters, so only compute it on expand — not by default. Alternatively, approximate by computing the delta when each chapter was first added (before subsequent chapters existed). Simpler but slightly less accurate for interacting chapters.

**Recommendation:** Use the simpler approach (delta at time of creation) for V3A. If precision matters, V3B's agent can note interactions when adding new chapters.

---

## Dashboard Layout with Sidebar

```
┌────────────────────────────────────────────┬──────────────────┐
│  KEEPWATCH header + team selector          │                  │
│────────────────────────────────────────────│  SCENARIOS       │
│  Toolbar: [Refresh] [What-If] [Chat ◉]    │  [chapter list]  │
│────────────────────────────────────────────│                  │
│  Scenario Comparison Strip (if active)     │  ──────────────  │
│────────────────────────────────────────────│                  │
│  Qualification Cards (with deltas)         │  Chat thread     │
│────────────────────────────────────────────│  ...             │
│  Position Histogram                        │  ...             │
│────────────────────────────────────────────│  ...             │
│  High-Leverage Fixtures                    │  ...             │
│────────────────────────────────────────────│  ...             │
│  What-If Panel (if active)                 │                  │
│────────────────────────────────────────────│  ──────────────  │
│  Team Fixtures / Projections / Standings   │  [Fast|Deep]     │
│                                            │  [input] [Send]  │
└────────────────────────────────────────────┴──────────────────┘
```

- Sidebar width: 380px fixed
- Dashboard area: `calc(100% - 380px)` when sidebar open
- Transition: smooth slide animation when toggling sidebar
- Mobile (<1024px): sidebar overlays as a drawer from right, dashboard stays full width underneath

---

## Build Order (V3A)

### Step 1: Types and State
- Add all new types to `lib/types.ts` or `lib/chat-types.ts`
- Create `lib/chapters.ts` with chapter CRUD operations
- Create `lib/modification-engine.ts` with `applyChapters()` function
- **Test:** Unit test `applyChapters` — verify probability deltas are applied correctly, normalisation works, fixture locks override probabilities.

### Step 2: Chapter State in Dashboard
- Add chapter state to `Dashboard.tsx` using `useState<Chapter[]>`
- Wire `applyChapters` into the simulation pipeline: baseline (no chapters) vs modified (with chapters)
- Store both `baselineResults` and `modifiedResults`
- Pass `displayResults` (modified if chapters exist, baseline otherwise) to all child components
- **Test:** Programmatically add a chapter with a known modification. Verify simulation results change in the expected direction.

### Step 3: Migrate What-If Locks
- Modify `WhatIfPanel.tsx` to create chapters instead of managing direct lock state
- Remove old lock state management from Dashboard
- Verify what-if panel still works identically from the user's perspective
- **Test:** Click fixture locks, verify chapters appear in state, simulation updates.

### Step 4: Chapters Panel Component
- Create `ChaptersPanel.tsx` — displays active chapters with remove buttons
- Create `ChapterCard.tsx` — individual chapter with title, type badge, confidence, remove
- Place temporarily above the what-if panel or in the toolbar area
- Wire remove/disable actions
- **Test:** Add chapters via what-if locks, see them in panel, remove them, verify simulation resets.

### Step 5: Scenario Comparison Strip
- Create `ScenarioComparison.tsx`
- Place between toolbar and qualification cards
- Show baseline vs modified for selected team's primary metric
- Add delta indicators to `QualificationCards.tsx` (small "+X.Xpp" or "-X.Xpp" annotations)
- **Test:** With chapters active, verify comparison strip shows correct deltas. Switch teams, verify it updates.

### Step 6: Chat Sidebar Shell
- Create `ChatSidebar.tsx` — sidebar container with open/close toggle
- Create `ChatThread.tsx` — scrollable message list (empty for now)
- Create `ChatInput.tsx` — text input with send button + fast/deep toggle
- Add sidebar toggle button to toolbar
- Implement responsive behaviour (fixed sidebar desktop, drawer mobile)
- Wire sidebar open/close state
- **Test:** Toggle sidebar open/close, verify dashboard reflows. Type in input, verify it captures text.

### Step 7: Chat API Endpoint
- Create `app/api/chat/route.ts`
- Implement basic OpenRouter proxy: forward messages, return response
- Handle auth (OpenRouter API key from env)
- For now, agent just responds as a basic chat (no tool use, no structured modifications)
- **Test:** Send a message from the UI, get a response back, display it in the thread.

### Step 8: Chat → Chapter Pipeline
- When the API response includes a proposed modification (detected via structured output parsing), display it as a modification card in the chat with [Apply] [Adjust] buttons
- [Apply] creates a chapter and adds to state
- [Adjust] focuses the input for user refinement
- Handle the conversation loop: user refines → agent updates proposal → user applies
- **Test:** Full flow — type a scenario, get a proposed modification, apply it, see dashboard update.

### Step 9: Polish
- Smooth animations for sidebar toggle and chapter add/remove
- Loading states in chat (thinking indicator, search progress for deep mode)
- Chat auto-scrolls to newest message
- Input clears after send
- Enter to send, Shift+Enter for newline
- Chapter count badge on sidebar toggle button when closed
- Mobile drawer with swipe-to-close
- **Test:** Full end-to-end on desktop and mobile.

---

## Important Notes

### State Architecture
All scenario state (chapters, chat messages, mode) lives in the Dashboard component or a React context provider. It is NOT persisted to any backend or local storage in V3A. Refreshing the page resets everything. Persistence is a future enhancement.

### The Chat API is a Thin Proxy in V3A
The `app/api/chat/route.ts` in V3A is intentionally simple — it forwards messages to OpenRouter and returns the response. The sophisticated agent behaviour (research plans, tool execution loops, structured modification output) is defined in V3B. V3A just needs the endpoint to exist and handle basic message forwarding so the UI can be tested.

To test V3A independently of V3B, the chat endpoint can use a simple system prompt that instructs the model to respond with mock modifications in a known JSON format. This lets you build and test the entire UI pipeline without the full agent implementation.

### Chapter Ordering Matters
Chapters are applied in creation order (oldest first). This means if Chapter 1 reduces Newcastle's win probability by 10pp and Chapter 2 is a fixture lock for Newcastle to win, the lock overrides the modification for that specific fixture. This is correct behaviour — a fixture lock is a certainty that supersedes probability adjustments.

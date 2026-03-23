# CLAUDE-KYLE.md — Keepwatch: Chat-Invert Mode

## Overview

**Kyle** is a layout inversion mode for Keepwatch. Named after Kyle Walker — the inverted fullback who moves into unfamiliar space and makes it his own — Kyle flips the default dashboard/chat ratio so Chat becomes the primary workspace.

In the standard V3A layout, Chat is a 380px sidebar (~20% of screen). The dashboard gets the remaining 80%. This is fine for casual scenario browsing, but wrong for deep chat sessions where you're having a real back-and-forth with the agent. The chat thread is cramped, responses require constant scrolling, and the huge dashboard area sits mostly inert while you're thinking.

Kyle fixes this. One toggle inverts the layout: Chat takes ~80%, a mini-dashboard panel takes the rest.

---

## The Two Layouts

### Default (V3A standard)

```
┌──────────────────────────────────────────┬─────────────────┐
│                                          │  SCENARIOS      │
│                                          │  [chapters]     │
│           DASHBOARD                      │  ─────────────  │
│           (~80% width)                   │  Chat thread    │
│                                          │  ...            │
│                                          │  ...            │
│                                          │  ─────────────  │
│                                          │  [Fast|Deep]    │
│                                          │  [input] [→]    │
└──────────────────────────────────────────┴─────────────────┘
                                               ~380px fixed
```

### Kyle Mode (inverted)

```
┌─────────────────┬────────────────────────────────────────────┐
│  MINI-DASH      │                                            │
│  ─────────────  │                                            │
│  Survival 100%  │            CHAT WORKSPACE                  │
│  Relegation 0%  │            (~80% width)                    │
│  Any Europe 33% │                                            │
│  UCL 2.3%       │                                            │
│  ─────────────  │                                            │
│  [histogram]    │                                            │
│  ─────────────  │                                            │
│  High-leverage  │                                            │
│  fixtures       │                                            │
│  (scrollable)   │                                            │
│                 │                                            │
│                 │                                            │
└─────────────────┴────────────────────────────────────────────┘
   ~280px fixed
```

---

## What Changes

### Chat Workspace (right panel, ~80%)

The chat thread and input box expand to fill the available space. Specifically:

- **Thread area:** Full height minus input. With ~4× the width, agent responses render as proper paragraphs — no more reading a 200-word analysis in a 300px-wide column.
- **Input box:** Default height increases from 1 line to 3 lines. Still auto-expands. The extra height signals "this is a real workspace, write more if you want."
- **Message bubbles:** Max-width cap increases from 85% to 72% of the new panel width — keeps long messages readable without going full-width.
- **Fast/Deep toggle:** Stays at the bottom of the chat panel, same position as V3A.
- **Chapter notification toasts:** Applied chapters still appear inline in the thread as system messages. No change here.

The chat panel is otherwise identical to V3A's ChatSidebar thread — same components, same logic, just wider.

### Mini-Dashboard Panel (left panel, ~280px)

This is not a compressed version of the full dashboard. It is a purpose-built glanceable panel showing only what matters when you're mid-conversation. Three sections, in order:

#### Section 1 — Qualification Cards (compact)

The 4 context-sensitive outcome cards from V3A, reformatted for a narrow column:

```
SURVIVAL          100.0%  ████████████████
RELEGATION          0.0%  ░░░░░░░░░░░░░░░░
ANY EUROPE         32.9%  █████░░░░░░░░░░░
CHAMPIONS LEAGUE    2.3%  ░░░░░░░░░░░░░░░░
```

- Vertical stack instead of horizontal row
- Bar underneath each percentage (same colour coding as main dashboard)
- If chapters are active: show delta annotations (+2.1pp in teal / -0.8pp in red)
- Tapping a card does nothing in Kyle mode — these are read-only indicators

#### Section 2 — Position Distribution (mini histogram)

A compact version of the finishing position histogram:

- Same data, rendered at ~240px wide × ~80px tall
- Axis labels reduced to every 5th position
- Colour coding preserved (UCL, Europa, Conference, Relegation zones)
- No interactivity — this is a glance, not an exploration

This section is the biggest thing missing from a chat-only view, and worth the space. Seeing the shape of possible outcomes while you're constructing a scenario is genuinely useful.

#### Section 3 — High-Leverage Fixtures (scrollable list)

The top 5 high-leverage fixtures from the sensitivity analysis, compact format:

```
Everton vs Chelsea      0.0pp
Leeds vs Brentford      0.0pp
...
```

- Fixture name + max impact delta
- Green = good for selected team, red = bad
- Scrollable if needed
- Tapping a fixture does nothing in Kyle mode (no what-if from here)

No other dashboard sections appear in the mini-panel. The full standings table, full fixture list, insight cards, scenario comparison strip — all hidden in Kyle mode. The user can exit Kyle at any time to access them.

---

## Toggle Mechanics

### Entering Kyle Mode

Kyle is triggered by a button in the main toolbar. Placement: immediately right of the Chat button, using an invert/swap icon (⇄ or ↔). Label: none on desktop (icon only), "Kyle" or "Focus" on mobile if needed for clarity.

The button is only enabled when Chat is open. If chat is closed and you click the Kyle button, it opens chat and activates Kyle simultaneously.

Visual treatment: when Kyle is active, the toggle button has a filled/active state using the team accent colour — same visual language as the Chat button when open.

### Exiting Kyle Mode

Three ways to exit:
1. Click the Kyle toggle button again
2. Click the Chat button (toggles chat off, which also exits Kyle)
3. Press Escape (same as closing chat in V3A)

Exiting Kyle returns to the standard V3A layout. The chat session, chapters, and all state are preserved — Kyle is purely a layout change.

### State Persistence

Kyle mode is stored in `localStorage` as `keepwatch_kyle_active: boolean`. If you refresh mid-session, it restores the layout preference. It is not stored in URL state (the URL reflects team selection, not UI layout).

Kyle mode is **per-browser**, not per-team. If you switch teams while in Kyle mode, you stay in Kyle mode.

---

## Layout Transitions

Kyle mode toggles with a smooth horizontal resize animation:

- Duration: 300ms
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)` (standard material easing)
- Both panels resize simultaneously — no flash, no layout jump
- Chat content reflows during the transition (acceptable, unavoidable with CSS flex)

No entry/exit animations for individual panel contents — the cards and thread don't fly in, they just become visible as the panel expands.

---

## Responsive Behaviour

### Desktop (≥1024px)
Full Kyle mode as described. Mini-dashboard 280px, chat ~80% of remaining width.

### Tablet (768px–1023px)
Kyle mode is available but the mini-dashboard reduces to 220px. The qualification cards drop the bar and show percentage only. The histogram hides entirely (too small to be useful). High-leverage fixtures remain.

### Mobile (<768px)
Kyle mode is disabled. On mobile, chat is already a full-screen drawer (V3A behaviour). The Kyle toggle button is hidden. The mini-dashboard has no useful home at this screen size.

---

## New/Modified Files

```
app/
├── components/
│   ├── Dashboard.tsx              # MODIFY: Accept kyleMode state, adjust layout wrapper
│   ├── ChatSidebar.tsx            # MODIFY: Expand when kyleMode active, wider thread/input
│   ├── KyleToggle.tsx             # NEW: Toggle button component
│   ├── KyleMiniDashboard.tsx      # NEW: The 280px left panel in Kyle mode
│   ├── KyleQualCards.tsx          # NEW: Compact vertical qualification cards
│   ├── KyleMiniHistogram.tsx      # NEW: Compact position distribution chart
│   └── KyleLeverageList.tsx       # NEW: Top 5 high-leverage fixtures, compact

lib/
├── kyle.ts                        # NEW: Kyle state management (localStorage read/write)
```

---

## New Types

```typescript
// Add to lib/chat-types.ts or lib/types.ts

interface KyleState {
  active: boolean;
}

// Props extension for Dashboard
interface DashboardProps {
  // ... existing props
  kyleMode: boolean;
  onKyleModeChange: (active: boolean) => void;
}

// Props for KyleMiniDashboard
interface KyleMiniDashboardProps {
  simulationResult: SimulationResult | null;
  baselineResult: SimulationResult | null;          // for delta display
  sensitivityResults: SensitivityResult[] | null;
  selectedTeam: string;
  accentColor: string;
  chapters: Chapter[];                               // for delta annotations
}
```

---

## KyleToggle Component

```typescript
// app/components/KyleToggle.tsx

interface KyleToggleProps {
  active: boolean;
  chatOpen: boolean;
  onToggle: () => void;
  accentColor: string;
}

// Renders a ⇄ icon button
// Disabled + hidden when chat is closed (or show as greyed-out, designer preference)
// Active state: filled background using accentColor at 20% opacity, 
//               border using accentColor at 40% opacity
// Tooltip: "Kyle mode — focus chat" / "Exit Kyle mode"
// Placed immediately right of the Chat toggle button in the toolbar
```

---

## KyleMiniDashboard Component

```typescript
// app/components/KyleMiniDashboard.tsx
// The 280px left column in Kyle mode

// Layout (top to bottom, full height):
// 1. Team name + position pill (e.g. "Newcastle · 11th")
// 2. KyleQualCards — the 4 outcome cards, compact vertical
// 3. Divider
// 4. KyleMiniHistogram — 240×80px position distribution
// 5. Divider
// 6. KyleLeverageList — top 5 high-leverage fixtures, scrollable
// 7. Spacer / flex-grow to push everything to the top

// The panel has the same dark background as the chat sidebar (#0d0d0d)
// Left border: 1px solid white/6% (same as chat sidebar right border in V3A)
// This panel is on the LEFT — so it borders the chat on its right side
```

---

## KyleQualCards Component

```typescript
// app/components/KyleQualCards.tsx

// Renders the 4 context-sensitive qualification cards as a vertical stack
// Data source: same simulationResult that powers the main QualificationCards
// 
// Each card:
//   [LABEL]       [PCT]
//   [████░░░░░░░░░░░]
//
// Label: all-caps, tracking-widest, 9px, white/40
// Percentage: Oswald font, 16px, coloured (green/red/teal/gold as per zone)
// Bar: 100% width of panel, 3px height, same colour
//
// If chapters active AND baseline differs from modified result:
//   Show delta inline next to percentage: "+2.1pp" in teal or "-0.8pp" in red
//   Font: 9px, same colour as delta direction
//   Delta only shown if |delta| >= 0.1pp (suppress noise)
```

---

## KyleMiniHistogram Component

```typescript
// app/components/KyleMiniHistogram.tsx

// Compact rendering of the finishing position distribution
// Dimensions: 240px wide × 80px tall (or full panel width minus padding)
// 
// Implementation: recharts BarChart (same library as main histogram)
// Bars: same colour zones (UCL/Europa/Conference/Relegation/Mid)
// X-axis: show labels at positions 1, 5, 10, 15, 20 only
// Y-axis: hidden (no room, and the shape is what matters)
// Tooltip: preserved — hovering a bar shows "Position X: N%" 
// No legend (no room — the main dashboard has it)
//
// This is a direct data passthrough from simulationResult.positionDistribution
// No recomputation needed
```

---

## KyleLeverageList Component

```typescript
// app/components/KyleLeverageList.tsx

// Top 5 fixtures from sensitivityResults, sorted by maxAbsDelta desc
// 
// Each row:
//   [HomeTeam] vs [AwayTeam]     [+X.Xpp / -X.Xpp]
//
// Colour of delta: teal if positive for selected team, red if negative
// Font: 11px for teams, 10px for delta
// Row height: ~28px
// Max 5 rows (don't scroll if possible, scroll if content overflows)
//
// If sensitivityResults is null (still loading): show 5 skeleton rows
// If sensitivityResults is empty: show "No high-leverage fixtures found"
```

---

## State Wiring

Kyle state lives in `page.tsx` (or the top-level layout component), alongside the existing `chatOpen` state:

```typescript
// page.tsx (or Dashboard.tsx depending on current architecture)

const [chatOpen, setChatOpen] = useState(false);
const [kyleMode, setKyleMode] = useState<boolean>(() => {
  // Restore from localStorage on mount
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('keepwatch_kyle_active') === 'true';
});

const handleKyleToggle = useCallback(() => {
  setKyleMode(prev => {
    const next = !prev;
    localStorage.setItem('keepwatch_kyle_active', String(next));
    // If activating Kyle and chat isn't open, open it
    if (next && !chatOpen) setChatOpen(true);
    return next;
  });
}, [chatOpen]);

// If chat is closed externally (e.g. Escape key), also exit Kyle
const handleChatClose = useCallback(() => {
  setChatOpen(false);
  setKyleMode(false);
  localStorage.setItem('keepwatch_kyle_active', 'false');
}, []);
```

---

## Dashboard Layout Changes

In V3A, the layout is roughly:

```
<div className="flex h-screen">
  <main className="flex-1 overflow-y-auto">
    {/* Dashboard content */}
  </main>
  {chatOpen && <ChatSidebar className="w-[380px] shrink-0" />}
</div>
```

In Kyle mode, this becomes:

```
<div className="flex h-screen">
  {kyleMode && chatOpen && (
    <KyleMiniDashboard className="w-[280px] shrink-0" />
  )}
  <main className={`overflow-y-auto transition-all duration-300 ${
    kyleMode && chatOpen ? 'hidden lg:hidden' : 'flex-1'
  }`}>
    {/* Full dashboard — hidden in Kyle mode on desktop */}
  </main>
  {chatOpen && (
    <ChatSidebar className={`transition-all duration-300 ${
      kyleMode ? 'flex-1' : 'w-[380px] shrink-0'
    }`} />
  )}
</div>
```

The full dashboard content is hidden (not unmounted) in Kyle mode. This preserves React state — charts, simulation results, scroll positions — so re-entering normal mode is instant.

---

## Chat Input Changes in Kyle Mode

When `kyleMode` is true, `ChatInput.tsx` receives a `expanded` prop:

```typescript
interface ChatInputProps {
  // ... existing props
  expanded?: boolean;   // true when in Kyle mode
}
```

When `expanded` is true:
- `rows` on the textarea increases from 1 to 3
- `minHeight` increases from 38px to 72px
- Max-height for auto-expansion increases from 120px to 200px
- The Fast/Deep toggle moves from below the input to the top-right of the input row (less vertical stack, more horizontal layout to use the width)

---

## Build Order

### Step 1: Kyle State + Toggle
- Create `lib/kyle.ts` with localStorage read/write helpers
- Add `kyleMode` state to `page.tsx` or `Dashboard.tsx`
- Create `KyleToggle.tsx` — just the button, no layout changes yet
- Add toggle to toolbar, wired to state
- **Test:** Click toggle, verify state flips. Refresh page, verify it restores from localStorage.

### Step 2: Layout Skeleton
- Modify `Dashboard.tsx` layout wrapper to support Kyle mode flex changes
- Hide full dashboard content in Kyle mode (CSS only — no unmounting)
- Expand ChatSidebar to `flex-1` in Kyle mode
- **Test:** Toggle Kyle, verify chat expands to ~80% of screen. Full dashboard hidden. Verify re-entering normal mode shows dashboard instantly (no reload).

### Step 3: Mini-Dashboard Panel
- Create `KyleMiniDashboard.tsx` shell with correct width and border
- Add team name + position pill
- **Test:** Kyle mode shows mini-dashboard on left, chat on right. Panel is 280px, chat fills the rest.

### Step 4: KyleQualCards
- Create `KyleQualCards.tsx`
- Wire to `simulationResult` from Dashboard state
- Wire deltas to `baselineResult` vs `modifiedResult`
- **Test:** Qualification percentages match main dashboard. Apply a chapter, verify deltas appear.

### Step 5: KyleMiniHistogram
- Create `KyleMiniHistogram.tsx`
- Pass `simulationResult.positionDistribution`
- **Test:** Shape of histogram matches main dashboard histogram. Correct colour zones.

### Step 6: KyleLeverageList
- Create `KyleLeverageList.tsx`
- Wire to `sensitivityResults`
- **Test:** Shows correct top 5 fixtures. Green/red colouring matches main sensitivity chart.

### Step 7: Chat Input Expansion
- Add `expanded` prop to `ChatInput.tsx`
- Pass `expanded={kyleMode}` from ChatSidebar
- **Test:** In Kyle mode, input is 3 lines tall. Fast/Deep toggle repositions. Auto-expand still works.

### Step 8: Transitions + Polish
- Add `transition-all duration-300` to layout wrapper
- Verify resize animation is smooth
- Add tooltip to KyleToggle button
- Disable KyleToggle on mobile (hidden)
- **Test:** Toggle in and out rapidly — no layout jank. Feels snappy.

---

## Important Notes

### Why the Dashboard is Hidden, Not Removed

In Kyle mode, the full dashboard is hidden with CSS (`hidden` class or `display: none`), not conditionally rendered. This is deliberate:

- Simulation results, histogram data, and sensitivity results remain in React state
- Re-entering normal mode is instant — no re-render, no data re-fetch
- Charts stay mounted, which means no chart re-initialisation lag

The cost is that hidden components still occupy memory. This is acceptable for Keepwatch's component count. If it becomes a problem, a 30-second idle unmount with state preservation in a ref is a simple future optimisation.

### Kyle Does Not Affect Simulation

Kyle is a layout mode only. It reads from the same `simulationResult`, `baselineResult`, `sensitivityResults`, and `chapters` state as the main dashboard. It does not trigger re-simulation, does not modify chapter state, and does not affect what the agent sees in its context.

### Chapters Still Apply in Kyle Mode

Chapter creation via the chat still works exactly as in V3A. The mini-dashboard qualification cards will show updated percentages and deltas in real time as chapters are applied. The agent's next message will also be informed by the updated state. No special handling needed.

### The Name

Kyle stays internal. The user-facing button is an icon (⇄) with a tooltip. "Kyle mode" is not surfaced in the UI — it's what we call it in the codebase and in these docs. If the feature ever needs a public label, "Focus mode" or "Chat mode" are sensible options. But for now: Kyle.

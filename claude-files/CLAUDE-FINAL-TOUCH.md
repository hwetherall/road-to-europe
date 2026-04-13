# CLAUDE-FINAL-TOUCH.md — Pre-Launch Bug Fixes

Execute all 4 tasks below in order. Each has the exact file, the exact problem, and the exact fix.

---

## Task 1: Fix chat abbreviation mismatch in `app/api/chat/route.ts`

### Problem
Line 235 of `app/api/chat/route.ts` contains a hardcoded team abbreviation list in the system prompt that is **wrong**. It uses generic abbreviations that don't match the abbreviations used everywhere else in the codebase (`lib/constants.ts`, `HARDCODED_STANDINGS`, `ODDS_API_NAME_MAP`, etc.).

The broken line reads:
```
Team abbreviations: ARS, AVL, BOU, BRE, BHA, BUR, CHE, CRY, EVE, FUL, LIV, LUT, MCI, MUN, NEW, NFO, TOT, WHU, WOL, IPS
```

The mismatches are:
| Wrong (in prompt) | Correct (in codebase) | Team |
|---|---|---|
| BHA | BRI | Brighton |
| CHE | CFC | Chelsea |
| LIV | LFC | Liverpool |
| LUT | LEE | Leeds (Luton isn't in this season) |
| IPS | SUN | Sunderland (Ipswich isn't in this season) |

### Fix
Replace that single line with the correct abbreviations that match `HARDCODED_STANDINGS` in `lib/constants.ts`:

```
Team abbreviations: ARS, MCI, MUN, AVL, CFC, LFC, BRE, FUL, EVE, BRI, NEW, BOU, SUN, CRY, LEE, TOT, NFO, WHU, BUR, WOL
```

### Why it matters
When the AI generates a fixture lock or probability modifier using `CHE`, `LIV`, `BHA`, etc., the modification engine in `lib/modification-engine.ts` tries to match `f.homeTeam === teamMod.team` — and finds nothing, because no fixture uses those abbreviations. The scenario silently does nothing. This breaks the chat feature for Chelsea, Liverpool, Brighton, Leeds, and Sunderland.

### Verification
After the fix, search the entire codebase for `BHA`, `CHE` (as a team code, not part of "Chelsea"), `LIV` (as a team code), `LUT`, and `IPS`. None of these should appear as team abbreviation values anywhere.

---

## Task 2: Remove the dead "Adjust" button in `app/components/ChatThread.tsx`

### Problem
Inside the `ModificationCard` component (around lines 64-74), there is an "Adjust" button that renders but has **no `onClick` handler**. It does nothing when clicked. This will confuse users who expect it to let them refine the scenario.

The broken code is the second `<button>` inside the `!applied` branch:
```tsx
<button className="px-3 py-1.5 rounded text-[11px] text-white/40 border border-white/10 hover:border-white/20 bg-transparent transition-colors cursor-pointer">
  Adjust
</button>
```

### Fix
Delete that entire `<button>` element. Keep the "Apply" button and the surrounding `<div className="flex gap-2 mt-2">` wrapper. The result should be:

```tsx
{applied ? (
  <div className="mt-2 text-[11px] text-green-400/70">Applied</div>
) : (
  <div className="flex gap-2 mt-2">
    <button
      onClick={onApply}
      className="px-3 py-1.5 rounded text-[11px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors cursor-pointer"
    >
      Apply
    </button>
  </div>
)}
```

### Why it matters
A non-functional button on a launched product looks broken. Users will click it, nothing happens, and they lose trust in the tool.

---

## Task 3: Write a real README.md

### Problem
The current `README.md` is the default `create-next-app` boilerplate. It mentions "Geist" font (not used), has no description of what Keepwatch does, and provides no context for someone landing on the repo from LinkedIn.

### Fix
Replace the entire contents of `README.md` with a proper project README. Use this structure:

```markdown
# Keepwatch — EPL Season Simulator

Keepwatch is a Monte Carlo simulation tool that calculates the probability of any Premier League team qualifying for European competition, getting relegated, or winning the title. It runs 10,000 season simulations using real bookmaker odds and Elo-derived probabilities, then identifies the specific fixtures — out of ~80 remaining — that have the highest leverage on your team's odds.

Beyond the numbers, Keepwatch features an AI-powered scenario chat where you can ask "what if Bruno Guimarães is injured for 6 weeks?" and get a quantified probability modification applied to the simulation in real time. A Deep Analysis mode runs targeted web research on the teams involved in high-leverage fixtures and produces a long-form tactical report.

Built with Next.js 14 (App Router), Tailwind CSS, and TypeScript. Simulation runs client-side. AI features powered by OpenRouter (Claude). Live data from football-data.org and the-odds-api.com. Deployed on Vercel.

## Features

- **Monte Carlo simulation** — 10,000 season outcomes with Poisson-distributed goal sampling
- **Sensitivity analysis** — identifies which fixtures move your team's odds the most
- **What-If mode** — lock any fixture result and see the impact in real time
- **AI scenario chat** — describe scenarios in natural language, get quantified probability modifications
- **Deep Analysis** — AI-researched tactical reports on high-leverage fixtures
- **Any team** — works for all 20 Premier League clubs, auto-adapts cards and metrics to context (title race, European push, relegation battle)

## Getting Started

```bash
npm install
cp .env.example .env.local  # Add your API keys
npm run dev
```

### Required Environment Variables

| Variable | Source | Purpose |
|---|---|---|
| `FOOTBALL_DATA_API_KEY` | [football-data.org](https://www.football-data.org/client/register) | Live standings and fixtures |
| `ODDS_API_KEY` | [the-odds-api.com](https://the-odds-api.com) | Bookmaker match probabilities |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) | AI chat and deep analysis |
| `SERPER_API_KEY` | [serper.dev](https://serper.dev) | Web search for AI research |

The app works without any API keys — it falls back to hardcoded standings and Elo-estimated probabilities. AI features require `OPENROUTER_API_KEY`.

## Tech Stack

- **Frontend:** Next.js 14 (App Router) + Tailwind CSS v4
- **Simulation:** Client-side Monte Carlo engine (TypeScript)
- **Data:** football-data.org (standings + fixtures) + the-odds-api.com (match probabilities)
- **AI:** OpenRouter (scenario chat + deep analysis)
- **Search:** Serper (primary) + Tavily (fallback)
- **Cache:** Supabase (deep analysis report caching)
- **Hosting:** Vercel
```

Do NOT add any screenshot placeholder or image reference — there is no screenshot file in the repo.

---

## Task 4: Add Office temp files to `.gitignore`

### Problem
The file `~$epwatch-V5-Roadmap.docx` is an Office temp/lock file showing up as untracked in git status. These files are created when a `.docx` is open in Word and should never be committed.

### Fix
Add this line to the end of `.gitignore`:

```
# office temp files
~$*
```

This pattern matches all Office lock files (`~$` prefix).

---

## Execution Order

1. Task 1 (chat abbreviations) — highest priority, this is a functional bug
2. Task 2 (Adjust button) — quick delete
3. Task 3 (README) — full file replacement
4. Task 4 (.gitignore) — one line append

After all 4 tasks, run `npm run build` to verify no TypeScript or build errors were introduced.

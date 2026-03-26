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

import Dashboard from './components/Dashboard';
import { listWeeklyPreviews } from '@/lib/weekly-preview/cache';
import { listWeeklyRoundups } from '@/lib/weekly-roundup/cache';

export const dynamic = 'force-dynamic';

interface HomeProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const resolvedSearchParams = await searchParams;
  const teamParam = resolvedSearchParams.team;
  const rawTeam = Array.isArray(teamParam) ? teamParam[0] : teamParam;
  const normalizedTeam = rawTeam?.toUpperCase();
  const initialTeam =
    normalizedTeam && /^[A-Z]{3}$/.test(normalizedTeam) ? normalizedTeam : 'NEW';

  const [previews, roundups] = await Promise.all([
    listWeeklyPreviews('NEW'),
    listWeeklyRoundups('NEW'),
  ]);

  const weeklyReports = [
    ...previews.map((item) => ({
      id: `preview-${item.id}`,
      kind: 'preview' as const,
      label: `MD ${item.matchday} Preview`,
      href: `/weekly-preview?matchday=${item.matchday}`,
      latestHref: '/weekly-preview',
      matchday: item.matchday,
      season: item.season,
      generatedAt: item.generatedAt,
      status: item.status,
    })),
    ...roundups.map((item) => ({
      id: `roundup-${item.id}`,
      kind: 'roundup' as const,
      label: `MD ${item.matchday} Roundup`,
      href: `/weekly-roundup?matchday=${item.matchday}`,
      latestHref: '/weekly-roundup',
      matchday: item.matchday,
      season: item.season,
      generatedAt: item.generatedAt,
      status: item.status,
    })),
  ].sort((a, b) => b.generatedAt - a.generatedAt);

  return <Dashboard initialTeam={initialTeam} weeklyReports={weeklyReports} />;
}

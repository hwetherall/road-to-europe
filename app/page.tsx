import Dashboard from './components/Dashboard';

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

  return <Dashboard initialTeam={initialTeam} />;
}

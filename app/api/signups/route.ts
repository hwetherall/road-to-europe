import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; email?: unknown; source?: unknown }
    | null;

  const name = normalizeText(body?.name);
  const email = normalizeText(body?.email).toLowerCase();
  const source = normalizeText(body?.source) || 'launch';

  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 });
  }

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json({ error: 'Signup storage is not configured.' }, { status: 503 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabase.from('signups').insert({
    name,
    email,
    source: source.slice(0, 80),
  });

  if (error && error.code !== '23505') {
    return NextResponse.json({ error: 'Unable to save signup.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

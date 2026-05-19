'use client';

import { FormEvent, useState } from 'react';

type SignupStatus = 'idle' | 'loading' | 'done' | 'error';

export default function SignupForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<SignupStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextName = name.trim();
    const nextEmail = email.trim();

    if (!nextName || !nextEmail) {
      setErrorMessage('Add your name and email to sign up.');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const response = await fetch('/api/signups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nextName,
          email: nextEmail,
          source: 'dashboard',
        }),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error ?? 'Something went wrong. Try again?');
      }

      setStatus('done');
      setName('');
      setEmail('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong. Try again?');
      setStatus('error');
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-teal-400/25 bg-gradient-to-br from-teal-400/[0.08] via-white/[0.03] to-transparent p-5">
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div className="max-w-[360px]">
          <div className="font-oswald text-[13px] tracking-[0.14em] uppercase text-teal-200/90 mb-2">
            Stay in the loop
          </div>
          <p className="text-[12.5px] text-white/60 leading-5">
            Leave your name and email for Keepwatch updates as new features ship.
          </p>
        </div>

        {status === 'done' ? (
          <div className="rounded-lg border border-green-400/25 bg-green-400/[0.08] px-4 py-3 text-[12.5px] text-green-100">
            You&apos;re in. We&apos;ll be in touch.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-1 items-start gap-2 min-w-[280px] flex-wrap">
            <input
              type="text"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              autoComplete="name"
              required
              className="min-w-[130px] flex-1 rounded-lg border border-white/[0.12] bg-black/30 px-3 py-2.5 text-[13px] text-white placeholder:text-white/30 outline-none transition-colors focus:border-teal-300/60"
            />
            <input
              type="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              autoComplete="email"
              required
              className="min-w-[190px] flex-1 rounded-lg border border-white/[0.12] bg-black/30 px-3 py-2.5 text-[13px] text-white placeholder:text-white/30 outline-none transition-colors focus:border-teal-300/60"
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="rounded-lg bg-gradient-to-br from-teal-500 to-teal-700 px-4 py-2.5 font-oswald text-[12px] font-bold uppercase tracking-widest text-white transition-all hover:from-teal-400 hover:to-teal-600 disabled:cursor-wait disabled:opacity-55"
            >
              {status === 'loading' ? 'Submitting...' : 'Submit'}
            </button>
            {status === 'error' && (
              <p className="basis-full text-[12px] text-red-300">{errorMessage}</p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}

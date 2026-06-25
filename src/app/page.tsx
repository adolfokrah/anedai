'use client';

import { ArrowRight, GitBranch, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as api from '@/lib/api';
import { DEFAULT_MODEL } from '@/lib/models';
import type { ProjectManifest } from '@/lib/types';

type Tab = 'scratch' | 'repo';

export default function Landing() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('scratch');
  const [prompt, setPrompt] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectManifest[]>([]);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => {});
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body =
        tab === 'scratch'
          ? { mode: 'scratch', initialPrompt: prompt, model: DEFAULT_MODEL }
          : { mode: 'repo', repoUrl };
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error ?? `${res.status} ${res.statusText}`);
      }
      const { slug } = (await res.json()) as { slug: string };
      router.push(`/projects/${slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const canSubmit =
    tab === 'scratch' ? prompt.trim().length > 0 : repoUrl.trim().length > 0;

  return (
    <main className='relative mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-16'>
      {/* ambient glow */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-24 -z-10 mx-auto h-64 max-w-md rounded-full bg-violet-600/20 blur-3xl'
      />

      <div className='mb-9 text-center'>
        <div className='mx-auto mb-5 size-11 rounded-xl bg-linear-to-br from-violet-500 to-indigo-500 shadow-lg shadow-violet-500/20' />
        <h1 className='text-3xl font-semibold tracking-tight'>
          What should we build?
        </h1>
        <p className='mt-2.5 text-[15px] text-muted-foreground'>
          Describe an app or connect a repo. The agent writes real React in a
          live sandbox — then opens a PR.
        </p>
      </div>

      <div className='mb-3 flex gap-1 rounded-xl border border-border/60 bg-card/60 p-1'>
        <TabButton active={tab === 'scratch'} onClick={() => setTab('scratch')}>
          <Sparkles className='size-4' /> Build from scratch
        </TabButton>
        <TabButton active={tab === 'repo'} onClick={() => setTab('repo')}>
          <GitBranch className='size-4' /> Connect a repo
        </TabButton>
      </div>

      <div className='rounded-2xl border border-border/70 bg-card p-2 shadow-sm transition-colors focus-within:border-border'>
        {tab === 'scratch' ? (
          <textarea
            // biome-ignore lint/a11y/noAutofocus: primary input on a focused task screen
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder='A pricing page with three tiers and a FAQ…'
            rows={3}
            className='w-full resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-muted-foreground/70'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit)
                create();
            }}
          />
        ) : (
          <Input
            autoFocus
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder='https://github.com/owner/repo.git'
            className='h-11 border-0 bg-transparent text-[15px] shadow-none focus-visible:ring-0'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) create();
            }}
          />
        )}
        <div className='flex items-center justify-between px-2 pb-1'>
          <span className='text-[11px] text-muted-foreground/60'>
            {tab === 'scratch' ? '⌘↵ to start' : '↵ to clone'}
          </span>
          <Button
            size='sm'
            className='h-8 gap-1.5 rounded-lg'
            disabled={!canSubmit || busy}
            onClick={create}
          >
            {busy ? 'Creating…' : 'Start'}
            {!busy && <ArrowRight className='size-4' />}
          </Button>
        </div>
      </div>

      {error && <p className='mt-3 text-sm text-destructive'>{error}</p>}

      {projects.length > 0 && (
        <div className='mt-10'>
          <p className='mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground/70 uppercase'>
            Your projects
          </p>
          <div className='divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/40'>
            {projects.map((p) => (
              <Link
                key={p.slug}
                href={`/projects/${p.slug}`}
                className='flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/50'
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    p.status === 'ready'
                      ? 'bg-emerald-500'
                      : p.status === 'error'
                        ? 'bg-destructive'
                        : 'bg-muted-foreground/40'
                  }`}
                />
                <span className='min-w-0 flex-1 truncate text-sm'>
                  {p.name}
                </span>
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {p.mode === 'repo' ? 'repo' : 'scratch'}
                </span>
                <ArrowRight className='size-3.5 shrink-0 text-muted-foreground/50' />
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

'use client';

import {
  ArrowRight,
  Check,
  GitBranch,
  Lock,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ModelPicker } from '@/components/model-picker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import * as api from '@/lib/api';
import { DEFAULT_MODEL } from '@/lib/models';
import type { ProjectManifest } from '@/lib/types';
import { useModels } from '@/lib/use-models';

type Tab = 'scratch' | 'repo';

/**
 * Downscale + re-encode an image on the client before it's stashed for the
 * workspace. Phone photos are multi-MB as base64 and blow sessionStorage's
 * ~5MB quota (so the handoff silently drops them). Claude vision caps useful
 * detail at ~1568px, so shrinking the longest edge to that + JPEG keeps quality
 * for the agent while cutting size ~10-50x. Falls back to the raw read on error.
 */
const MAX_EDGE = 1568;
function loadImageFile(
  file: File,
): Promise<{ url: string; data: string; mediaType: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result);
      const fallback = () =>
        resolve({
          url: raw,
          data: raw.split(',')[1] ?? '',
          mediaType: file.type,
        });
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          if (scale === 1 && raw.length < 1_000_000) return fallback();
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return fallback();
          ctx.drawImage(img, 0, 0, w, h);
          const url = canvas.toDataURL('image/jpeg', 0.82);
          resolve({
            url,
            data: url.split(',')[1] ?? '',
            mediaType: 'image/jpeg',
          });
        } catch {
          fallback();
        }
      };
      img.onerror = fallback;
      img.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

/** Read a query param on the client (null during SSR). */
function initialParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** Update a query param in the URL without a navigation/re-render. */
function setParam(key: string, value: string) {
  if (typeof window === 'undefined') return;
  const u = new URL(window.location.href);
  u.searchParams.set(key, value);
  window.history.replaceState(null, '', u);
}

export default function Landing() {
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>(
    initialParam('tab') === 'repo' ? 'repo' : 'scratch',
  );
  const setTab = (t: Tab) => {
    setTabState(t);
    setParam('tab', t);
  };
  const [prompt, setPrompt] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  const [gh, setGh] = useState<{
    connected: boolean;
    login: string | null;
  } | null>(null);
  const [repos, setRepos] = useState<api.Repo[]>([]);
  const [repoQuery, setRepoQuery] = useState('');
  const [subdir, setSubdir] = useState('');
  const [startCmd, setStartCmd] = useState('');
  const [docsStartCmd, setDocsStartCmd] = useState('');
  const [docsSubdir, setDocsSubdir] = useState('');
  const [envText, setEnvText] = useState('');
  const [planMode, setPlanMode] = useState(false);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  // Models the server has keys for (+ its key-derived default).
  const { models: availableModels, defaultModel } = useModels();
  const userPickedModel = useRef(false);
  useEffect(() => {
    if (defaultModel && !userPickedModel.current) setModel(defaultModel);
  }, [defaultModel]);
  // Stable per-load cache-buster for thumbnails (fresh on reload, stable while here).
  const [listTs] = useState(() => Date.now());
  const [images, setImages] = useState<
    { id: string; url: string; data: string; mediaType: string }[]
  >([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      loadImageFile(file).then(({ url, data, mediaType }) => {
        setImages((a) => [
          ...a,
          { id: `${file.name}-${url.length}`, url, data, mediaType },
        ]);
      });
    }
  }

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => {});
    api
      .githubStatus()
      .then((s) => {
        setGh(s);
        if (s.connected)
          api
            .listRepos()
            .then(setRepos)
            .catch(() => {});
      })
      .catch(() => setGh({ connected: false, login: null }));
  }, []);

  function connectGitHub() {
    window.location.href = '/api/auth/github?next=/';
  }

  // Disconnect, then re-run OAuth. To land on a DIFFERENT account, the user must
  // be signed into it on github.com (GitHub silently reuses the signed-in one).
  async function switchAccount() {
    await api.disconnectGithub().catch(() => {});
    window.location.href = '/api/auth/github?next=/';
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body =
        tab === 'scratch'
          ? {
              mode: 'scratch',
              initialPrompt: prompt,
              model,
              initialMode: planMode ? 'plan' : 'build',
            }
          : {
              mode: 'repo',
              repoUrl,
              subdir: subdir.trim() || undefined,
              startCmd: startCmd.trim() || undefined,
              docsStartCmd: docsStartCmd.trim() || undefined,
              docsSubdir: docsSubdir.trim() || undefined,
              envText: envText.trim() || undefined,
            };
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
      // Hand the first turn's attachments to the workspace (avoids bloating the
      // manifest); the auto-send reads + clears this.
      if (tab === 'scratch' && images.length) {
        try {
          sessionStorage.setItem(
            `aned:init:${slug}`,
            JSON.stringify(
              images.map((i) => ({ data: i.data, mediaType: i.mediaType })),
            ),
          );
        } catch {
          // Too large for sessionStorage — proceed without; the user can
          // re-attach the image in the workspace composer.
        }
      }
      router.push(`/projects/${slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const canSubmit =
    tab === 'scratch' ? prompt.trim().length > 0 : repoUrl.trim().length > 0;

  return (
    <main className='relative mx-auto flex min-h-full max-w-5xl flex-col justify-center px-6 py-16'>
      {/* ambient glow */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-24 -z-10 mx-auto h-64 max-w-md rounded-full bg-violet-600/20 blur-3xl'
      />

      {/* The build box stays narrow; the projects grid below breaks out wider. */}
      <div className='mx-auto w-full max-w-xl'>
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
          <TabButton
            active={tab === 'scratch'}
            onClick={() => setTab('scratch')}
          >
            <Sparkles className='size-4' /> Build from scratch
          </TabButton>
          <TabButton active={tab === 'repo'} onClick={() => setTab('repo')}>
            <GitBranch className='size-4' /> Connect a repo
          </TabButton>
        </div>

        {tab === 'scratch' ? (
          <div className='rounded-2xl border border-border/70 bg-card p-2 shadow-sm transition-colors focus-within:border-border'>
            {images.length > 0 && (
              <div className='flex flex-wrap gap-2 px-1 pt-1 pb-1'>
                {images.map((a) => (
                  <div key={a.id} className='group relative'>
                    <img
                      src={a.url}
                      alt='attachment'
                      className='size-14 rounded-lg border border-border/60 object-cover'
                    />
                    <button
                      type='button'
                      onClick={() =>
                        setImages((p) => p.filter((x) => x.id !== a.id))
                      }
                      className='absolute -top-1.5 -right-1.5 rounded-full bg-background p-0.5 text-muted-foreground shadow ring-1 ring-border hover:text-foreground'
                    >
                      <X className='size-3' />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              // biome-ignore lint/a11y/noAutofocus: primary input on a focused task screen
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='A pricing page with three tiers and a FAQ…'
              rows={3}
              className='w-full resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-muted-foreground/70'
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.some((f) => f.type.startsWith('image/'))) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit)
                  create();
              }}
            />
            <div className='flex items-center gap-2 px-2 pb-1'>
              <input
                ref={fileRef}
                type='file'
                accept='image/*'
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type='button'
                title='Attach image'
                onClick={() => fileRef.current?.click()}
                className='flex size-7 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              >
                <Plus className='size-4' />
              </button>
              <div className='flex rounded-lg bg-muted/60 p-0.5 text-[11px]'>
                {(['build', 'plan'] as const).map((m) => (
                  <button
                    key={m}
                    type='button'
                    onClick={() => setPlanMode(m === 'plan')}
                    className={`rounded-md px-2 py-0.5 font-medium capitalize transition-colors ${
                      (m === 'plan') === planMode
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <ModelPicker
                model={model}
                setModel={(m) => {
                  userPickedModel.current = true;
                  setModel(m);
                }}
                models={availableModels}
              />
              <div className='ml-auto flex items-center gap-2'>
                <span className='text-[11px] text-muted-foreground/60'>
                  ⌘↵ to start
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
          </div>
        ) : gh === null ? (
          <div className='rounded-2xl border border-border/70 bg-card p-6 text-center text-sm text-muted-foreground'>
            Checking GitHub…
          </div>
        ) : !gh.connected ? (
          <div className='rounded-2xl border border-border/70 bg-card p-6 text-center'>
            <p className='text-sm text-muted-foreground'>
              Connect your GitHub to pick a repository to build on.
            </p>
            <Button className='mt-4 gap-1.5' onClick={connectGitHub}>
              <GitBranch className='size-4' /> Connect GitHub account
            </Button>
          </div>
        ) : (
          <div className='overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm'>
            <div className='flex items-center justify-between gap-2 border-b border-border/60 px-3.5 py-2'>
              <span className='flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground'>
                <Check className='size-3.5 shrink-0 text-emerald-500' />
                <span className='truncate'>
                  Connected as{' '}
                  <span className='text-foreground'>
                    {gh.login ?? 'GitHub'}
                  </span>
                </span>
              </span>
              <button
                type='button'
                onClick={switchAccount}
                className='shrink-0 text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline'
              >
                Switch account
              </button>
            </div>
            <input
              // biome-ignore lint/a11y/noAutofocus: primary input on a focused task screen
              autoFocus
              value={repoQuery}
              onChange={(e) => setRepoQuery(e.target.value)}
              placeholder={`Search ${gh.login ?? 'your'} repositories…`}
              className='w-full border-b border-border/60 bg-transparent px-3.5 py-2.5 text-[15px] outline-none placeholder:text-muted-foreground/70'
            />
            <div className='max-h-64 overflow-auto'>
              {repos
                .filter((r) =>
                  r.fullName.toLowerCase().includes(repoQuery.toLowerCase()),
                )
                .slice(0, 50)
                .map((r) => (
                  <button
                    key={r.cloneUrl}
                    type='button'
                    onClick={() => setRepoUrl(r.cloneUrl)}
                    className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm transition-colors hover:bg-muted/50 ${
                      repoUrl === r.cloneUrl ? 'bg-muted/60' : ''
                    }`}
                  >
                    {repoUrl === r.cloneUrl ? (
                      <Check className='size-3.5 shrink-0 text-emerald-500' />
                    ) : (
                      <span className='size-3.5 shrink-0' />
                    )}
                    <span className='min-w-0 flex-1 truncate'>
                      {r.fullName}
                    </span>
                    {r.private && (
                      <Lock className='size-3 shrink-0 text-muted-foreground/60' />
                    )}
                  </button>
                ))}
              {repos.length === 0 && (
                <p className='px-3.5 py-6 text-center text-sm text-muted-foreground'>
                  No repositories found.
                </p>
              )}
            </div>
            <details className='border-t border-border/60 [&_input]:mt-1.5'>
              <summary className='cursor-pointer list-none px-3.5 py-2.5 text-[13px] text-muted-foreground select-none hover:text-foreground'>
                Advanced — monorepo, custom start, docs server
              </summary>
              <div className='space-y-2.5 px-3.5 pb-3'>
                <AdvField
                  label='App directory (monorepo)'
                  value={subdir}
                  onChange={setSubdir}
                  placeholder='e.g. apps/web — empty = repo root'
                />
                <AdvField
                  label='App start command'
                  value={startCmd}
                  onChange={setStartCmd}
                  placeholder='e.g. pnpm dev:web — empty = agent detects'
                />
                <AdvField
                  label='Docs server command (Storybook etc.)'
                  value={docsStartCmd}
                  onChange={setDocsStartCmd}
                  placeholder='e.g. pnpm storybook — runs a 2nd server for the Design-system tab'
                />
                <AdvField
                  label='Docs directory'
                  value={docsSubdir}
                  onChange={setDocsSubdir}
                  placeholder='e.g. packages/ui — empty = repo root'
                />
                <label className='block text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase'>
                  Environment variables
                  <textarea
                    value={envText}
                    onChange={(e) => setEnvText(e.target.value)}
                    placeholder={
                      '.env contents (gitignored, never committed)\nDATABASE_URL=…\nSTRIPE_SECRET_KEY=…'
                    }
                    rows={4}
                    className='mt-1 w-full resize-none rounded-lg border border-border/60 bg-transparent px-2.5 py-1.5 font-mono text-[12px] font-normal tracking-normal text-foreground normal-case outline-none placeholder:text-muted-foreground/60 focus:border-border'
                  />
                </label>
              </div>
            </details>
            <div className='flex items-center justify-between border-t border-border/60 px-3 py-2'>
              <span className='truncate text-[11px] text-muted-foreground/60'>
                {repoUrl ? 'Build on the selected repo' : 'Select a repository'}
              </span>
              <Button
                size='sm'
                className='h-8 gap-1.5 rounded-lg'
                disabled={!repoUrl || busy}
                onClick={create}
              >
                {busy ? 'Cloning…' : 'Start'}
                {!busy && <ArrowRight className='size-4' />}
              </Button>
            </div>
          </div>
        )}

        {error && <p className='mt-3 text-sm text-destructive'>{error}</p>}
      </div>

      {projects.length > 0 && (
        <div className='mt-12 w-full'>
          <p className='mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground/70 uppercase'>
            Your projects
          </p>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
            {projects.map((p) => (
              <ProjectCard
                key={p.slug}
                p={p}
                ts={listTs}
                onDeleted={(slug) =>
                  setProjects((ps) => ps.filter((x) => x.slug !== slug))
                }
              />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function ProjectCard({
  p,
  ts,
  onDeleted,
}: {
  p: ProjectManifest;
  ts: number;
  onDeleted: (slug: string) => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const dot =
    p.status === 'ready'
      ? 'bg-emerald-500'
      : p.status === 'error'
        ? 'bg-destructive'
        : 'bg-muted-foreground/40';

  async function doDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.deleteProject(p.slug);
      onDeleted(p.slug);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className='group relative'>
      <Link
        href={`/projects/${p.slug}`}
        className='block overflow-hidden rounded-xl border border-border/60 bg-card/40 transition-colors hover:bg-muted/40'
      >
        <div className='relative aspect-16/10 w-full overflow-hidden bg-linear-to-br from-violet-500/15 to-indigo-500/15'>
          {imgOk ? (
            <img
              src={`/api/projects/${p.slug}/thumb?t=${ts}`}
              alt=''
              onError={() => setImgOk(false)}
              className='size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]'
            />
          ) : (
            <div className='flex size-full items-center justify-center'>
              <Sparkles className='size-6 text-muted-foreground/40' />
            </div>
          )}
        </div>
        <div className='flex items-center gap-2 px-3 py-2'>
          <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
          <span className='min-w-0 flex-1 truncate text-sm'>{p.name}</span>
          <span className='shrink-0 text-[11px] text-muted-foreground'>
            {p.mode === 'repo' ? 'repo' : 'scratch'}
          </span>
        </div>
      </Link>

      {/* Delete control is a SIBLING of the Link (not inside it) so the
          AlertDialog trigger opens cleanly without fighting link navigation. */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type='button'
            title='Delete project'
            disabled={deleting}
            className='absolute top-1.5 right-1.5 z-10 flex size-7 items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:bg-destructive hover:text-white group-hover:opacity-100 disabled:opacity-100'
          >
            {deleting ? (
              <span className='size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent' />
            ) : (
              <Trash2 className='size-3.5' />
            )}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{p.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the project and shuts down its sandbox.
              This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={() => doDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AdvField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className='block text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase'>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className='w-full rounded-lg border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] font-normal tracking-normal text-foreground normal-case outline-none placeholder:text-muted-foreground/60 focus:border-border'
      />
    </label>
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

'use client';

import {
  ArrowUp,
  Check,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  GitPullRequest,
  ImagePlus,
  Loader2,
  Paperclip,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { use, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import * as api from '@/lib/api';
import { DEFAULT_MODEL, MODELS, modelLabel } from '@/lib/models';
import type { ProjectManifest, TaskStatus } from '@/lib/types';

interface SeedStep {
  label: string;
  status: TaskStatus;
}
interface ToolLine {
  name: string;
  target?: string;
}
interface Attachment {
  id: string;
  url: string; // data URL for preview
  data: string; // base64, no prefix
  mediaType: string;
}
interface Turn {
  role: 'user' | 'assistant';
  text: string;
  tools?: ToolLine[];
  images?: string[]; // data URLs
}

type Phase = 'loading' | 'seeding' | 'ready' | 'error';
type Tab = 'chat' | 'dir';

export default function Workspace({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [tab, setTab] = useState<Tab>('chat');
  const [steps, setSteps] = useState<SeedStep[]>([]);
  const [seedLog, setSeedLog] = useState<string[]>([]);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [path, setPath] = useState('/');
  const [routes, setRoutes] = useState<string[]>(['/']);
  const [canvasTab, setCanvasTab] = useState<'pages' | 'ds'>('pages');
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const abortRef = useRef<AbortController | null>(null);
  const seededOnce = useRef(false);
  const autoSent = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const upsertStep = useCallback(
    (label: string, status: SeedStep['status']) => {
      setSteps((prev) => {
        const i = prev.findIndex((s) => s.label === label);
        if (i === -1) return [...prev, { label, status }];
        const next = [...prev];
        next[i] = { label, status };
        return next;
      });
    },
    [],
  );

  // Keep the transcript pinned to the bottom as it grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [turns, busy, seedLog]);

  // ---- chat -------------------------------------------------------------
  const send = useCallback(
    async (message: string, imgs: Attachment[] = []) => {
      const msg = message.trim();
      if ((!msg && !imgs.length) || busy) return;
      setInput('');
      setAttachments([]);
      setBusy(true);
      setTurns((t) => [
        ...t,
        { role: 'user', text: msg, images: imgs.map((i) => i.url) },
        { role: 'assistant', text: '', tools: [] },
      ]);

      const ac = new AbortController();
      abortRef.current = ac;
      try {
        await api.chat(
          slug,
          msg,
          (e) => {
            if (e.type === 'text') {
              setTurns((t) =>
                patchLast(t, (a) => ({ ...a, text: a.text + e.text })),
              );
            } else if (e.type === 'tool') {
              setTurns((t) =>
                patchLast(t, (a) => ({
                  ...a,
                  tools: [
                    ...(a.tools ?? []),
                    { name: e.name, target: e.target },
                  ],
                })),
              );
            }
          },
          {
            model,
            signal: ac.signal,
            images: imgs.map((i) => ({ data: i.data, mediaType: i.mediaType })),
          },
        );
        setPreviewNonce((n) => n + 1);
      } catch (err) {
        if (!ac.signal.aborted) {
          setTurns((t) =>
            patchLast(t, (a) => ({
              ...a,
              text:
                a.text ||
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            })),
          );
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [slug, busy, model],
  );

  // ---- attachments ------------------------------------------------------
  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        const data = url.split(',')[1] ?? '';
        setAttachments((a) => [
          ...a,
          { id: `${file.name}-${url.length}`, url, data, mediaType: file.type },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // ---- seed -------------------------------------------------------------
  const runSeed = useCallback(async () => {
    if (seededOnce.current) return;
    seededOnce.current = true;
    setPhase('seeding');
    try {
      const { manifest: m } = await api.seedProject(slug, (e) => {
        if (e.type === 'step') upsertStep(e.label, e.status);
        else if (e.type === 'log')
          setSeedLog((l) => [...l.slice(-120), e.line]);
      });
      setManifest(m);
      setPhase(m.status === 'ready' ? 'ready' : 'error');
      if (m.status !== 'ready') setSeedError(m.error ?? null);
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [slug, upsertStep]);

  const retrySeed = useCallback(() => {
    seededOnce.current = false;
    setSteps([]);
    setSeedLog([]);
    setSeedError(null);
    runSeed();
  }, [runSeed]);

  // ---- load -------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    api
      .getProject(slug)
      .then((m) => {
        if (!alive) return;
        setManifest(m);
        if (m.status === 'ready' && m.previewUrl) setPhase('ready');
        else if (m.status === 'new') runSeed();
        else {
          setSeedError(m.error ?? null);
          setPhase('error');
        }
      })
      .catch(() => alive && setPhase('error'));
    return () => {
      alive = false;
    };
  }, [slug, runSeed]);

  // Auto-send the scratch build prompt once the sandbox is ready.
  useEffect(() => {
    if (
      phase === 'ready' &&
      manifest?.mode === 'scratch' &&
      manifest.initialPrompt &&
      !manifest.sessionId &&
      !autoSent.current
    ) {
      autoSent.current = true;
      send(manifest.initialPrompt);
    }
  }, [phase, manifest, send]);

  const ready = phase === 'ready';

  // Detect routes once ready and after each edit (new pages may appear).
  const refreshRoutes = useCallback(() => {
    api
      .getRoutes(slug)
      .then((r) => r.length && setRoutes(r))
      .catch(() => {});
  }, [slug]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: previewNonce re-triggers detection after edits
  useEffect(() => {
    if (ready) refreshRoutes();
  }, [ready, previewNonce, refreshRoutes]);

  const previewSrc =
    manifest?.previewUrl && `${manifest.previewUrl}${path === '/' ? '' : path}`;

  // A design-system / style-guide route if the project has one.
  const dsRoute = routes.find((r) =>
    /design-?system|style-?guide|styleguide/i.test(r),
  );
  const dsSrc =
    dsRoute && manifest?.previewUrl
      ? `${manifest.previewUrl}${dsRoute}`
      : undefined;
  const currentSrc = canvasTab === 'pages' ? previewSrc : dsSrc;
  // Show the standalone "Working…" only before the first tool of the active turn.
  const lastTurnHasTools = (turns.at(-1)?.tools?.length ?? 0) > 0;

  const generateDesignSystem = () => {
    setCanvasTab('ds');
    send(
      'Create this project\'s design system. Follow the DESIGN SYSTEM process: detect any existing tokens/components, establish a token-first foundation, inventory the components, then build the living doc route at "/design-system" (wired into the router) showing Foundations (color tokens, type scale, spacing, radii, shadows) and a Components gallery (every component in all variants and states). Make it genuinely useful and styled consistently with the app.',
    );
  };

  return (
    <div className='flex h-screen bg-background text-foreground'>
      {/* ── Left: chat / directory ─────────────────────────────── */}
      <aside className='flex w-[420px] shrink-0 flex-col border-r border-border/60'>
        <header className='flex items-center gap-2 px-4 py-3'>
          <div className='size-6 rounded-md bg-linear-to-br from-violet-500 to-indigo-500' />
          <span className='font-medium tracking-tight'>Aned</span>
          <span className='truncate text-sm text-muted-foreground'>
            / {manifest?.name ?? '…'}
          </span>
          <div className='ml-auto flex rounded-lg bg-muted/60 p-0.5 text-xs'>
            {(['chat', 'dir'] as const).map((t) => (
              <button
                key={t}
                type='button'
                onClick={() => setTab(t)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                  tab === t
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'chat' ? 'Chat' : 'Files'}
              </button>
            ))}
          </div>
        </header>

        {tab === 'dir' ? (
          <Directory slug={slug} ready={ready} />
        ) : (
          <>
            <ScrollArea className='min-h-0 flex-1'>
              <div
                ref={scrollRef}
                className='flex flex-col gap-5 px-4 py-5'
                style={{ maxHeight: '100%' }}
              >
                {(phase === 'seeding' || phase === 'loading') && (
                  <SeedView steps={steps} log={seedLog} />
                )}
                {phase === 'error' && (
                  <ErrorView
                    error={seedError ?? manifest?.error}
                    log={seedLog}
                    onRetry={retrySeed}
                  />
                )}
                {turns.map((t, i) => (
                  <ChatTurn
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
                    key={i}
                    turn={t}
                    active={busy && i === turns.length - 1}
                  />
                ))}
                {busy && !lastTurnHasTools && <Thinking />}
              </div>
            </ScrollArea>

            <Composer
              input={input}
              setInput={setInput}
              attachments={attachments}
              setAttachments={setAttachments}
              addFiles={addFiles}
              model={model}
              setModel={setModel}
              disabled={!ready}
              busy={busy}
              onSend={() => send(input, attachments)}
              onStop={() => abortRef.current?.abort()}
            />
          </>
        )}
      </aside>

      {/* ── Right: pages / design system ───────────────────────── */}
      <main className='flex min-w-0 flex-1 flex-col bg-muted/30 p-3'>
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm'>
          <div className='flex items-center gap-2 border-b border-border/60 px-3 py-2'>
            <div className='flex rounded-lg bg-muted/60 p-0.5 text-xs'>
              {(
                [
                  ['pages', 'Pages'],
                  ['ds', 'Design system'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type='button'
                  onClick={() => setCanvasTab(v)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    canvasTab === v
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {canvasTab === 'pages' && (
              <PagePicker
                path={path}
                routes={routes}
                disabled={!ready}
                onNavigate={(p) => {
                  setPath(p);
                  setPreviewNonce((n) => n + 1);
                }}
              />
            )}
            <div className='flex-1' />

            <IconBtn
              title='Refresh'
              disabled={!ready}
              onClick={() => setPreviewNonce((n) => n + 1)}
            >
              <RefreshCw className='size-4' />
            </IconBtn>
            {currentSrc && (
              <a href={currentSrc} target='_blank' rel='noreferrer'>
                <IconBtn title='Open in new tab'>
                  <ExternalLink className='size-4' />
                </IconBtn>
              </a>
            )}
            <ShipMenu slug={slug} manifest={manifest} disabled={!ready} />
          </div>

          <div className='min-h-0 flex-1 bg-white'>
            {!ready ? (
              <div className='flex h-full items-center justify-center gap-2 bg-background text-sm text-muted-foreground'>
                {phase === 'error' ? (
                  'Sandbox failed to start.'
                ) : (
                  <>
                    <Loader2 className='size-4 animate-spin text-orange-500' />{' '}
                    Booting preview…
                  </>
                )}
              </div>
            ) : canvasTab === 'pages' ? (
              <iframe
                key={`pages-${previewNonce}-${path}`}
                src={previewSrc || undefined}
                className='h-full w-full border-0'
                title='preview'
              />
            ) : dsSrc ? (
              <iframe
                key={`ds-${previewNonce}`}
                src={dsSrc}
                className='h-full w-full border-0'
                title='design system'
              />
            ) : (
              <DesignSystemEmpty
                busy={busy}
                onGenerate={generateDesignSystem}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── components ───────────────────────────────────────────────── */

function DesignSystemEmpty({
  busy,
  onGenerate,
}: {
  busy: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className='flex h-full items-center justify-center bg-background p-8'>
      <div className='max-w-sm text-center'>
        <div className='mx-auto mb-4 size-10 rounded-xl bg-linear-to-br from-violet-500 to-indigo-500' />
        <h2 className='text-lg font-semibold tracking-tight'>
          No design system yet
        </h2>
        <p className='mt-2 text-sm leading-relaxed text-muted-foreground'>
          Every project should have one — a single page documenting your colors,
          type, spacing, and components. Generate one from the current app and
          keep it in sync as you build.
        </p>
        <Button className='mt-5 gap-1.5' disabled={busy} onClick={onGenerate}>
          {busy ? (
            <Loader2 className='size-4 animate-spin text-orange-500' />
          ) : (
            <Sparkles className='size-4' />
          )}
          Generate design system
        </Button>
      </div>
    </div>
  );
}

function ModelPicker({
  model,
  setModel,
  disabled,
}: {
  model: string;
  setModel: (m: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          className='ml-1 flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
        >
          {modelLabel(model)}
          <ChevronsUpDown className='size-3 opacity-60' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-44 p-1'>
        {MODELS.map((m) => (
          <button
            key={m.id}
            type='button'
            onClick={() => {
              setModel(m.id);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
              m.id === model ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {m.id === model ? (
              <Check className='size-3 shrink-0' />
            ) : (
              <span className='size-3 shrink-0' />
            )}
            {m.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function PagePicker({
  path,
  routes,
  disabled,
  onNavigate,
}: {
  path: string;
  routes: string[];
  disabled: boolean;
  onNavigate: (p: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const go = (p: string) => {
    onNavigate(p);
    setOpen(false);
  };
  return (
    // `modal` so an outside click — even over the cross-origin preview iframe —
    // dismisses the popover (radix's overlay sits above the iframe).
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          className='mx-1 flex flex-1 items-center gap-2 truncate rounded-md bg-muted/60 px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60'
        >
          <span className='truncate'>{path}</span>
          <ChevronsUpDown className='ml-auto size-3 shrink-0 opacity-60' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-64 p-1.5'>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = custom.trim();
            if (p) {
              go(p.startsWith('/') ? p : `/${p}`);
              setCustom('');
            }
          }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder='/path…'
            className='mb-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
          />
        </form>
        <div className='max-h-64 overflow-auto'>
          {routes.map((r) => (
            <button
              key={r}
              type='button'
              onClick={() => go(r)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs transition-colors hover:bg-muted ${
                r === path ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              {r === path && <Check className='size-3 shrink-0' />}
              <span className={r === path ? '' : 'pl-5'}>{r}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Composer({
  input,
  setInput,
  attachments,
  setAttachments,
  addFiles,
  model,
  setModel,
  disabled,
  busy,
  onSend,
  onStop,
}: {
  input: string;
  setInput: (s: string) => void;
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  addFiles: (f: FileList | File[]) => void;
  model: string;
  setModel: (m: string) => void;
  disabled: boolean;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = !disabled && !busy && (input.trim() || attachments.length);

  return (
    <div className='p-3'>
      <div className='rounded-2xl border border-border/70 bg-card p-2 shadow-sm transition-colors focus-within:border-border'>
        {attachments.length > 0 && (
          <div className='flex flex-wrap gap-2 px-1 pt-1 pb-2'>
            {attachments.map((a) => (
              <div key={a.id} className='group relative'>
                <img
                  src={a.url}
                  alt='attachment'
                  className='size-14 rounded-lg border border-border/60 object-cover'
                />
                <button
                  type='button'
                  onClick={() =>
                    setAttachments((p) => p.filter((x) => x.id !== a.id))
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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={disabled ? 'Starting sandbox…' : 'Describe a change…'}
          rows={1}
          disabled={disabled}
          className='max-h-44 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-50'
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.some((f) => f.type.startsWith('image/'))) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />

        <div className='flex items-center gap-1 px-1'>
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
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className='rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
          >
            <Paperclip className='size-4' />
          </button>
          <ModelPicker model={model} setModel={setModel} disabled={busy} />
          <div className='ml-auto'>
            {busy ? (
              <Button
                size='icon'
                variant='secondary'
                className='size-8 rounded-lg'
                onClick={onStop}
              >
                <Square className='size-3.5' />
              </Button>
            ) : (
              <Button
                size='icon'
                className='size-8 rounded-lg'
                disabled={!canSend}
                onClick={onSend}
              >
                <ArrowUp className='size-4' />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatTurn({ turn, active }: { turn: Turn; active: boolean }) {
  if (turn.role === 'user') {
    return (
      <div className='ml-auto flex max-w-[88%] flex-col items-end gap-2'>
        {turn.images && turn.images.length > 0 && (
          <div className='flex flex-wrap justify-end gap-2'>
            {turn.images.map((src, i) => (
              <img
                // biome-ignore lint/suspicious/noArrayIndexKey: static list
                key={i}
                src={src}
                alt='attachment'
                className='max-h-40 rounded-lg border border-border/60 object-cover'
              />
            ))}
          </div>
        )}
        {turn.text && (
          <div className='rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm wrap-break-word whitespace-pre-wrap'>
            {turn.text}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className='flex flex-col gap-2 text-sm'>
      {turn.tools && turn.tools.length > 0 && (
        <ActivityBlock tools={turn.tools} active={active} />
      )}
      {turn.text && (
        <p className='leading-relaxed wrap-break-word whitespace-pre-wrap'>
          {turn.text}
        </p>
      )}
    </div>
  );
}

/** Friendly verb + target for a tool call. */
function toolAction(t: ToolLine): { verb: string; target?: string } {
  const verb =
    {
      list_dir: 'Exploring',
      read_file: 'Reading',
      grep: 'Searching',
      write_file: 'Writing',
      str_replace: 'Editing',
      run_cmd: 'Running',
      Skill: 'Using skill',
    }[t.name] ?? t.name;
  return { verb, target: t.target };
}

/** Collapsible activity log: header shows current/last step, expand for all. */
function ActivityBlock({
  tools,
  active,
}: {
  tools: ToolLine[];
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const last = tools[tools.length - 1];
  const head = last ? toolAction(last) : { verb: 'Working' };

  return (
    <div className='overflow-hidden rounded-lg border border-border/60 bg-card/40'>
      <button
        type='button'
        onClick={() => setOpen((o) => !o)}
        className='flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs'
      >
        {active ? (
          <Loader2 className='size-3.5 shrink-0 animate-spin text-orange-500' />
        ) : (
          <Check className='size-3.5 shrink-0 text-emerald-500' />
        )}
        <span className='min-w-0 flex-1 truncate'>
          {active ? (
            <>
              <span className='font-medium text-foreground'>{head.verb}</span>
              {head.target && (
                <span className='ml-1.5 font-mono text-muted-foreground'>
                  {head.target}
                </span>
              )}
            </>
          ) : (
            <span className='text-muted-foreground'>
              Worked · {tools.length} step{tools.length === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <div className='max-h-56 space-y-0.5 overflow-auto border-t border-border/60 px-2.5 py-1.5'>
          {tools.map((t, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
              key={i}
              className='flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground'
            >
              <span className='w-16 shrink-0 text-foreground/70'>{t.name}</span>
              {t.target && (
                <span className='min-w-0 truncate font-mono'>{t.target}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Thinking() {
  return (
    <div className='flex items-center gap-2 text-xs text-muted-foreground'>
      <Loader2 className='size-3.5 animate-spin text-orange-500' /> Working…
    </div>
  );
}

function SeedView({ steps, log }: { steps: SeedStep[]; log: string[] }) {
  return (
    <div className='space-y-3 rounded-xl border border-border/60 bg-card/50 p-4'>
      <div className='space-y-1.5'>
        {steps.map((s) => (
          <div key={s.label} className='flex items-center gap-2 text-sm'>
            {s.status === 'active' ? (
              <Loader2 className='size-3.5 animate-spin text-orange-500' />
            ) : s.status === 'done' ? (
              <Check className='size-3.5 text-emerald-500' />
            ) : s.status === 'error' ? (
              <X className='size-3.5 text-destructive' />
            ) : (
              <span className='size-3.5 text-center text-muted-foreground'>
                ·
              </span>
            )}
            <span
              className={
                s.status === 'pending'
                  ? 'text-muted-foreground'
                  : 'text-foreground'
              }
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>
      {log.length > 0 && (
        <pre className='max-h-44 overflow-auto rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground'>
          {log.slice(-40).join('\n')}
        </pre>
      )}
    </div>
  );
}

function ErrorView({
  error,
  log,
  onRetry,
}: {
  error?: string;
  log: string[];
  onRetry: () => void;
}) {
  return (
    <div className='space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
      <p className='text-sm font-medium text-destructive'>
        Couldn't start the sandbox.
      </p>
      {error && (
        <pre className='max-h-48 overflow-auto rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground'>
          {error}
        </pre>
      )}
      {log.length > 0 && (
        <pre className='max-h-56 overflow-auto rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground'>
          {log.slice(-50).join('\n')}
        </pre>
      )}
      <Button size='sm' variant='secondary' onClick={onRetry}>
        <RefreshCw className='size-3.5' /> Retry
      </Button>
    </div>
  );
}

function IconBtn({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type='button'
      title={title}
      disabled={disabled}
      onClick={onClick}
      className='rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40'
    >
      {children}
    </button>
  );
}

function ShipMenu({
  slug,
  manifest,
  disabled,
}: {
  slug: string;
  manifest: ProjectManifest | null;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState('');

  const isRepo = manifest?.mode === 'repo';

  // Default the repo name from the project name once known.
  useEffect(() => {
    if (manifest && !repoName) {
      setRepoName(
        manifest.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'weave-app',
      );
    }
  }, [manifest, repoName]);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.ship(slug, isRepo ? {} : { repoName });
      if (r.ok && r.url) {
        setUrl(r.url);
        window.open(r.url, '_blank');
      } else {
        setError(r.error ?? 'Ship failed.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const repo = isRepo ? parseRepoLabel(manifest?.repoUrl) : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size='sm'
          className='ml-1 h-8 gap-1.5 rounded-lg'
          disabled={disabled}
        >
          <GitPullRequest className='size-4' />
          Ship
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 p-3'>
        <p className='text-sm font-medium'>
          {isRepo ? 'Open a pull request' : 'Create a GitHub repo'}
        </p>
        <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
          {isRepo ? (
            <>
              Commit changes on{' '}
              <span className='font-mono'>{manifest?.branch}</span> and open a
              PR
              {repo ? ` against ${repo}` : ''}.
            </>
          ) : (
            'Create a new private repo on your GitHub and push this project to it.'
          )}
        </p>

        {!isRepo && (
          <input
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder='repo-name'
            className='mt-2.5 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
          />
        )}

        {error && <p className='mt-2 text-xs text-destructive'>{error}</p>}

        {url ? (
          <a
            href={url}
            target='_blank'
            rel='noreferrer'
            className='mt-2.5 flex items-center gap-1.5 text-sm text-foreground underline underline-offset-2'
          >
            <ExternalLink className='size-3.5' />
            {isRepo ? 'View pull request' : 'View repository'}
          </a>
        ) : (
          <Button
            size='sm'
            className='mt-3 w-full gap-1.5 rounded-lg'
            disabled={busy || (!isRepo && !repoName.trim())}
            onClick={go}
          >
            {busy ? (
              <Loader2 className='size-4 animate-spin text-orange-500' />
            ) : (
              <GitPullRequest className='size-4' />
            )}
            {isRepo ? 'Commit & open PR' : 'Create repo & push'}
          </Button>
        )}

        <p className='mt-2 text-[11px] text-muted-foreground/60'>
          Requires a GitHub token (GITHUB_TOKEN) on the server.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function parseRepoLabel(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return m?.[1] ?? null;
}

function Directory({ slug, ready }: { slug: string; ready: boolean }) {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!ready) return;
    api
      .getFiles(slug)
      .then((nodes) =>
        setFiles(nodes.map((n) => (n.isDir ? `${n.name}/` : n.name)).sort()),
      )
      .catch(() => setFiles([]));
  }, [slug, ready]);
  return (
    <ScrollArea className='min-h-0 flex-1'>
      <div className='p-4'>
        {files.length ? (
          files.map((f) => (
            <div
              key={f}
              className='flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs text-muted-foreground hover:bg-muted/50'
            >
              {f.endsWith('/') ? '📁' : '📄'} {f.replace(/\/$/, '')}
            </div>
          ))
        ) : (
          <p className='flex items-center gap-2 px-2 text-sm text-muted-foreground'>
            <ImagePlus className='size-4' />
            {ready ? 'No files.' : 'Sandbox not ready.'}
          </p>
        )}
      </div>
    </ScrollArea>
  );
}

function patchLast(turns: Turn[], fn: (a: Turn) => Turn): Turn[] {
  if (!turns.length) return turns;
  const next = [...turns];
  const last = next[next.length - 1];
  if (last && last.role === 'assistant') next[next.length - 1] = fn(last);
  return next;
}

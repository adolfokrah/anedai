'use client';

import {
  ArrowUp,
  Check,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitPullRequest,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CodeViewer } from '@/components/code-viewer';
import { ModelPicker } from '@/components/model-picker';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import * as api from '@/lib/api';
import { type AvailableModel, DEFAULT_MODEL } from '@/lib/models';
import type {
  AppCandidate,
  AskQuestion,
  FileNode,
  ProjectManifest,
  TaskStatus,
} from '@/lib/types';
import { useModels } from '@/lib/use-models';

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
  questions?: AskQuestion[]; // dynamic form the agent asked this turn
  answered?: boolean; // user already submitted the questions form
}

type Phase = 'loading' | 'seeding' | 'config' | 'ready' | 'error';

/** Map a manifest status to a workspace phase. */
function phaseFor(status: ProjectManifest['status']): Phase {
  if (status === 'ready') return 'ready';
  if (status === 'needs-config') return 'config';
  return 'error';
}
type Tab = 'chat' | 'skills';

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

/**
 * First turn for a from-scratch project. The agent decides WHAT to ask (via the
 * ask_user tool) — Aned renders its questions as a dynamic form. No building.
 */
function intakeMessage(brief: string): string {
  return `A new project is being built from scratch. The user's brief:

"${brief}"

This is the DESIGN INTAKE — do NOT write code or build anything yet. We agree on the design system first.

Use the **ask_user** tool to ask the user a few quick design questions (3–5) so you can set up the design system. YOU decide the exact questions from the brief, but cover the essentials — e.g. accent/brand color, overall vibe/mood, typography feel, light/dark, and whether they have an existing design to match. For each question give concrete options (your recommended option FIRST) and set allowOther:true so they can type their own. Then STOP — the user's answers arrive next, and you'll establish the design system, then build.`;
}

/**
 * First turn for a connected repo (box-only seed). The agent clones + brings it
 * up entirely in chat — Aned just booted the empty sandbox.
 */
function bringUpRepoMessage(): string {
  return `The repository is already CLONED in your working directory (Aned did the checkout). Bring it up so the dev server runs:

1. DETECT the app: read package.json + lockfile. If it's a MONOREPO with multiple runnable apps, use ask_user to let me pick which ONE frontend to run + preview (Aned previews one app). For a big monorepo, install ONLY the target app's workspace (e.g. \`pnpm install --filter <app>...\`) to avoid filling the small disk / OOM.
1b. DESIGN SYSTEM / COMPONENTS LOCATION: unless it's obvious, ask_user "Where is your design system / component library?" — first scan the cloned repo and list the CANDIDATE folders you found (workspace packages + frontend/ui dirs, e.g. ui-components-lib, packages/ui, frontend-v2/src/components), PLUS two more options: "Build a new one from the main app", and (allowOther) "It's in another repo — paste the URL". Then:
   - A folder → record it as the design system's componentsDir (may differ from the app you run); scan/extend it IN PLACE.
   - Build from main app → if the app already has tokens/components, EXTEND them; else build fresh (greenfield). Create the in-app /design-system route.
   - Another repo (external design system) → do NOT run or git-manage a second repo here. Build the app's pages from the INSTALLED package (node_modules + .d.ts). DS tab: if the user has a HOSTED docs URL, record it as anedai.json designSystem.route (iframe it). Otherwise the design-system step generates an in-app /design-system reference rendered from node_modules — it MAY do a throwaway \`git clone --depth 1\` of the repo to harvest stories/prop docs, then DELETE it (never start it, never commit it). To EDIT the design system itself, connect that repo as a SEPARATE Aned project.
   Record componentsDir in design-system.json and the designSystem entry (full URL) in anedai.json.
2. ENV & SECRETS: if a secrets manager is configured (Doppler/Infisical/Vercel) and its token isn't set, ask_user for it (e.g. DOPPLER_TOKEN), then pull secrets / run through it. Honor any user-provided .env.
3. START the dev server with the **start_app** tool bound to 0.0.0.0 on the app's OWN port (do NOT force a port — Vite 5173, Next 3000, etc.), using the framework's correct flags. Pass the actual port to start_app. Verify it serves; if not, tail .aned-dev.log, diagnose, fix, and retry.
4. BACKEND (optional): if the repo has a SEPARATE backend/API (a backend/server/api workspace with its own start script), ask_user whether to run it too. If yes, start it with start_app role:"backend", point the frontend's API env var at the backend's PUBLIC url (not localhost — the preview is in my browser), handle CORS, and restart the frontend.
5. WRITE anedai.json at the app root with the FULL preview URLs start_app returned: \`{ "app": { "port": <p>, "route": "<full url>" } }\` (+ "designSystem" / "backend" entries if applicable).
6. Only do what's needed to RUN it — don't change app features. This is BRING-UP only: do NOT create a branch, commit, or open a PR (that's for real tasks later).

Work through it and ask me (ask_user) whenever you need a decision or a secret.`;
}

/** Instruction to build the project's design-system foundation + living doc. */
const DESIGN_SYSTEM_PROMPT =
  'Create this project\'s design system. Follow the DESIGN SYSTEM process: detect any existing tokens/components, establish a token-first foundation, inventory the components, then build the living doc route at "/design-system" (wired into the router). Give it its OWN standalone shadcn-docs-style layout (NOT the product app shell): a sticky top nav bar (system name + version + a working light/dark theme toggle), a persistent left sidebar nav grouped into Foundations (Colors, Typography, Spacing, Radii, Shadows) and Components (one link per component), and a max-width content pane. Show Foundations (color tokens, type scale, spacing, radii, shadows) and a Components gallery (every component in all variants and states), each in a bordered preview surface with a usage note. Polish it to the shadcn bar — hairline borders, soft surfaces, focus rings, smooth transitions, full light/dark parity, no horizontal overflow.';

export default function Workspace({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [tab, setTabState] = useState<Tab>(
    initialParam('panel') === 'skills' ? 'skills' : 'chat',
  );
  const setTab = (t: Tab) => {
    setTabState(t);
    setParam('panel', t);
  };
  const [steps, setSteps] = useState<SeedStep[]>([]);
  const [seedLog, setSeedLog] = useState<string[]>([]);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  // `path` = the route shown in the address bar (kept live by the preview's
  // postMessages). `loadedSrc` = what the iframe actually loads; it only changes
  // on an explicit (re)load (address-bar nav or refresh = previewNonce bump), so
  // live route updates move the address bar WITHOUT reloading the iframe.
  const [path, setPath] = useState('/');
  // The full URL the preview last reported (verbatim — handles a redirect to a
  // different app/port, where path alone is ambiguous). Shown in the address bar.
  const [liveUrl, setLiveUrl] = useState<string>('');
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const [routes, setRoutes] = useState<string[]>(['/']);
  const [canvasTab, setCanvasTabState] = useState<'pages' | 'ds' | 'code'>(
    () => {
      const v = initialParam('view');
      return v === 'ds' || v === 'code' ? v : 'pages';
    },
  );
  const setCanvasTab = (v: 'pages' | 'ds' | 'code') => {
    setCanvasTabState(v);
    setParam('view', v);
  };
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  // Models the server has keys for (+ its key-derived default). Apply the
  // default only if the model is still the untouched static fallback — the
  // project manifest (line ~410) or a user pick takes precedence.
  const { models: availableModels, defaultModel } = useModels();
  useEffect(() => {
    if (defaultModel) setModel((m) => (m === DEFAULT_MODEL ? defaultModel : m));
  }, [defaultModel]);
  const [mode, setMode] = useState<'build' | 'plan'>('build');
  const [skills, setSkills] = useState<api.Skill[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const seededOnce = useRef(false);
  const autoSent = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Gate transcript persistence until the saved history has loaded, so we never
  // overwrite it with the initial empty array on first render.
  const historyLoaded = useRef(false);
  // The route currently shown in the preview, sent with each chat turn so the
  // agent knows what "this page" means. (Can't read in-iframe navigation —
  // cross-origin — so this is the route Aned points the preview at.)
  const viewingRef = useRef<string>('/');

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
    async (
      message: string,
      imgs: Attachment[] = [],
      modeOverride?: 'build' | 'plan',
    ) => {
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

      // Slash command → invoke a skill: "/skill-name rest". The skill name is
      // passed out-of-band so the backend can load it (repo skills live in the
      // sandbox); the transcript still shows what you typed.
      let agentMsg = msg;
      let skill: string | undefined;
      const sm = msg.match(/^\/([A-Za-z0-9_-]+)\s*([\s\S]*)$/);
      if (sm && skills.some((s) => s.name === sm[1])) {
        skill = sm[1];
        agentMsg = (sm[2] ?? '').trim() || `Apply the ${sm[1]} skill.`;
      }

      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await api.chat(
          slug,
          agentMsg,
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
            } else if (e.type === 'questions') {
              setTurns((t) =>
                patchLast(t, (a) => ({ ...a, questions: e.questions })),
              );
            } else if (e.type === 'preview') {
              // Agent started a server. 'docs' → DS tab; 'backend' → API
              // server (no tab, just record); else the main app → Pages tab.
              if (e.role === 'docs') {
                setManifest((m) =>
                  m ? { ...m, docsPreviewUrl: e.url, docsPort: e.port } : m,
                );
                setPreviewNonce((n) => n + 1);
              } else if (e.role === 'backend') {
                setManifest((m) =>
                  m ? { ...m, backendUrl: e.url, backendPort: e.port } : m,
                );
              } else {
                setManifest((m) =>
                  m ? { ...m, previewUrl: e.url, devPort: e.port } : m,
                );
                setPhase('ready');
                setPreviewNonce((n) => n + 1);
              }
            }
          },
          {
            model,
            mode: modeOverride ?? mode,
            skill,
            signal: ac.signal,
            images: imgs.map((i) => ({ data: i.data, mediaType: i.mediaType })),
            viewing: viewingRef.current,
          },
        );
        setPreviewNonce((n) => n + 1);
        setManifest(res.manifest); // reflect new repoUrl / prUrl / branch
        // If the agent just brought a down dev server up, leave the error state.
        api
          .checkAlive(slug)
          .then(({ server }) => server && setPhase('ready'))
          .catch(() => {});
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
    [slug, busy, model, mode, skills],
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
      setPhase(phaseFor(m.status));
      if (m.status === 'error') setSeedError(m.error ?? null);
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [slug, upsertStep]);

  // Recover without re-creating the sandbox: 'restart' reconnects to the
  // existing box and re-runs bring-up (clone + installed deps preserved; the
  // agent diagnoses + fixes). 'seed' fully re-creates (only when no box exists).
  const recover = useCallback(
    (kind: 'seed' | 'restart') => {
      seededOnce.current = true;
      setSteps([]);
      setSeedLog([]);
      setSeedError(null);
      setPhase('seeding');
      const run = kind === 'restart' ? api.restartProject : api.seedProject;
      run(slug, (e) => {
        if (e.type === 'step') upsertStep(e.label, e.status);
        else if (e.type === 'log')
          setSeedLog((l) => [...l.slice(-120), e.line]);
      })
        .then(({ manifest: m }) => {
          setManifest(m);
          setPhase(phaseFor(m.status));
          if (m.status === 'error') setSeedError(m.error ?? null);
        })
        .catch((err) => {
          setSeedError(err instanceof Error ? err.message : String(err));
          setPhase('error');
        });
    },
    [slug, upsertStep],
  );

  // Retry a failed seed. If a sandbox already exists (clone done), reuse it and
  // let the agent re-attempt bring-up — don't re-clone into a brand-new box.
  const retrySeed = useCallback(() => {
    if (manifest?.sandboxId) {
      recover('restart');
    } else {
      seededOnce.current = false;
      setSteps([]);
      setSeedLog([]);
      setSeedError(null);
      runSeed();
    }
  }, [manifest?.sandboxId, recover, runSeed]);

  // Submit the monorepo config picker, then (re)seed with the chosen app.
  const submitConfig = useCallback(
    async (cfg: {
      subdir?: string;
      startCmd?: string;
      docsStartCmd?: string;
      docsSubdir?: string;
      envText?: string;
    }) => {
      try {
        const m = await api.configProject(slug, cfg);
        setManifest(m);
        seededOnce.current = false;
        runSeed();
      } catch (err) {
        setSeedError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    },
    [slug, runSeed],
  );

  // ---- load -------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    api
      .getProject(slug)
      .then((m) => {
        if (!alive) return;
        setManifest(m);
        if (m.model) setModel(m.model); // default the picker to the chosen model
        if (m.initialMode) setMode(m.initialMode); // reflect plan/build choice
        if (m.status === 'ready') {
          // Box is up → open the workspace. If the app was already brought up
          // (has a preview), verify it + recover. If not (repo box-only awaiting
          // its first bring-up), the auto-turn effect kicks off the agent.
          setPhase('ready');
          if (m.previewUrl) {
            api
              .checkAlive(slug)
              .then(({ alive: boxAlive, server }) => {
                if (!alive) return;
                if (!boxAlive) recover('seed');
                else if (!server) recover('restart');
              })
              .catch(() => {});
          }
        } else if (m.status === 'new') runSeed();
        else if (m.status === 'needs-config') setPhase('config');
        else {
          // Error state. If the sandbox is actually alive (only bring-up
          // failed), surface it but keep chat usable; if the dev server is
          // already up again, jump to ready.
          setSeedError(m.error ?? null);
          setPhase('error');
          if (m.sandboxId) {
            api
              .checkAlive(slug)
              .then(({ server }) => {
                if (alive && server) setPhase('ready');
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => alive && setPhase('error'));
    return () => {
      alive = false;
    };
  }, [slug, runSeed, recover]);

  // Track the previewed app's LIVE route. The app postMessages `aned:route` on
  // navigation (scratch template + the repo reporter the agent adds), so the
  // address bar reflects in-iframe clicks and a refresh keeps the current page
  // instead of resetting to "/". Cross-origin, so we validate the sender origin.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== 'aned:route' || typeof d.url !== 'string') return;
      // The reporter sends the full URL; derive the route path for internal use
      // (preview src, the agent's "viewing" hint). Display-only, and our iframes
      // are our own previews — so we don't gate on origin.
      let p = '/';
      try {
        const u = new URL(d.url);
        p = u.pathname + u.search;
      } catch {}
      console.debug('[aned] route from preview:', d.url, '→', p);
      setLiveUrl(d.url);
      setPath(p);
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Restore the persisted transcript, then allow saves.
  useEffect(() => {
    let alive = true;
    api
      .getMessages(slug)
      .then((saved) => {
        if (!alive) return;
        if (saved.length) setTurns(saved);
      })
      .catch(() => {})
      .finally(() => {
        historyLoaded.current = true;
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  // Persist the transcript after each turn settles (never mid-stream).
  useEffect(() => {
    if (!historyLoaded.current || busy || !turns.length) return;
    api.saveMessages(slug, turns).catch(() => {});
  }, [turns, busy, slug]);

  // Attachments stashed by the landing page (consumed once on intake submit).
  const readInitImages = useCallback((): Attachment[] => {
    try {
      const raw = sessionStorage.getItem(`aned:init:${slug}`);
      if (!raw) return [];
      const arr = JSON.parse(raw) as { data: string; mediaType: string }[];
      sessionStorage.removeItem(`aned:init:${slug}`);
      return arr.map((x, i) => ({
        id: `init-${i}`,
        url: `data:${x.mediaType};base64,${x.data}`,
        data: x.data,
        mediaType: x.mediaType,
      }));
    } catch {
      return [];
    }
  }, [slug]);

  // First auto turn once the box is up:
  //  - scratch → design INTAKE (read-only; agent asks design questions).
  //  - repo (box-only) → the agent CLONES the repo + brings it up in chat.
  useEffect(() => {
    if (
      phase !== 'ready' ||
      !manifest ||
      manifest.sessionId ||
      autoSent.current
    )
      return;
    if (manifest.mode === 'scratch' && manifest.initialPrompt) {
      autoSent.current = true;
      send(intakeMessage(manifest.initialPrompt), readInitImages(), 'plan');
    } else if (manifest.mode === 'repo' && manifest.repoUrl) {
      autoSent.current = true;
      send(bringUpRepoMessage(), [], 'build');
    }
  }, [phase, manifest, send, readInitImages]);

  // Answer a dynamic question form → continue the build in build mode (the
  // design-system-first gate ensures the system is established before pages).
  const answerQuestions = useCallback(
    (text: string) => {
      setTurns((t) =>
        t.map((turn) => (turn.questions ? { ...turn, answered: true } : turn)),
      );
      send(text, [], 'build');
    },
    [send],
  );

  const ready = phase === 'ready';

  // Once the preview is up, have Aned inject the route reporter into the app so
  // it postMessages its route (the address bar can't read a cross-origin iframe
  // directly). Aned-driven, not the agent; one-time; reloads the preview after
  // so the app picks it up.
  const reporterDone = useRef(false);
  useEffect(() => {
    // Unconditional log so we can confirm this effect runs at all + see why it
    // might skip. If you see NO "[aned] reporter" line, Aned's new code isn't
    // loaded (restart its dev server).
    console.debug('[aned] reporter effect', {
      ready,
      hasPreview: !!manifest?.previewUrl,
      done: reporterDone.current,
    });
    if (!ready || !manifest?.previewUrl || reporterDone.current) return;
    reporterDone.current = true;
    api
      .ensureReporter(slug)
      .then((r) => {
        // Surface the full result so we can see WHERE it breaks (framework
        // detected, entry found, or the reason it didn't). Check the console.
        console.debug('[aned] ensure-reporter →', r);
        if (r && (r.injected > 0 || r.already > 0)) {
          setManifest((m) => (m ? { ...m, routeReporter: true } : m));
          if (r.injected > 0) setPreviewNonce((n) => n + 1);
        }
      })
      .catch((e) => console.debug('[aned] ensure-reporter failed', e));
  }, [ready, manifest?.previewUrl, slug]);

  // Bring-up failed but the sandbox is alive → the agent can fix it from chat
  // (read logs, install, start_app). Keep chat usable instead of dead-ending.
  const recoverable = phase === 'error' && !!manifest?.sandboxId;
  const connected = !!manifest?.repoUrl;
  const refreshManifest = useCallback(() => {
    api
      .getProject(slug)
      .then(setManifest)
      .catch(() => {});
  }, [slug]);

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

  // When the Design-system tab has no route yet, backstop by reading the DS
  // manifest from the sandbox (covers a missed chat-done write). Retries after
  // edits (previewNonce) so a freshly generated system gets picked up.
  // Load the project's skills (for the Skills tab + composer / commands).
  // biome-ignore lint/correctness/useExhaustiveDependencies: previewNonce refetches after edits
  useEffect(() => {
    if (!ready) return;
    api
      .getSkills(slug)
      .then(setSkills)
      .catch(() => {});
  }, [ready, slug, previewNonce]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: previewNonce is a retry trigger
  useEffect(() => {
    if (canvasTab !== 'ds' || !ready) return;
    if (manifest?.designRoute || manifest?.docsPreviewUrl) return;
    api
      .resolveDesignRoute(slug)
      .then((r) => r.route && setManifest(r.manifest))
      .catch(() => {});
  }, [
    canvasTab,
    ready,
    slug,
    previewNonce,
    manifest?.designRoute,
    manifest?.docsPreviewUrl,
  ]);

  // Connected + on a feature branch but no PR recorded → look one up (the agent
  // may have opened it) so View PR / Merge appear. Retries after each turn.
  const repoUrl = manifest?.repoUrl;
  const branch = manifest?.branch;
  const hasPr = !!manifest?.prUrl;
  // biome-ignore lint/correctness/useExhaustiveDependencies: previewNonce retries after turns
  useEffect(() => {
    if (!ready || hasPr || !repoUrl || !branch) return;
    api
      .refreshProject(slug)
      .then(setManifest)
      .catch(() => {});
  }, [ready, repoUrl, branch, hasPr, slug, previewNonce]);

  // While a PR is open, reconcile with GitHub (catches a merge done on GitHub):
  // poll + check on focus; clears View PR / Merge once it's merged/closed.
  const prUrl = manifest?.prUrl;
  useEffect(() => {
    if (!ready || !prUrl) return;
    const check = () =>
      api
        .refreshProject(slug)
        .then(setManifest)
        .catch(() => {});
    const id = setInterval(check, 15000);
    const onVis = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ready, prUrl, slug]);

  const previewSrc =
    manifest?.previewUrl && `${manifest.previewUrl}${path === '/' ? '' : path}`;

  // Load the iframe only on an explicit (re)load — refresh or address-bar nav
  // (previewNonce) — reading the CURRENT path then, so refresh keeps the page.
  // NOT keyed on `path`, so live route reports update the bar without reloading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: path is read intentionally only at (re)load time
  useEffect(() => {
    if (manifest?.previewUrl)
      setLoadedSrc(`${manifest.previewUrl}${path === '/' ? '' : path}`);
  }, [previewNonce, manifest?.previewUrl]);

  // The design-system docs route. Prefer the path the agent recorded (an
  // existing in-app route it adopted, or the created /design-system); fall back
  // to sniffing the detected routes.
  const dsRoute =
    manifest?.designRoute ??
    routes.find((r) => /design-?system|style-?guide|styleguide|\/ui$/i.test(r));
  // A dedicated docs server (e.g. Storybook) wins; else the in-app route.
  const dsSrc = manifest?.docsPreviewUrl
    ? manifest.docsPreviewUrl
    : dsRoute && manifest?.previewUrl
      ? `${manifest.previewUrl}${dsRoute}`
      : undefined;
  const currentSrc = canvasTab === 'pages' ? previewSrc : dsSrc;
  // Track the route shown in the preview so each chat turn carries it.
  viewingRef.current = canvasTab === 'ds' ? (dsRoute ?? '/') : path;
  // Show the standalone "Working…" only before the first tool of the active turn.
  const lastTurnHasTools = (turns.at(-1)?.tools?.length ?? 0) > 0;

  const generateDesignSystem = () => {
    setCanvasTab('ds');
    send(DESIGN_SYSTEM_PROMPT);
  };

  return (
    <ResizablePanelGroup
      direction='horizontal'
      autoSaveId='aned-workspace'
      className='h-screen bg-background text-foreground'
    >
      {/* ── Left: chat / directory ─────────────────────────────── */}
      <ResizablePanel defaultSize={32} minSize={22} maxSize={55}>
        <aside className='flex h-full min-w-0 flex-col border-r border-border/60'>
          <header className='flex items-center gap-2 px-4 py-3'>
            <Link
              href='/'
              className='flex items-center gap-2 rounded-md transition-opacity hover:opacity-80'
              aria-label='Back to home'
            >
              <div className='size-6 rounded-md bg-linear-to-br from-violet-500 to-indigo-500' />
              <span className='font-medium tracking-tight'>Aned</span>
            </Link>
            <span className='text-sm text-muted-foreground'>/</span>
            <EditableName
              slug={slug}
              name={manifest?.name ?? '…'}
              onRenamed={(m) => setManifest(m)}
            />
            <div className='ml-auto flex rounded-lg bg-muted/60 p-0.5 text-xs'>
              {(['chat', 'skills'] as const).map((t) => (
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
                  {t === 'chat' ? 'Chat' : 'Skills'}
                </button>
              ))}
            </div>
          </header>

          {/* Keep both panels MOUNTED so switching tabs doesn't refetch/flash. */}
          <div
            className={`flex min-h-0 flex-1 flex-col ${tab === 'skills' ? '' : 'hidden'}`}
          >
            <SkillsView
              skills={skills}
              onPrompt={(m) => {
                setTab('chat');
                send(m, [], 'build');
              }}
            />
          </div>
          <div
            className={`flex min-h-0 flex-1 flex-col ${tab === 'chat' ? '' : 'hidden'}`}
          >
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
                  {phase === 'config' && manifest && (
                    <ConfigView
                      candidates={manifest.appCandidates ?? []}
                      onSubmit={submitConfig}
                    />
                  )}
                  {phase === 'error' && (
                    <ErrorView
                      error={seedError ?? manifest?.error}
                      log={seedLog}
                      onRetry={retrySeed}
                      recoverable={recoverable}
                    />
                  )}
                  {turns.map((t, i) => (
                    <ChatTurn
                      // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
                      key={i}
                      turn={t}
                      active={busy && i === turns.length - 1}
                      onAnswer={answerQuestions}
                    />
                  ))}
                  {busy && !lastTurnHasTools && <Thinking />}
                  {ready && !connected && !busy && turns.length > 0 && (
                    <ConnectGitHubCard
                      slug={slug}
                      defaultName={manifest?.name ?? 'app'}
                      onConnected={refreshManifest}
                    />
                  )}
                </div>
              </ScrollArea>

              {manifest && (manifest.missingEnv?.length ?? 0) > 0 && (
                <div className='mx-3 mb-1 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs'>
                  <KeyRound className='size-3.5 shrink-0 text-amber-500' />
                  <span className='min-w-0 flex-1'>
                    {manifest.secretsManager
                      ? `Uses ${managerLabel(manifest.secretsManager)} — add `
                      : 'This app needs env: '}
                    <span className='font-mono text-amber-600 dark:text-amber-300'>
                      {manifest.missingEnv?.join(', ')}
                    </span>
                    {manifest.secretsManager ? ' to pull its secrets.' : ''}
                  </span>
                  <EnvButton
                    slug={slug}
                    manifest={manifest}
                    setManifest={setManifest}
                    missing={manifest.missingEnv}
                    trigger={
                      <button
                        type='button'
                        className='shrink-0 rounded-md border border-amber-500/40 px-2 py-0.5 font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-300'
                      >
                        Add
                      </button>
                    }
                  />
                </div>
              )}

              <Composer
                input={input}
                setInput={setInput}
                attachments={attachments}
                setAttachments={setAttachments}
                addFiles={addFiles}
                model={model}
                setModel={setModel}
                models={availableModels}
                mode={mode}
                setMode={setMode}
                branch={manifest?.branch}
                skills={skills}
                disabled={!ready && !recoverable}
                busy={busy}
                onSend={() => send(input, attachments)}
                onStop={() => abortRef.current?.abort()}
              />
            </>
          </div>
        </aside>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* ── Right: pages / design system ───────────────────────── */}
      <ResizablePanel defaultSize={68} minSize={45}>
        <main className='flex h-full min-w-0 flex-col bg-muted/30 p-3'>
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm'>
            <div className='flex items-center gap-2 border-b border-border/60 px-3 py-2'>
              <div className='flex rounded-lg bg-muted/60 p-0.5 text-xs'>
                {(
                  [
                    ['pages', 'Pages'],
                    ['ds', 'Design system'],
                    ['code', 'Code'],
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
                <AddressBar
                  url={
                    liveUrl ||
                    (manifest?.previewUrl
                      ? `${manifest.previewUrl.replace(/\/$/, '')}${path === '/' ? '/' : path}`
                      : path)
                  }
                  disabled={!ready}
                  onNavigate={(input) => {
                    // Accept a full URL (extract its path) or a bare path.
                    let p = input.trim();
                    try {
                      if (/^https?:\/\//.test(p)) {
                        const u = new URL(p);
                        p = u.pathname + u.search;
                      }
                    } catch {}
                    if (!p.startsWith('/')) p = `/${p}`;
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
              <GitBar
                slug={slug}
                manifest={manifest}
                setManifest={setManifest}
                ready={ready}
              />
            </div>

            <div className='min-h-0 flex-1'>
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
              ) : canvasTab === 'code' ? (
                <CodeView slug={slug} ready={ready} nonce={previewNonce} />
              ) : canvasTab === 'pages' && !previewSrc ? (
                <div className='flex h-full flex-col items-center justify-center gap-2 bg-background px-6 text-center text-sm text-muted-foreground'>
                  <Loader2 className='size-4 animate-spin text-orange-500' />
                  Bringing up the app — follow along in the chat.
                </div>
              ) : canvasTab === 'pages' ? (
                <iframe
                  key={`pages-${previewNonce}`}
                  src={loadedSrc || previewSrc || undefined}
                  className='h-full w-full border-0 bg-white'
                  title='preview'
                />
              ) : dsSrc ? (
                <iframe
                  key={`ds-${previewNonce}`}
                  src={dsSrc}
                  className='h-full w-full border-0 bg-white'
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
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/* ── components ───────────────────────────────────────────────── */

function EditableName({
  slug,
  name,
  onRenamed,
}: {
  slug: string;
  name: string;
  onRenamed: (m: ProjectManifest) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  async function save() {
    setEditing(false);
    const next = value.trim();
    if (!next || next === name) {
      setValue(name);
      return;
    }
    try {
      onRenamed(await api.renameProject(slug, next));
    } catch {
      setValue(name);
    }
  }

  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: focus the rename field on open
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') {
            setValue(name);
            setEditing(false);
          }
        }}
        className='min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
      />
    );
  }
  return (
    <button
      type='button'
      title='Rename project'
      onClick={() => {
        setValue(name);
        setEditing(true);
      }}
      className='min-w-0 truncate rounded-md px-1 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground'
    >
      {name}
    </button>
  );
}

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

/**
 * Live address bar. Shows the previewed app's current route (kept in sync by the
 * `aned:route` postMessages the app sends), and is editable to navigate: edit +
 * Enter loads that path. While focused it holds the draft so live updates don't
 * fight typing.
 */
function AddressBar({
  url,
  disabled,
  onNavigate,
}: {
  url: string;
  disabled: boolean;
  onNavigate: (input: string) => void;
}) {
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  // Reflect the live URL except while the user is typing.
  useEffect(() => {
    if (!editing) setDraft(url);
  }, [url, editing]);
  return (
    <form
      className='mx-1 flex flex-1 items-center rounded-md bg-muted/60 px-3 py-1'
      onSubmit={(e) => {
        e.preventDefault();
        const p = draft.trim();
        onNavigate(p ? (p.startsWith('/') ? p : `/${p}`) : '/');
        (e.currentTarget.querySelector('input') as HTMLInputElement)?.blur();
      }}
    >
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setEditing(true);
          e.currentTarget.select();
        }}
        onBlur={() => setEditing(false)}
        placeholder='/'
        spellCheck={false}
        className='flex-1 bg-transparent font-mono text-xs text-muted-foreground outline-none disabled:opacity-60'
      />
    </form>
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
  models,
  mode,
  setMode,
  branch,
  skills,
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
  models: AvailableModel[];
  mode: 'build' | 'plan';
  setMode: (m: 'build' | 'plan') => void;
  branch?: string;
  skills: api.Skill[];
  disabled: boolean;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && !busy && (input.trim() || attachments.length);

  // Slash-command menu: while typing "/foo" (no space yet), suggest skills.
  const slashQuery = /^\/[A-Za-z0-9_-]*$/.test(input)
    ? input.slice(1).toLowerCase()
    : null;
  const slashItems =
    slashQuery !== null
      ? skills.filter((s) => s.name.toLowerCase().includes(slashQuery))
      : [];
  const showSlash = !disabled && slashQuery !== null && slashItems.length > 0;
  const pickSkill = (name: string) => {
    setInput(`/${name} `);
    taRef.current?.focus();
  };

  return (
    <div className='p-3'>
      <div className='overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-colors focus-within:border-border'>
        {/* Context bar: the working branch sits on top of the composer. */}
        {branch && (
          <div className='flex items-center gap-1.5 border-b border-border/60 px-3 py-2 text-[12px] text-muted-foreground'>
            <GitBranch className='size-3.5 shrink-0' />
            <span className='truncate font-mono'>{branch}</span>
          </div>
        )}

        {attachments.length > 0 && (
          <div className='flex flex-wrap gap-2 px-3 pt-3'>
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

        {showSlash && (
          <div className='mx-2 mt-2 max-h-44 overflow-auto rounded-lg border border-border/60 bg-popover p-1'>
            {slashItems.map((s) => (
              <button
                key={s.name}
                type='button'
                onClick={() => pickSkill(s.name)}
                className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60'
              >
                <Sparkles className='size-3.5 shrink-0 text-violet-400' />
                <span className='shrink-0 font-mono text-[12px]'>
                  /{s.name}
                </span>
                <span className='min-w-0 flex-1 truncate text-[11px] text-muted-foreground'>
                  {s.description}
                </span>
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            disabled ? 'Starting sandbox…' : 'Ask Aned…  (/ for skills)'
          }
          rows={2}
          disabled={disabled}
          className='max-h-44 w-full resize-none bg-transparent px-3.5 py-3 text-sm outline-none placeholder:text-muted-foreground/70 disabled:opacity-50'
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
              // If the slash menu is open, Enter picks the top skill.
              if (showSlash) pickSkill(slashItems[0]?.name ?? '');
              else if (canSend) onSend();
            }
          }}
        />

        <div className='flex items-center gap-1.5 px-2.5 pb-2.5'>
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
            className='flex size-7 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
          >
            <Plus className='size-4' />
          </button>
          <div className='flex rounded-lg bg-muted/60 p-0.5 text-[11px] font-medium'>
            {(['build', 'plan'] as const).map((m) => (
              <button
                key={m}
                type='button'
                disabled={busy}
                title={
                  m === 'plan'
                    ? 'Plan: investigate and propose a plan, no edits'
                    : 'Build: make the changes and open a PR'
                }
                onClick={() => setMode(m)}
                className={`rounded-md px-2 py-1 capitalize transition-colors disabled:opacity-50 ${
                  mode === m
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className='ml-auto flex items-center gap-1.5'>
            <ModelPicker
              model={model}
              setModel={setModel}
              models={models}
              disabled={busy}
            />
            {busy ? (
              <Button
                size='icon'
                variant='secondary'
                className='size-8 rounded-full'
                onClick={onStop}
              >
                <Square className='size-3.5' />
              </Button>
            ) : (
              <Button
                size='icon'
                className='size-8 rounded-full'
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

function ChatTurn({
  turn,
  active,
  onAnswer,
}: {
  turn: Turn;
  active: boolean;
  onAnswer: (text: string) => void;
}) {
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
        <div className='prose prose-invert prose-sm max-w-none wrap-break-word leading-relaxed prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold prose-headings:text-foreground prose-h1:text-base prose-h2:text-[15px] prose-h3:text-sm prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-strong:text-foreground prose-a:text-violet-400 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none prose-table:text-xs prose-th:text-left prose-hr:my-4 prose-hr:border-border/60'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown>
        </div>
      )}
      {turn.questions && turn.questions.length > 0 && (
        <QuestionsForm
          questions={turn.questions}
          answered={turn.answered}
          onAnswer={onAnswer}
        />
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

/** Renders the agent's ask_user questions as an interactive form. */
function QuestionsForm({
  questions,
  answered,
  onAnswer,
}: {
  questions: AskQuestion[];
  answered?: boolean;
  onAnswer: (text: string) => void;
}) {
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const done = answered || submitted;

  const toggle = (q: AskQuestion, opt: string) =>
    setPicks((p) => {
      const cur = p[q.id] ?? [];
      if (q.multi)
        return {
          ...p,
          [q.id]: cur.includes(opt)
            ? cur.filter((x) => x !== opt)
            : [...cur, opt],
        };
      return { ...p, [q.id]: [opt] };
    });

  function submit() {
    const lines = questions.map((q) => {
      const sel = picks[q.id] ?? [];
      const o = other[q.id]?.trim();
      const ans = [...sel, ...(o ? [o] : [])].join(', ') || '(no preference)';
      return `- ${q.question} → ${ans}`;
    });
    setSubmitted(true);
    // Generic — ask_user is used for any clarification, not just design-system
    // setup, so don't assume the next step. Just feed the answers back.
    onAnswer(`My answers:\n${lines.join('\n')}\n\nContinue with these.`);
  }

  return (
    <div className='rounded-xl border border-border/70 bg-card p-4'>
      <p className='text-sm font-medium'>A few quick questions</p>
      {questions.map((q) => (
        <div key={q.id} className='mt-4'>
          <p className='mb-2 text-[13px] font-medium text-foreground'>
            {q.question}
            {q.multi && (
              <span className='ml-1.5 text-[11px] font-normal text-muted-foreground'>
                (choose any)
              </span>
            )}
          </p>
          {q.options.length > 0 && (
            <div className='flex flex-col gap-1.5'>
              {q.options.map((opt) => {
                const sel = (picks[q.id] ?? []).includes(opt);
                return (
                  <button
                    key={opt}
                    type='button'
                    disabled={done}
                    onClick={() => !done && toggle(q, opt)}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-60 ${
                      sel
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border/60 text-foreground/80 hover:border-border hover:bg-muted/50'
                    }`}
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center border ${
                        q.multi ? 'rounded-[4px]' : 'rounded-full'
                      } ${
                        sel
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/40'
                      }`}
                    >
                      {sel && <Check className='size-3' />}
                    </span>
                    <span className='min-w-0 flex-1'>{opt}</span>
                  </button>
                );
              })}
            </div>
          )}
          {q.allowOther &&
            (q.long ? (
              <textarea
                value={other[q.id] ?? ''}
                onChange={(e) =>
                  setOther((o) => ({ ...o, [q.id]: e.target.value }))
                }
                disabled={done}
                rows={4}
                placeholder={q.options.length ? 'Other…' : 'Type your answer…'}
                className='mt-1.5 max-h-60 min-h-20 w-full resize-y rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-border disabled:opacity-50'
              />
            ) : (
              <input
                value={other[q.id] ?? ''}
                onChange={(e) =>
                  setOther((o) => ({ ...o, [q.id]: e.target.value }))
                }
                disabled={done}
                placeholder={q.options.length ? 'Other…' : 'Type your answer…'}
                className='mt-1.5 w-full rounded-md border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-border disabled:opacity-50'
              />
            ))}
        </div>
      ))}
      {done ? (
        <p className='mt-3 text-xs text-muted-foreground'>Answers sent.</p>
      ) : (
        <Button size='sm' className='mt-3 gap-1.5 rounded-lg' onClick={submit}>
          <Sparkles className='size-3.5' /> Submit answers
        </Button>
      )}
    </div>
  );
}

/** Monorepo picker: choose which app to run + optional start/docs commands. */
function ConfigView({
  candidates,
  onSubmit,
}: {
  candidates: AppCandidate[];
  onSubmit: (cfg: {
    subdir?: string;
    startCmd?: string;
    docsStartCmd?: string;
    docsSubdir?: string;
    envText?: string;
  }) => void;
}) {
  const [subdir, setSubdir] = useState(candidates[0]?.dir ?? '');
  const [startCmd, setStartCmd] = useState('');
  const [docsStartCmd, setDocsStartCmd] = useState('');
  const [docsSubdir, setDocsSubdir] = useState('');
  const [envText, setEnvText] = useState('');
  const [busy, setBusy] = useState(false);

  const field =
    'w-full rounded-lg border border-border/60 bg-transparent px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/60 focus:border-border';

  return (
    <div className='rounded-xl border border-border/70 bg-card p-4'>
      <p className='text-sm font-medium'>Multiple apps found in this repo</p>
      <p className='mt-1 text-xs text-muted-foreground'>
        Pick which one Aned should run. The agent won't guess.
      </p>

      <div className='mt-3 space-y-1.5'>
        {candidates.map((c) => (
          <label
            key={c.dir}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
              subdir === c.dir
                ? 'border-violet-500/60 bg-violet-500/5'
                : 'border-border/60 hover:bg-muted/50'
            }`}
          >
            <input
              type='radio'
              name='app'
              checked={subdir === c.dir}
              onChange={() => setSubdir(c.dir)}
              className='accent-violet-500'
            />
            <span className='min-w-0 flex-1 truncate font-mono'>
              {c.dir || '(repo root)'}
            </span>
            {c.framework &&
              !['next', 'vite', 'cra', 'remix', 'astro'].includes(
                c.framework,
              ) && (
                <span className='shrink-0 text-[10px] text-muted-foreground/70'>
                  not previewable
                </span>
              )}
            {c.framework && (
              <span className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
                {c.framework}
              </span>
            )}
          </label>
        ))}
      </div>

      <div className='mt-3 space-y-2'>
        <input
          value={startCmd}
          onChange={(e) => setStartCmd(e.target.value)}
          placeholder='Start command (optional) — e.g. pnpm dev'
          className={field}
        />
        <input
          value={docsStartCmd}
          onChange={(e) => setDocsStartCmd(e.target.value)}
          placeholder='Docs/Storybook command (optional)'
          className={field}
        />
        {docsStartCmd.trim() && (
          <input
            value={docsSubdir}
            onChange={(e) => setDocsSubdir(e.target.value)}
            placeholder='Docs directory (optional) — e.g. packages/ui'
            className={field}
          />
        )}
        <textarea
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder={
            'Environment variables (optional, gitignored)\nDATABASE_URL=…\nINFISICAL_TOKEN=…  # if the repo uses a secrets manager'
          }
          rows={4}
          className={`${field} resize-none font-mono text-[12px]`}
        />
      </div>

      <Button
        className='mt-3 w-full rounded-lg'
        disabled={busy}
        onClick={() => {
          setBusy(true);
          onSubmit({
            subdir: subdir || undefined,
            startCmd: startCmd.trim() || undefined,
            docsStartCmd: docsStartCmd.trim() || undefined,
            docsSubdir: docsSubdir.trim() || undefined,
            envText: envText.trim() || undefined,
          });
        }}
      >
        {busy ? 'Starting…' : 'Continue'}
      </Button>
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
  recoverable,
}: {
  error?: string;
  log: string[];
  onRetry: () => void;
  /** Sandbox is up; only bring-up failed → the agent can fix it from chat. */
  recoverable?: boolean;
}) {
  return (
    <div className='space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
      <p className='text-sm font-medium text-destructive'>
        {recoverable
          ? "The dev server didn't start."
          : "Couldn't start the sandbox."}
      </p>
      {recoverable && (
        <p className='text-xs text-muted-foreground'>
          The sandbox is up — ask the agent below to fix it (it can read the
          logs and restart), or Retry.
        </p>
      )}
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
      <div className='flex items-center gap-2'>
        <Button size='sm' variant='secondary' onClick={onRetry}>
          <RefreshCw className='size-3.5' /> Retry
        </Button>
        {recoverable && (
          <span className='text-[11px] text-muted-foreground'>
            …or type below to direct the agent.
          </span>
        )}
      </div>
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

function GitBar({
  slug,
  manifest,
  setManifest,
  ready,
}: {
  slug: string;
  manifest: ProjectManifest | null;
  setManifest: React.Dispatch<React.SetStateAction<ProjectManifest | null>>;
  ready: boolean;
}) {
  const [mergeBusy, setMergeBusy] = useState(false);
  const prUrl = manifest?.prUrl;

  async function merge() {
    setMergeBusy(true);
    try {
      const r = await api.mergePr(slug);
      if (r.ok)
        setManifest((m) =>
          m ? { ...m, prUrl: undefined, prNumber: undefined } : m,
        );
    } finally {
      setMergeBusy(false);
    }
  }
  return (
    <div className='flex items-center gap-1.5'>
      <span className='flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground'>
        <span
          className={`size-1.5 rounded-full ${ready ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
        />
        {ready ? 'Ready' : 'Unavailable'}
      </span>

      {ready && <LogsButton slug={slug} hasDocs={!!manifest?.docsStartCmd} />}
      {manifest?.mode === 'repo' && (
        <EnvButton slug={slug} manifest={manifest} setManifest={setManifest} />
      )}

      {/* Connecting GitHub happens via the in-chat card; commits/pushes/PRs are
          automatic. Once a PR is open, View PR + Merge appear here. */}
      {prUrl && (
        <>
          <a href={prUrl} target='_blank' rel='noreferrer'>
            <Button
              size='sm'
              variant='ghost'
              className='h-8 gap-1.5 rounded-lg'
            >
              <GitPullRequest className='size-4' /> View PR
            </Button>
          </a>
          <Button
            size='sm'
            variant='secondary'
            className='h-8 gap-1.5 rounded-lg'
            disabled={mergeBusy}
            onClick={merge}
          >
            {mergeBusy ? (
              <Loader2 className='size-4 animate-spin text-orange-500' />
            ) : (
              <GitMerge className='size-4' />
            )}
            Merge
          </Button>
        </>
      )}
    </div>
  );
}

/** View the running dev-server log(s) from the sandbox, for live debugging. */
function LogsButton({ slug, hasDocs }: { slug: string; hasDocs: boolean }) {
  const [open, setOpen] = useState(false);
  const [dev, setDev] = useState('');
  const [docs, setDocs] = useState<string | undefined>();
  const [which, setWhich] = useState<'dev' | 'docs'>('dev');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    api
      .getLogs(slug)
      .then((r) => {
        setDev(r.dev);
        setDocs(r.docs);
      })
      .catch((e) => setDev(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [slug]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const body = which === 'docs' ? (docs ?? '(no docs log)') : dev || '(empty)';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size='sm' variant='ghost' className='h-8 gap-1.5 rounded-lg'>
          <Terminal className='size-4' /> Logs
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-136 max-w-[90vw]'>
        <div className='mb-2 flex items-center gap-2'>
          <p className='flex-1 text-sm font-medium'>Dev server logs</p>
          {hasDocs && (
            <div className='flex rounded-md bg-muted/60 p-0.5 text-xs'>
              {(['dev', 'docs'] as const).map((w) => (
                <button
                  key={w}
                  type='button'
                  onClick={() => setWhich(w)}
                  className={`rounded px-2 py-0.5 ${which === w ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                >
                  {w}
                </button>
              ))}
            </div>
          )}
          <button
            type='button'
            onClick={load}
            disabled={busy}
            className='rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
            title='Refresh'
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <pre className='max-h-96 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap'>
          {body}
        </pre>
      </PopoverContent>
    </Popover>
  );
}

/** Pretty name for a detected secrets manager. */
function managerLabel(id: string): string {
  return (
    {
      doppler: 'Doppler',
      infisical: 'Infisical',
      vercel: 'Vercel',
      'dotenv-vault': 'dotenv-vault',
      sops: 'SOPS',
      '1password': '1Password',
    }[id] ?? id
  );
}

/** Env map → `.env` editor text. */
function serializeEnvLines(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

/** Editor text from current env + any missing keys (appended as `KEY=`). */
function envEditorText(
  env: Record<string, string>,
  missing: string[] = [],
): string {
  const base = serializeEnvLines(env);
  const extra = missing
    .filter((k) => !(k in env))
    .map((k) => `${k}=`)
    .join('\n');
  return [base, extra].filter(Boolean).join('\n');
}

/** Edit the project's env (.env) — gitignored, applied on next restart. */
function EnvButton({
  slug,
  manifest,
  setManifest,
  missing,
  trigger,
}: {
  slug: string;
  manifest: ProjectManifest;
  setManifest: React.Dispatch<React.SetStateAction<ProjectManifest | null>>;
  /** Required-but-unset keys to prefill (e.g. flagged at bring-up). */
  missing?: string[];
  /** Custom trigger element (defaults to a toolbar "Env" button). */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Reset the editor to the persisted env (+ missing keys) each time it opens.
  useEffect(() => {
    if (open) {
      setText(envEditorText(manifest.env ?? {}, missing));
      setNote(null);
    }
  }, [open, manifest.env, missing]);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.updateEnv(slug, text);
      setManifest(res.manifest);
      setNote(
        res.applied
          ? `Wrote ${res.path ?? '.env'}. Restart the app for changes to take effect.`
          : 'Saved (sandbox offline — applied on next start).',
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button size='sm' variant='ghost' className='h-8 gap-1.5 rounded-lg'>
            <KeyRound className='size-4' /> Env
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-96'>
        <p className='mb-1 text-sm font-medium'>Environment variables</p>
        <p className='mb-2 text-xs text-muted-foreground'>
          Written to <code>.env</code> (gitignored — never committed).
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'DATABASE_URL=…\nSTRIPE_SECRET_KEY=…'}
          rows={8}
          className='w-full resize-none rounded-lg border border-border/60 bg-transparent px-2.5 py-2 font-mono text-[12px] outline-none placeholder:text-muted-foreground/60 focus:border-border'
        />
        {note && <p className='mt-2 text-xs text-muted-foreground'>{note}</p>}
        <div className='mt-2 flex justify-end'>
          <Button
            size='sm'
            className='h-8 rounded-lg'
            disabled={busy}
            onClick={save}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * In-chat GitHub integration box, shown after a task when no remote is
 * connected. Creates a private repo, pushes, and opens the first PR — then the
 * whole git flow (commit/push/PR) is automatic on every later task.
 */
function ConnectGitHubCard({
  slug,
  defaultName,
  onConnected,
}: {
  slug: string;
  defaultName: string;
  onConnected: () => void;
}) {
  const [name, setName] = useState(
    defaultName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app',
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // GitHub account connection (OAuth) status.
  const [gh, setGh] = useState<{
    connected: boolean;
    login: string | null;
  } | null>(null);
  useEffect(() => {
    api
      .githubStatus()
      .then(setGh)
      .catch(() => setGh({ connected: false, login: null }));
  }, []);

  function connectAccount() {
    const next = encodeURIComponent(window.location.pathname);
    // Open the OAuth flow in a NEW TAB; it notifies us + closes when done.
    window.open(`/api/auth/github?popup=1&next=${next}`, '_blank');
    const onMsg = (e: MessageEvent) => {
      if (e.data === 'weave-github-connected') {
        window.removeEventListener('message', onMsg);
        setGh(null);
        api
          .githubStatus()
          .then(setGh)
          .catch(() => {});
      } else if (e.data === 'weave-github-error') {
        window.removeEventListener('message', onMsg);
      }
    };
    window.addEventListener('message', onMsg);
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.ship(slug, { repoName: name });
      if (r.ok) {
        setDone(true);
        onConnected();
      } else {
        setError(r.error ?? 'Connect failed.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className='flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm'>
        <Check className='size-4 text-emerald-500' />
        Connected to GitHub — changes now commit, push & PR automatically.
      </div>
    );
  }

  return (
    <div className='rounded-xl border border-border/70 bg-card/60 p-3'>
      <div className='flex items-center gap-2'>
        <GitPullRequest className='size-4 text-muted-foreground' />
        <p className='text-sm font-medium'>Connect GitHub</p>
      </div>
      <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
        Your work lives only in this sandbox until you connect a repo. Connect
        your GitHub and create a private repo — then every task commits, pushes,
        and opens a PR automatically.
      </p>

      {gh === null ? (
        <p className='mt-2.5 flex items-center gap-2 text-xs text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin text-orange-500' /> Checking
          GitHub…
        </p>
      ) : !gh.connected ? (
        <Button
          size='sm'
          className='mt-2.5 gap-1.5 rounded-lg'
          onClick={connectAccount}
        >
          <GitPullRequest className='size-4' /> Connect GitHub account
        </Button>
      ) : (
        <>
          {gh.login && (
            <p className='mt-2 text-[11px] text-muted-foreground'>
              Connected as <span className='text-foreground'>{gh.login}</span>
            </p>
          )}
          <div className='mt-2 flex gap-2'>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='repo-name'
              className='h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
            />
            <Button
              size='sm'
              className='h-9 gap-1.5 rounded-lg'
              disabled={busy || !name.trim()}
              onClick={connect}
            >
              {busy ? (
                <Loader2 className='size-4 animate-spin text-orange-500' />
              ) : (
                <GitPullRequest className='size-4' />
              )}
              Create repo
            </Button>
          </div>
        </>
      )}
      {error && <p className='mt-2 text-xs text-destructive'>{error}</p>}
    </div>
  );
}

function parseRepoLabel(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return m?.[1] ?? null;
}

/** Folders first, then alphabetical — stable ordering for the file tree. */
function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
  );
}

function SkillCard({ skill }: { skill: api.Skill }) {
  return (
    <div className='rounded-lg border border-border/60 bg-card/40 p-3'>
      <div className='flex items-center gap-2'>
        <Sparkles className='size-3.5 shrink-0 text-violet-400' />
        <span className='min-w-0 flex-1 truncate text-sm font-medium'>
          {skill.name}
        </span>
        <code className='shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground'>
          /{skill.name}
        </code>
      </div>
      {skill.description && (
        <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
          {skill.description}
        </p>
      )}
    </div>
  );
}

/** The PROJECT's own skills. Aned's built-ins are internal and not shown. */
function SkillsView({
  skills,
  onPrompt,
}: {
  skills: api.Skill[];
  /** Send a message to the agent (switches to chat) to create/edit a skill. */
  onPrompt: (message: string) => void;
}) {
  return (
    <ScrollArea className='min-h-0 flex-1'>
      <div className='space-y-2 p-3'>
        <div className='flex items-center gap-2 px-1'>
          <p className='flex-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase'>
            Project skills
          </p>
          <button
            type='button'
            onClick={() =>
              onPrompt(
                "Let's create a new project skill. Ask me what it should do and how it should behave (use ask_user), then write it to .claude/skills/<name>/SKILL.md with rich, specific guidance and confirm.",
              )
            }
            className='flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground'
          >
            <Plus className='size-3.5' /> Add with agent
          </button>
        </div>

        {skills.length ? (
          skills.map((s) => (
            <div key={s.name} className='group relative'>
              <SkillCard skill={s} />
              <button
                type='button'
                onClick={() =>
                  onPrompt(
                    `Let's improve the "${s.name}" skill. Read .claude/skills/${s.name}/SKILL.md, ask me what to change or add (use ask_user), then update it.`,
                  )
                }
                className='absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground'
              >
                Edit with agent
              </button>
            </div>
          ))
        ) : (
          <p className='px-1 py-1 text-xs text-muted-foreground'>
            None yet — click “Add with agent”, or drop a{' '}
            <code>.claude/skills/</code> folder in the repo.
          </p>
        )}
        <p className='px-1 pt-2 text-[11px] text-muted-foreground/60'>
          Type <code>/</code> in the chat to invoke a skill.
        </p>
      </div>
    </ScrollArea>
  );
}

/** Code tab: file tree + changes (left) and a read-only file/diff viewer. */
function CodeView({
  slug,
  ready,
  nonce,
}: {
  slug: string;
  ready: boolean;
  nonce: number;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<{
    content: string;
    diff: string;
    added: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'diff' | 'source'>('diff');
  const [changes, setChanges] = useState<api.ChangedFile[]>([]);

  const open = useCallback(
    (path: string) => {
      setSelected(path);
      setLoading(true);
      api
        .getFile(slug, path)
        .then((d) => {
          setData(d);
          // Default to Source — the git gutter shows the changes inline
          // (VSCode-style); Diff is the alternate unified view.
          setMode('source');
        })
        .catch(() => setData({ content: '', diff: '', added: false }))
        .finally(() => setLoading(false));
    },
    [slug],
  );

  // Refresh the changes list + the open file after edits (nonce bump).
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce-driven refresh
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    api
      .getChanges(slug)
      .then((r) => !cancelled && setChanges(r.files))
      .catch(() => {});
    if (selected) open(selected);
    return () => {
      cancelled = true;
    };
  }, [slug, ready, nonce]);

  const statusMap = new Map(changes.map((c) => [c.path, c.status]));

  return (
    <div className='flex h-full bg-background'>
      <div className='flex w-72 shrink-0 flex-col border-r border-border/60'>
        <Directory
          slug={slug}
          ready={ready}
          nonce={nonce}
          onSelect={open}
          selected={selected ?? undefined}
          changes={statusMap}
        />
      </div>
      <div className='min-h-0 flex-1'>
        <FileViewer
          path={selected}
          data={data}
          loading={loading}
          mode={mode}
          setMode={setMode}
        />
      </div>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  A: 'text-emerald-500',
  U: 'text-emerald-500',
  M: 'text-amber-500',
  D: 'text-rose-500',
  R: 'text-sky-500',
  C: 'text-sky-500',
  '?': 'text-muted-foreground',
};

type StatusMap = Map<string, api.ChangedFile['status']>;

/** Read-only file viewer: source or unified diff (line-colored). */
function FileViewer({
  path,
  data,
  loading,
  mode,
  setMode,
}: {
  path: string | null;
  data: { content: string; diff: string; added: boolean } | null;
  loading: boolean;
  mode: 'diff' | 'source';
  setMode: (m: 'diff' | 'source') => void;
}) {
  if (!path) {
    return (
      <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
        Select a file to view.
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'>
        <Loader2 className='size-4 animate-spin text-orange-500' /> Loading…
      </div>
    );
  }
  const hasDiff = !!data.diff.trim();
  const showDiff = mode === 'diff' && hasDiff;
  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center gap-2 border-b border-border/60 px-3 py-1.5'>
        <span className='min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground'>
          {path}
        </span>
        {hasDiff && (
          <div className='flex rounded-md bg-muted/60 p-0.5 text-[11px]'>
            {(['diff', 'source'] as const).map((m) => (
              <button
                key={m}
                type='button'
                onClick={() => setMode(m)}
                className={`rounded px-2 py-0.5 ${mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
      {showDiff ? (
        <ScrollArea className='min-h-0 flex-1'>
          <DiffBody diff={data.diff} />
        </ScrollArea>
      ) : (
        <div className='min-h-0 flex-1 overflow-hidden'>
          <CodeViewer
            filename={path}
            content={data.content}
            diff={data.diff}
            added={data.added}
          />
        </div>
      )}
    </div>
  );
}

/** Render a unified diff with +/- line coloring. */
function DiffBody({ diff }: { diff: string }) {
  return (
    <pre className='p-3 font-mono text-[11px] leading-relaxed'>
      {diff.split('\n').map((l, i) => {
        const cls =
          l.startsWith('+') && !l.startsWith('+++')
            ? 'text-emerald-400 bg-emerald-500/10'
            : l.startsWith('-') && !l.startsWith('---')
              ? 'text-rose-400 bg-rose-500/10'
              : l.startsWith('@@')
                ? 'text-sky-400'
                : /^(diff |index |\+\+\+|---)/.test(l)
                  ? 'text-muted-foreground/50'
                  : 'text-muted-foreground';
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static diff lines
            key={i}
            className={`whitespace-pre-wrap ${cls}`}
          >
            {l || ' '}
          </div>
        );
      })}
    </pre>
  );
}

function Directory({
  slug,
  ready,
  nonce,
  onSelect,
  selected,
  changes,
}: {
  slug: string;
  ready: boolean;
  /** Bumps after each edit → silent refresh (no spinner) of the tree. */
  nonce: number;
  onSelect: (path: string) => void;
  selected?: string;
  /** Git status per workdir-relative path (drives M/U/A/D badges). */
  changes: StatusMap;
}) {
  // null = loading; [] = empty; FileNode[] = listed.
  const [nodes, setNodes] = useState<FileNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a refetch trigger
  useEffect(() => {
    if (!ready) {
      setNodes(null);
      setError(null);
      loadedOnce.current = false;
      return;
    }
    let cancelled = false;
    // Show the spinner only on the FIRST load; later refreshes (tab switches,
    // post-edit nonce bumps) update in place without clearing the tree.
    if (!loadedOnce.current) {
      setNodes(null);
      setError(null);
    }
    api
      .getFiles(slug)
      .then((n) => {
        if (!cancelled) {
          setNodes(sortNodes(n));
          loadedOnce.current = true;
        }
      })
      .catch((e) => {
        if (!cancelled && !loadedOnce.current)
          setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, ready, nonce]);

  return (
    <ScrollArea className='min-h-0 flex-1'>
      <div className='p-2'>
        {!ready ? (
          <p className='px-2 py-1 text-sm text-muted-foreground'>
            Sandbox not ready.
          </p>
        ) : error ? (
          <p className='px-2 py-1 text-sm text-muted-foreground'>
            Couldn’t load files: {error}
          </p>
        ) : nodes === null ? (
          <p className='flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground'>
            <Loader2 className='size-3.5 animate-spin' /> Loading files…
          </p>
        ) : nodes.length ? (
          nodes.map((n) => (
            <FileTreeNode
              key={n.path}
              slug={slug}
              node={n}
              depth={0}
              onSelect={onSelect}
              selected={selected}
              changes={changes}
            />
          ))
        ) : (
          <p className='px-2 py-1 text-sm text-muted-foreground'>No files.</p>
        )}
      </div>
    </ScrollArea>
  );
}

/** One row of the file tree. Folders lazily fetch children on first expand. */
function FileTreeNode({
  slug,
  node,
  depth,
  onSelect,
  selected,
  changes,
}: {
  slug: string;
  node: FileNode;
  depth: number;
  onSelect: (path: string) => void;
  selected?: string;
  changes: StatusMap;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FileNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const indent = { paddingLeft: `${depth * 14 + 8}px` };

  if (!node.isDir) {
    const active = selected === node.path;
    const status = changes.get(node.path);
    const tint = status ? STATUS_COLOR[status] : '';
    return (
      <button
        type='button'
        style={indent}
        onClick={() => onSelect(node.path)}
        className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] transition-colors ${
          active ? 'bg-muted' : 'hover:bg-muted/50'
        } ${status ? tint : 'text-muted-foreground'}`}
      >
        <span className='size-3.5 shrink-0' />
        <File className='size-3.5 shrink-0 text-muted-foreground/50' />
        <span className='truncate'>{node.name}</span>
        {status && (
          <span className={`ml-auto shrink-0 font-mono text-[11px] ${tint}`}>
            {status}
          </span>
        )}
      </button>
    );
  }

  // Folder: a dot when any change lives under it (VSCode-style rollup).
  const dirty = (() => {
    const prefix = `${node.path}/`;
    for (const p of changes.keys()) if (p.startsWith(prefix)) return true;
    return false;
  })();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && children === null && !loading) {
      setLoading(true);
      api
        .getFiles(slug, node.path)
        .then((n) => setChildren(sortNodes(n)))
        .catch(() => setChildren([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <>
      <button
        type='button'
        onClick={toggle}
        style={indent}
        className='flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted/50'
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground/70 transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
        {open ? (
          <FolderOpen className='size-3.5 shrink-0 text-sky-400/80' />
        ) : (
          <Folder className='size-3.5 shrink-0 text-sky-400/80' />
        )}
        <span className='truncate'>{node.name}</span>
        {loading ? (
          <Loader2 className='ml-auto size-3 shrink-0 animate-spin text-orange-500' />
        ) : (
          dirty && (
            <span className='ml-auto size-1.5 shrink-0 rounded-full bg-amber-500' />
          )
        )}
      </button>
      {open &&
        children !== null &&
        (children.length ? (
          children.map((c) => (
            <FileTreeNode
              key={c.path}
              slug={slug}
              node={c}
              depth={depth + 1}
              onSelect={onSelect}
              selected={selected}
              changes={changes}
            />
          ))
        ) : loading ? null : (
          <div
            style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            className='py-1 font-mono text-xs text-muted-foreground/60'
          >
            empty
          </div>
        ))}
    </>
  );
}

function patchLast(turns: Turn[], fn: (a: Turn) => Turn): Turn[] {
  if (!turns.length) return turns;
  const next = [...turns];
  const last = next[next.length - 1];
  if (last && last.role === 'assistant') next[next.length - 1] = fn(last);
  return next;
}

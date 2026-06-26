/** Shared types for Aned's sandbox-backed projects. */

/** How a project was seeded. */
export type ProjectMode = 'repo' | 'scratch';

/** Lifecycle of a project's sandbox. */
export type ProjectStatus =
  | 'new' // created, not yet seeded
  | 'seeding' // cloning/scaffolding/installing/starting dev
  | 'needs-config' // cloned, but >1 app found — waiting for the user to pick one
  | 'ready' // dev server up, preview live
  | 'error'; // seed failed

/** A runnable app found in a cloned repo (for the monorepo picker). */
export interface AppCandidate {
  /** Directory relative to the repo root ('' = root). */
  dir: string;
  /** The dev/start script command found in its package.json. */
  start?: string;
  /** Detected framework (next/vite/cra/remix/astro). */
  framework?: string;
}

/** Durable project record (sandbox itself is ephemeral). */
export interface ProjectManifest {
  slug: string;
  name: string;
  mode: ProjectMode;
  /** Source repo (repo mode). */
  repoUrl?: string;
  /**
   * Subdirectory of the repo to treat as the app (monorepos), e.g.
   * "frontend-v2" / "apps/web". Empty/undefined = repo root (agent auto-detects
   * the runnable app on bring-up). Git stays at the repo root; this only scopes
   * the workdir (bring-up, file tree, design system, chat cwd).
   */
  subdir?: string;
  /**
   * Optional override for the app's dev/start command (else the agent detects
   * it). e.g. "pnpm dev:web", "turbo dev --filter=web".
   */
  startCmd?: string;
  /**
   * Opt-in SECOND server feeding the Design-system tab (e.g. Storybook / a docs
   * app). When set, bring-up also starts this command on its own port; the
   * Design-system tab iframes it instead of the in-app /design-system route.
   */
  docsStartCmd?: string;
  /** Subdir the docs server runs in (default repo root). */
  docsSubdir?: string;
  /**
   * User-supplied environment variables (API keys, DB URLs, secrets). Written to
   * the app's `.env` (gitignored) before bring-up + injected into the dev
   * server. Stored plaintext in the manifest — local dev tool, not for prod.
   */
  env?: Record<string, string>;
  /**
   * Env var names the bring-up agent flagged as REQUIRED but unset (and not
   * safely defaultable). Drives a "provide env" prompt in the workspace; cleared
   * as the keys get filled in.
   */
  missingEnv?: string[];
  /** Detected secrets manager (doppler/infisical/vercel/…), for UI hints. */
  secretsManager?: string;
  /** Runnable apps found in the repo, when >1 (drives the folder picker). */
  appCandidates?: AppCandidate[];
  /** Port + preview for the docs server (set on bring-up when docsStartCmd). */
  docsPort?: number;
  docsPreviewUrl?: string;
  /** Initial build prompt (scratch mode). */
  initialPrompt?: string;
  /**
   * Scratch stack: 'website' → Next.js (App Router); 'app' → Vite + TanStack
   * Router. Classified from the prompt at creation.
   */
  kind?: 'website' | 'app';
  /** Whether the first turn runs in plan or build mode (scratch mode). */
  initialMode?: 'build' | 'plan';
  /** Model chosen at creation; the workspace defaults its picker to this. */
  model?: string;
  /** Working/session branch Aned commits to (created off baseBranch). */
  branch: string;
  /** Default branch PRs target (main/master). */
  baseBranch?: string;
  /** Open PR for the current session, if any. */
  prUrl?: string;
  prNumber?: number;
  /** Session counter, for fresh branch names after a merge. */
  sessionN?: number;
  /** E2B sandbox id, for reconnecting across requests. */
  sandboxId?: string;
  /** Port the dev server listens on inside the sandbox. */
  devPort: number;
  /** Public preview URL (E2B getHost), recomputed on reconnect. */
  previewUrl?: string;
  /**
   * Optional backend/API server (monorepo with a separate backend the user
   * opted to run). Not viewed in a tab — the frontend calls it at backendUrl.
   */
  backendPort?: number;
  backendUrl?: string;
  /** Whether Aned has injected the dev-only route reporter into the app yet. */
  routeReporter?: boolean;
  /** Agent SDK session id, for resuming the conversation. */
  sessionId?: string;
  /**
   * In-app route the Design-system tab serves — adopted from an existing
   * styleguide/design-system route, else the created `/design-system`. Read
   * from design-system/design-system.json after a DS task.
   */
  designRoute?: string;
  status: ProjectStatus;
  /** Last seed error, if status === 'error'. */
  error?: string;
  createdAt: string;
}

/** One tool invocation shown under an assistant turn. */
export interface ChatToolLine {
  name: string;
  target?: string;
}

/** A persisted chat turn (the workspace transcript). */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Dynamic questions the agent asked this turn (rendered as a form). */
  questions?: AskQuestion[];
  tools?: ChatToolLine[];
  /** Attached image data URLs (user turns). */
  images?: string[];
}

/** A node in the sandbox file tree (Directory tab). */
export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

/** Status of a tracked build/agent step. */
export type TaskStatus = 'pending' | 'active' | 'done' | 'skip' | 'error';

/** A question the agent asks the user (rendered as a dynamic form). */
export interface AskQuestion {
  id: string;
  question: string;
  /** Selectable options (chips/radio). May be empty for a free-text-only ask. */
  options: string[];
  /** Allow a custom free-text answer in addition to the options. */
  allowOther?: boolean;
  /** Allow selecting more than one option. */
  multi?: boolean;
  /** Free-text answer is expected to be long → render a textarea, not an input. */
  long?: boolean;
}

/**
 * An event streamed (NDJSON / SSE) from a seed or chat endpoint.
 * `seed` endpoints emit step/log/done; `chat` emits text/tool/todo/done.
 */
export type AgentEvent =
  | { type: 'status'; status: string }
  | { type: 'step'; label: string; status: TaskStatus }
  | { type: 'log'; line: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; target?: string }
  | { type: 'todo'; id: string; label: string; status: TaskStatus }
  | { type: 'questions'; questions: AskQuestion[] }
  | {
      type: 'preview';
      url: string;
      port: number;
      role?: 'app' | 'docs' | 'backend';
    }
  | {
      type: 'done';
      ok: boolean;
      manifest: ProjectManifest;
      sessionId?: string;
      error?: string;
    };

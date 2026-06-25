/** Shared types for Aned's sandbox-backed projects. */

/** How a project was seeded. */
export type ProjectMode = 'repo' | 'scratch';

/** Lifecycle of a project's sandbox. */
export type ProjectStatus =
  | 'new' // created, not yet seeded
  | 'seeding' // cloning/scaffolding/installing/starting dev
  | 'ready' // dev server up, preview live
  | 'error'; // seed failed

/** Durable project record (sandbox itself is ephemeral). */
export interface ProjectManifest {
  slug: string;
  name: string;
  mode: ProjectMode;
  /** Source repo (repo mode). */
  repoUrl?: string;
  /** Initial build prompt (scratch mode). */
  initialPrompt?: string;
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
  /** Agent SDK session id, for resuming the conversation. */
  sessionId?: string;
  status: ProjectStatus;
  /** Last seed error, if status === 'error'. */
  error?: string;
  createdAt: string;
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
  | {
      type: 'done';
      ok: boolean;
      manifest: ProjectManifest;
      sessionId?: string;
      error?: string;
    };

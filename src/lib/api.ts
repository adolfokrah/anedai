/** Browser client for Aned's /api routes. */

import type { AgentEvent, ChatTurn, FileNode, ProjectManifest } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function listProjects(): Promise<ProjectManifest[]> {
  return fetch('/api/projects').then(json<ProjectManifest[]>);
}

export function renameProject(
  slug: string,
  name: string,
): Promise<ProjectManifest> {
  return fetch(`/api/projects/${slug}/rename`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json<ProjectManifest>);
}

export function getProject(slug: string): Promise<ProjectManifest> {
  return fetch(`/api/projects/${slug}`).then(json<ProjectManifest>);
}

/** Delete a project: terminates its sandbox and purges persisted files. */
export function deleteProject(slug: string): Promise<{ ok: boolean }> {
  return fetch(`/api/projects/${slug}`, { method: 'DELETE' }).then(
    json<{ ok: boolean }>,
  );
}

/** Inject the dev-only route reporter into the running app(s) (address-bar tracking). */
export function ensureReporter(slug: string): Promise<{
  injected: number;
  already: number;
  files: string[];
  reason?: string;
}> {
  return fetch(`/api/projects/${slug}/ensure-reporter`, {
    method: 'POST',
  }).then(
    json<{
      injected: number;
      already: number;
      files: string[];
      reason?: string;
    }>,
  );
}

/** Reconcile PR state with GitHub (clears a PR merged/closed externally). */
export function refreshProject(slug: string): Promise<ProjectManifest> {
  return fetch(`/api/projects/${slug}/refresh`, { method: 'POST' }).then(
    json<ProjectManifest>,
  );
}

/** The persisted workspace transcript. */
export function getMessages(slug: string): Promise<ChatTurn[]> {
  return fetch(`/api/projects/${slug}/messages`).then(json<ChatTurn[]>);
}

/** Persist the full transcript (fire-and-forget on the client). */
export function saveMessages(slug: string, turns: ChatTurn[]): Promise<void> {
  return fetch(`/api/projects/${slug}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ turns }),
  }).then(() => undefined);
}

export function getFiles(slug: string, path?: string): Promise<FileNode[]> {
  const q = path ? `?path=${encodeURIComponent(path)}` : '';
  return fetch(`/api/projects/${slug}/files${q}`).then(json<FileNode[]>);
}

/** Detected preview routes (e.g. "/", "/pricing"). */
export function getRoutes(slug: string): Promise<string[]> {
  return fetch(`/api/projects/${slug}/routes`).then(json<string[]>);
}

/** Read a file's contents + diff vs base (`added` = file is new vs base). */
export function getFile(
  slug: string,
  path: string,
): Promise<{ content: string; diff: string; added: boolean }> {
  return fetch(
    `/api/projects/${slug}/file?path=${encodeURIComponent(path)}`,
  ).then(json<{ content: string; diff: string; added: boolean }>);
}

export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?';
  additions: number;
  deletions: number;
}

/** Files the working branch changed vs base (what the PR will contain). */
export function getChanges(
  slug: string,
): Promise<{ base: string; files: ChangedFile[] }> {
  return fetch(`/api/projects/${slug}/changes`).then(
    json<{ base: string; files: ChangedFile[] }>,
  );
}

/** Resolve + persist the design-system route from the sandbox (backstop). */
export function resolveDesignRoute(
  slug: string,
): Promise<{ route: string | null; manifest: ProjectManifest }> {
  return fetch(`/api/projects/${slug}/design-route`).then(
    json<{ route: string | null; manifest: ProjectManifest }>,
  );
}

export interface Skill {
  name: string;
  description: string;
  source: 'aned' | 'repo';
}

/** Skills available to the agent (bundled + the project's own). */
export function getSkills(slug: string): Promise<Skill[]> {
  return fetch(`/api/projects/${slug}/skills`).then((r) =>
    json<{ skills: Skill[] }>(r).then((d) => d.skills),
  );
}

export interface StreamResult {
  manifest: ProjectManifest;
  sessionId?: string;
}

/** POST and consume an NDJSON event stream, forwarding each event. */
async function stream(
  url: string,
  body: unknown,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: StreamResult | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as AgentEvent;
      onEvent(event);
      if (event.type === 'done') {
        if (!event.ok) throw new Error(event.error ?? 'run failed');
        final = { manifest: event.manifest, sessionId: event.sessionId };
      }
    }
  }
  if (!final) throw new Error('stream ended without a result');
  return final;
}

export function seedProject(
  slug: string,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  return stream(`/api/projects/${slug}/seed`, {}, onEvent, signal);
}

/** Resolve a needs-config project (pick app folder + commands), → status new. */
export function configProject(
  slug: string,
  cfg: {
    subdir?: string;
    startCmd?: string;
    docsStartCmd?: string;
    docsSubdir?: string;
    envText?: string;
  },
): Promise<ProjectManifest> {
  return fetch(`/api/projects/${slug}/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cfg),
  }).then(json<ProjectManifest>);
}

/** Restart the dev server(s) in the existing sandbox (no reclone). */
export function restartProject(
  slug: string,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  return stream(`/api/projects/${slug}/restart`, {}, onEvent, signal);
}

/** Tail the running dev-server log(s) from the sandbox. */
export function getLogs(slug: string): Promise<{ dev: string; docs?: string }> {
  return fetch(`/api/projects/${slug}/logs`).then(
    json<{ dev: string; docs?: string }>,
  );
}

/** Sandbox liveness: reconnects (resuming if stopped) + checks the dev server. */
export function checkAlive(
  slug: string,
): Promise<{ alive: boolean; server: boolean }> {
  return fetch(`/api/projects/${slug}/alive`).then(
    json<{ alive: boolean; server: boolean }>,
  );
}

export interface ChatImage {
  data: string;
  mediaType: string;
}

export function chat(
  slug: string,
  message: string,
  onEvent: (e: AgentEvent) => void,
  opts: {
    model?: string;
    signal?: AbortSignal;
    images?: ChatImage[];
    /** Route the user is currently viewing in the preview (e.g. "/pricing"). */
    viewing?: string;
    /** build (default) edits + ships; plan is read-only and returns a plan. */
    mode?: 'build' | 'plan';
    /** A skill to invoke for this turn (its SKILL.md is loaded server-side). */
    skill?: string;
  } = {},
): Promise<StreamResult> {
  return stream(
    `/api/projects/${slug}/chat`,
    {
      message,
      model: opts.model,
      images: opts.images,
      viewing: opts.viewing,
      mode: opts.mode,
      skill: opts.skill,
    },
    onEvent,
    opts.signal,
  );
}

export function ship(
  slug: string,
  opts: { repoName?: string } = {},
): Promise<{ url?: string; ok: boolean; error?: string }> {
  return fetch(`/api/projects/${slug}/ship`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts),
  }).then(json<{ url?: string; ok: boolean; error?: string }>);
}

export function githubStatus(): Promise<{
  connected: boolean;
  login: string | null;
  oauth: boolean;
}> {
  return fetch('/api/auth/github/status').then(
    json<{ connected: boolean; login: string | null; oauth: boolean }>,
  );
}

/** Update the project's env (rewrites the sandbox .env, gitignored). */
export function updateEnv(
  slug: string,
  envText: string,
): Promise<{ manifest: ProjectManifest; applied: boolean; path?: string }> {
  return fetch(`/api/projects/${slug}/env`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envText }),
  }).then(json<{ manifest: ProjectManifest; applied: boolean; path?: string }>);
}

/** Disconnect the current GitHub account (clears the session). */
export function disconnectGithub(): Promise<{ ok: boolean }> {
  return fetch('/api/auth/github/disconnect', { method: 'POST' }).then(
    json<{ ok: boolean }>,
  );
}

export interface Repo {
  fullName: string;
  cloneUrl: string;
  private: boolean;
}

export function listRepos(): Promise<Repo[]> {
  return fetch('/api/github/repos').then(json<Repo[]>);
}

export function mergePr(
  slug: string,
): Promise<{ url?: string; ok: boolean; error?: string }> {
  return fetch(`/api/projects/${slug}/merge`, { method: 'POST' }).then(
    json<{ url?: string; ok: boolean; error?: string }>,
  );
}

export function endSession(
  slug: string,
): Promise<{ ok: boolean; branch?: string; manifest?: ProjectManifest }> {
  return fetch(`/api/projects/${slug}/session`, { method: 'POST' }).then(
    json<{ ok: boolean; branch?: string; manifest?: ProjectManifest }>,
  );
}

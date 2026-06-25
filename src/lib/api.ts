/** Browser client for Weave's /api routes. */

import type { AgentEvent, FileNode, ProjectManifest } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function getProject(slug: string): Promise<ProjectManifest> {
  return fetch(`/api/projects/${slug}`).then(json<ProjectManifest>);
}

export function getFiles(slug: string, path?: string): Promise<FileNode[]> {
  const q = path ? `?path=${encodeURIComponent(path)}` : '';
  return fetch(`/api/projects/${slug}/files${q}`).then(json<FileNode[]>);
}

/** Detected preview routes (e.g. "/", "/pricing"). */
export function getRoutes(slug: string): Promise<string[]> {
  return fetch(`/api/projects/${slug}/routes`).then(json<string[]>);
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

export interface ChatImage {
  data: string;
  mediaType: string;
}

export function chat(
  slug: string,
  message: string,
  onEvent: (e: AgentEvent) => void,
  opts: { model?: string; signal?: AbortSignal; images?: ChatImage[] } = {},
): Promise<StreamResult> {
  return stream(
    `/api/projects/${slug}/chat`,
    { message, model: opts.model, images: opts.images },
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

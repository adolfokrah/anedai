/**
 * Durable project store. Sandboxes are ephemeral; the manifest is the only
 * thing we persist between requests. v1: one JSON file per project under
 * `data/projects/<slug>.json` (gitignored). Swap for SQLite later if needed.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ChatTurn, ProjectManifest } from './types';

const STORE_DIR = path.join(process.cwd(), 'data', 'projects');

async function ensureDir() {
  await fs.mkdir(STORE_DIR, { recursive: true });
}

function file(slug: string) {
  return path.join(STORE_DIR, `${slug}.json`);
}

function messagesFile(slug: string) {
  return path.join(STORE_DIR, `${slug}.messages.json`);
}

/** The persisted workspace transcript for a project (empty if none yet). */
export async function getMessages(slug: string): Promise<ChatTurn[]> {
  try {
    return JSON.parse(await fs.readFile(messagesFile(slug), 'utf8'));
  } catch {
    return [];
  }
}

/** Overwrite the persisted transcript (the client sends the full array). */
export async function saveMessages(
  slug: string,
  turns: ChatTurn[],
): Promise<void> {
  await ensureDir();
  await fs.writeFile(messagesFile(slug), JSON.stringify(turns), 'utf8');
}

/** Kebab-case slug from a name, with a short random suffix for uniqueness. */
export function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'untitled';
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

export async function listProjects(): Promise<ProjectManifest[]> {
  await ensureDir();
  const names = await fs.readdir(STORE_DIR).catch(() => [] as string[]);
  const out: ProjectManifest[] = [];
  for (const n of names) {
    if (!n.endsWith('.json') || n.endsWith('.messages.json')) continue;
    try {
      out.push(JSON.parse(await fs.readFile(path.join(STORE_DIR, n), 'utf8')));
    } catch {
      // skip corrupt manifest
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(
  slug: string,
): Promise<ProjectManifest | null> {
  try {
    return JSON.parse(await fs.readFile(file(slug), 'utf8'));
  } catch {
    return null;
  }
}

export async function saveProject(
  m: ProjectManifest,
): Promise<ProjectManifest> {
  await ensureDir();
  await fs.writeFile(file(m.slug), JSON.stringify(m, null, 2), 'utf8');
  return m;
}

/** Delete a project's persisted files (manifest, transcript, thumbnail). */
export async function deleteProject(slug: string): Promise<void> {
  await Promise.all(
    [
      file(slug),
      messagesFile(slug),
      path.join(STORE_DIR, `${slug}.thumb.png`),
    ].map((p) => fs.rm(p, { force: true })),
  );
}

/** Read-modify-write a manifest atomically enough for single-process dev. */
export async function updateProject(
  slug: string,
  patch: Partial<ProjectManifest>,
): Promise<ProjectManifest> {
  const cur = await getProject(slug);
  if (!cur) throw new Error(`project not found: ${slug}`);
  return saveProject({ ...cur, ...patch });
}

import { NextResponse } from 'next/server';

import { parseEnv } from '@/lib/env';
import { classifyKind } from '@/lib/seed/template';
import { listProjects, saveProject, slugify } from '@/lib/store';
import type { ProjectManifest, ProjectMode } from '@/lib/types';

export async function GET() {
  return NextResponse.json(await listProjects());
}

interface CreateBody {
  mode: ProjectMode;
  name?: string;
  repoUrl?: string;
  subdir?: string;
  startCmd?: string;
  docsStartCmd?: string;
  docsSubdir?: string;
  /** Raw `.env` text the user pasted (repo mode). */
  envText?: string;
  initialPrompt?: string;
  initialMode?: 'build' | 'plan';
  model?: string;
}

const trimDir = (s?: string) =>
  s?.trim().replace(/^\/+|\/+$/g, '') || undefined;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const mode: ProjectMode = body.mode === 'repo' ? 'repo' : 'scratch';

  if (mode === 'repo' && !body.repoUrl?.trim()) {
    return NextResponse.json({ error: 'repoUrl required' }, { status: 400 });
  }
  if (mode === 'scratch' && !body.initialPrompt?.trim()) {
    return NextResponse.json(
      { error: 'initialPrompt required' },
      { status: 400 },
    );
  }

  const name =
    body.name?.trim() ||
    (mode === 'repo' ? deriveRepoName(body.repoUrl ?? '') : 'Untitled');
  const slug = slugify(name);

  const manifest: ProjectManifest = {
    slug,
    name,
    mode,
    repoUrl: mode === 'repo' ? body.repoUrl?.trim() : undefined,
    subdir: mode === 'repo' ? trimDir(body.subdir) : undefined,
    startCmd: mode === 'repo' ? body.startCmd?.trim() || undefined : undefined,
    docsStartCmd:
      mode === 'repo' ? body.docsStartCmd?.trim() || undefined : undefined,
    docsSubdir: mode === 'repo' ? trimDir(body.docsSubdir) : undefined,
    env:
      mode === 'repo' && body.envText?.trim()
        ? parseEnv(body.envText)
        : undefined,
    initialPrompt: mode === 'scratch' ? body.initialPrompt?.trim() : undefined,
    initialMode:
      mode === 'scratch' && body.initialMode === 'plan' ? 'plan' : undefined,
    kind:
      mode === 'scratch' ? classifyKind(body.initialPrompt ?? '') : undefined,
    model: body.model,
    // Named on the first task of each session: <project>/<task-title>.
    branch: '',
    devPort: 3000,
    status: 'new',
    createdAt: new Date().toISOString(),
  };
  await saveProject(manifest);

  return NextResponse.json(manifest, { status: 201 });
}

function deriveRepoName(url: string): string {
  const m = url.match(/([^/]+?)(?:\.git)?\/?$/);
  return m?.[1] ?? 'repo';
}

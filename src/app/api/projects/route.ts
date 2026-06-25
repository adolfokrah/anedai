import { NextResponse } from 'next/server';

import { listProjects, saveProject, slugify } from '@/lib/store';
import type { ProjectManifest, ProjectMode } from '@/lib/types';

export async function GET() {
  return NextResponse.json(await listProjects());
}

interface CreateBody {
  mode: ProjectMode;
  name?: string;
  repoUrl?: string;
  initialPrompt?: string;
}

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
    initialPrompt: mode === 'scratch' ? body.initialPrompt?.trim() : undefined,
    branch: `weave/${slug}`,
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

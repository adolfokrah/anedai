import { NextResponse } from 'next/server';

import { parseEnv } from '@/lib/env';
import { getProject, updateProject } from '@/lib/store';

export const dynamic = 'force-dynamic';

const trimDir = (s?: string) =>
  s?.trim().replace(/^\/+|\/+$/g, '') || undefined;

interface ConfigBody {
  subdir?: string;
  startCmd?: string;
  docsStartCmd?: string;
  docsSubdir?: string;
  envText?: string;
}

/**
 * Resolve a `needs-config` project: record the user's app folder + start/docs
 * commands (+ optional env), then flip back to `new` so it can be (re)seeded.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as ConfigBody;

  const updated = await updateProject(slug, {
    subdir: trimDir(body.subdir),
    startCmd: body.startCmd?.trim() || undefined,
    docsStartCmd: body.docsStartCmd?.trim() || undefined,
    docsSubdir: trimDir(body.docsSubdir),
    env: body.envText?.trim()
      ? { ...manifest.env, ...parseEnv(body.envText) }
      : manifest.env,
    status: 'new',
    appCandidates: undefined,
    error: undefined,
  });

  return NextResponse.json(updated);
}

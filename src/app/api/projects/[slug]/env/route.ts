import { NextResponse } from 'next/server';

import { parseEnv, writeEnv } from '@/lib/env';
import { appDir, workDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Current env as `.env` text (for prefilling the editor). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ env: manifest.env ?? {} });
}

/**
 * Update the project's env: persist it, rewrite the sandbox `.env` (gitignored),
 * and return the manifest. The running dev server keeps its old values until it
 * restarts — the response flags that so the UI can say so.
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
  const body = (await req.json().catch(() => ({}))) as { envText?: string };
  const env = parseEnv(body.envText ?? '');

  // Drop any flagged-missing keys the user has now provided a value for.
  const stillMissing = (manifest.missingEnv ?? []).filter((k) => !env[k]);
  const updated = await updateProject(slug, {
    env,
    missingEnv: stillMissing.length ? stillMissing : undefined,
  });

  let applied = false;
  let path: string | undefined;
  try {
    const box = await connectBox(updated);
    const work = await workDir(box, updated);
    const root = await appDir(box);
    path = await writeEnv(box, work, root, env);
    applied = true;
  } catch {
    // sandbox may be down; env still persisted for the next bring-up
  }

  return NextResponse.json({ manifest: updated, applied, path });
}

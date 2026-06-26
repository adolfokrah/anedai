import { NextResponse } from 'next/server';

import { getGithubToken } from '@/lib/auth';
import { pullBase } from '@/lib/git';
import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** End the session: drop the branch so the next task names a fresh one. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    const base = manifest.baseBranch ?? 'main';
    const token = await getGithubToken(req);
    if (manifest.repoUrl && token) {
      const box = await connectBox(manifest);
      const app = await appDir(box);
      await pullBase(box, app, base, manifest.repoUrl, token);
    }
    const updated = await updateProject(slug, {
      branch: '',
      prUrl: undefined,
      prNumber: undefined,
    });
    return NextResponse.json({ ok: true, manifest: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

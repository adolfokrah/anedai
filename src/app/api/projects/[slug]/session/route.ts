import { NextResponse } from 'next/server';

import { getGithubToken } from '@/lib/auth';
import { ensureBranch, pullBase } from '@/lib/git';
import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** End the current session: branch a fresh working branch off the updated base. */
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
    const box = await connectBox(manifest);
    const app = await appDir(box);
    const base = manifest.baseBranch ?? 'main';

    const token = await getGithubToken(req);
    if (manifest.repoUrl && token)
      await pullBase(box, app, base, manifest.repoUrl, token);

    const n = (manifest.sessionN ?? 1) + 1;
    const branch = `aned/${slug}-${n}`;
    await ensureBranch(box, app, branch, base);

    const updated = await updateProject(slug, {
      branch,
      sessionN: n,
      prUrl: undefined,
      prNumber: undefined,
    });
    return NextResponse.json({ ok: true, branch, manifest: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

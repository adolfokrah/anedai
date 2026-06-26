import { NextResponse } from 'next/server';

import { getGithubToken } from '@/lib/auth';
import { pullBase } from '@/lib/git';
import { mergePullRequest, parseRepo } from '@/lib/github';
import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (!manifest.repoUrl || !manifest.prNumber) {
    return NextResponse.json(
      { ok: false, error: 'no open PR' },
      { status: 400 },
    );
  }
  const token = await getGithubToken(req);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Connect GitHub first.' },
      { status: 401 },
    );
  }

  try {
    const { owner, repo } = parseRepo(manifest.repoUrl);
    await mergePullRequest(owner, repo, manifest.prNumber, token);

    // Merged → drop the branch (next task names a fresh <project>/<task>) and
    // fast-forward the local base.
    const base = manifest.baseBranch ?? 'main';
    try {
      const box = await connectBox(manifest);
      const app = await appDir(box);
      await pullBase(box, app, base, manifest.repoUrl, token);
    } catch {
      // sandbox gone — still clear PR state below
    }
    const updated = await updateProject(slug, {
      branch: '',
      prUrl: undefined,
      prNumber: undefined,
    });
    return NextResponse.json({
      ok: true,
      url: `https://github.com/${owner}/${repo}`,
      manifest: updated,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

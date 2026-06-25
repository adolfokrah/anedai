import { NextResponse } from 'next/server';

import { getGithubToken } from '@/lib/auth';
import { ensureBranch, pullBase } from '@/lib/git';
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

    // Merged → start a fresh branch off the updated base for the next session.
    const base = manifest.baseBranch ?? 'main';
    const n = (manifest.sessionN ?? 1) + 1;
    const branch = `aned/${slug}-${n}`;
    try {
      const box = await connectBox(manifest);
      const app = await appDir(box);
      await pullBase(box, app, base, manifest.repoUrl, token);
      await ensureBranch(box, app, branch, base);
      const updated = await updateProject(slug, {
        branch,
        sessionN: n,
        prUrl: undefined,
        prNumber: undefined,
      });
      return NextResponse.json({
        ok: true,
        url: `https://github.com/${owner}/${repo}`,
        manifest: updated,
      });
    } catch {
      // Sandbox gone — still clear PR state so the UI reflects the merge.
      await updateProject(slug, { prUrl: undefined, prNumber: undefined });
      return NextResponse.json({
        ok: true,
        url: `https://github.com/${owner}/${repo}`,
      });
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

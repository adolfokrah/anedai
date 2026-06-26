import { NextResponse } from 'next/server';

import { getGithubToken } from '@/lib/auth';
import { pullBase } from '@/lib/git';
import {
  findOpenPullRequest,
  getPullRequestState,
  parseRepo,
} from '@/lib/github';
import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Reconcile PR state with GitHub. If the recorded PR was merged/closed (e.g.
 * merged directly on GitHub), drop it + the branch so the toolbar updates and
 * the next task starts fresh. Returns the (possibly updated) manifest.
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

  const token = await getGithubToken(req);
  if (!manifest.repoUrl || !token) {
    return NextResponse.json(manifest);
  }

  const { owner, repo } = parseRepo(manifest.repoUrl);

  // No PR recorded yet, but we're on a feature branch → find an OPEN PR for it
  // (it may have been opened by the agent) and adopt it so View PR / Merge show.
  if (!manifest.prNumber) {
    const base = manifest.baseBranch ?? 'main';
    if (manifest.branch && manifest.branch !== base) {
      try {
        const pr = await findOpenPullRequest(
          owner,
          repo,
          manifest.branch,
          token,
        );
        if (pr) {
          const updated = await updateProject(slug, {
            prUrl: pr.url,
            prNumber: pr.number,
          });
          return NextResponse.json(updated);
        }
      } catch {
        // best-effort
      }
    }
    return NextResponse.json(manifest);
  }

  try {
    const st = await getPullRequestState(owner, repo, manifest.prNumber, token);
    if (st.merged || st.state === 'closed') {
      try {
        const box = await connectBox(manifest);
        const app = await appDir(box);
        await pullBase(
          box,
          app,
          manifest.baseBranch ?? 'main',
          manifest.repoUrl,
          token,
        );
      } catch {
        // sandbox may be gone; still clear PR state
      }
      const updated = await updateProject(slug, {
        branch: '',
        prUrl: undefined,
        prNumber: undefined,
      });
      return NextResponse.json(updated);
    }
  } catch {
    // best-effort; return current
  }
  return NextResponse.json(manifest);
}

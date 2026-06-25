import { NextResponse } from 'next/server';

import { getGithubToken } from '@/lib/auth';
import { commitAll, push, pushHead } from '@/lib/git';
import {
  createRepo,
  getViewer,
  openPullRequest,
  parseRepo,
} from '@/lib/github';
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
  const body = (await req.json().catch(() => ({}))) as { repoName?: string };
  const base = manifest.baseBranch ?? 'main';

  const token = await getGithubToken(req);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Connect GitHub first.' },
      { status: 401 },
    );
  }

  try {
    const box = await connectBox(manifest);
    const app = await appDir(box);

    // Capture any pending work on the working branch.
    await commitAll(box, app, 'chore: sync changes');

    // First connect of a scratch project: create the repo and publish the
    // current work straight to its default branch. No PR yet — subsequent
    // tasks branch off it and open PRs automatically.
    if (!manifest.repoUrl) {
      const repoName = sanitizeRepoName(body.repoName || slug);
      let owner: string;
      let htmlUrl: string;
      try {
        ({ owner, htmlUrl } = await createRepo(repoName, token));
      } catch (e) {
        // Repo already exists (e.g. a prior attempt) → reuse it.
        if (/exist/i.test(e instanceof Error ? e.message : '')) {
          owner = await getViewer(token);
          htmlUrl = `https://github.com/${owner}/${repoName}`;
        } else throw e;
      }
      const repoUrl = `https://github.com/${owner}/${repoName}.git`;
      await pushHead(box, app, base, repoUrl, token);
      await updateProject(slug, { repoUrl, baseBranch: base });
      return NextResponse.json({ ok: true, url: htmlUrl });
    }

    // Already connected: push the working branch + open/reuse a PR vs base.
    const repoUrl = manifest.repoUrl;
    await push(box, app, manifest.branch, repoUrl, token);
    const { owner, repo } = parseRepo(repoUrl);
    const pr = await openPullRequest({
      owner,
      repo,
      head: manifest.branch,
      base,
      title: 'chore: sync changes',
      body: 'Changes generated in an Aned sandbox.',
      token,
    });
    await updateProject(slug, { prUrl: pr.url, prNumber: pr.number });
    return NextResponse.json({ ok: true, url: pr.url });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/** GitHub repo name: letters, digits, '-', '_', '.' only. */
function sanitizeRepoName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'aned-app'
  );
}

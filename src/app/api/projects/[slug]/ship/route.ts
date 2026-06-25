import { NextResponse } from 'next/server';

import {
  authedRemote,
  createRepo,
  defaultBranch,
  openPullRequest,
  parseRepo,
} from '@/lib/github';
import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const GIT_ID = '-c user.email=agent@weave.dev -c user.name=Weave';

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

  try {
    const box = await connectBox(manifest);
    const app = await appDir(box);

    // Commit any pending work (no-op if clean).
    await box.exec(
      `git ${GIT_ID} add -A && (git diff --cached --quiet || git ${GIT_ID} commit -q -m "weave: ${slug} changes")`,
      { cwd: app },
    );

    if (manifest.mode === 'repo') {
      const { owner, repo } = parseRepo(manifest.repoUrl ?? '');
      const remote = authedRemote(owner, repo);
      const push = await box.exec(
        `git push ${shellArg(remote)} HEAD:${shellArg(manifest.branch)} --force`,
        { cwd: app, timeoutMs: 120_000 },
      );
      if (push.exitCode !== 0) throw new Error(`push failed: ${push.stderr}`);

      const base = await defaultBranch(owner, repo);
      const url = await openPullRequest({
        owner,
        repo,
        head: manifest.branch,
        base,
        title: `Weave: ${manifest.name}`,
        body: 'Changes generated in a Weave sandbox.',
      });
      return NextResponse.json({ ok: true, url });
    }

    // Scratch: create a repo (named by the user) and push as its initial main.
    const repoName = sanitizeRepoName(body.repoName || slug);
    const { owner, htmlUrl } = await createRepo(repoName);
    const remote = authedRemote(owner, repoName);
    const push = await box.exec(`git push ${shellArg(remote)} HEAD:main`, {
      cwd: app,
      timeoutMs: 120_000,
    });
    if (push.exitCode !== 0) throw new Error(`push failed: ${push.stderr}`);
    return NextResponse.json({ ok: true, url: htmlUrl });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function shellArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** GitHub repo name: letters, digits, '-', '_', '.' only. */
function sanitizeRepoName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'weave-app'
  );
}

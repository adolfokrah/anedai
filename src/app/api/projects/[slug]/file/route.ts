import { NextResponse } from 'next/server';

import { appDir, workDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const shellArg = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const MAX = 400_000;

/**
 * Read a file's contents (relative to the app workdir) plus its diff vs the base
 * branch (empty if unchanged). Read-only — editing is the agent's job.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const rel = (new URL(req.url).searchParams.get('path') ?? '').replace(
    /^\/+/,
    '',
  );
  if (!rel || rel.includes('..')) {
    return NextResponse.json({ error: 'bad path' }, { status: 400 });
  }

  try {
    const box = await connectBox(manifest);
    const work = await workDir(box, manifest);
    const root = await appDir(box);
    const content = await box.readFile(`${work}/${rel}`).catch(() => '');

    // Diff vs the base branch (PR contents = committed + uncommitted on branch).
    // Path is relative to the git root, so prefix the subdir when present.
    const base = manifest.baseBranch ?? 'main';
    const gitPath = manifest.subdir ? `${manifest.subdir}/${rel}` : rel;
    const d = await box
      .exec(`git diff ${shellArg(base)} -- ${shellArg(gitPath)}`, {
        cwd: root,
        timeoutMs: 15_000,
      })
      .catch(() => ({ stdout: '' }));

    // Is this a NEW file (absent in the base branch)? Then the whole file is
    // "added" — the viewer paints every line green even with no diff.
    const exists = await box
      .exec(`git cat-file -e ${shellArg(`${base}:${gitPath}`)} 2>/dev/null`, {
        cwd: root,
        timeoutMs: 10_000,
      })
      .catch(() => ({ exitCode: 1 }));
    const added = exists.exitCode !== 0;

    return NextResponse.json({
      content: content.slice(0, MAX),
      diff: d.stdout.slice(0, MAX),
      added,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

import { NextResponse } from 'next/server';

import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const shellArg = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface ChangedFile {
  /** Path relative to the app workdir. */
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?';
  additions: number;
  deletions: number;
}

/**
 * Files the working branch changed vs the base branch (committed + uncommitted)
 * — i.e. what the PR will contain. Paths are workdir-relative; for a monorepo
 * subdir, only changes within that app are listed.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  try {
    const box = await connectBox(manifest);
    const root = await appDir(box);
    const base = manifest.baseBranch ?? 'main';
    const sub = manifest.subdir ? `${manifest.subdir}/` : '';

    const [numstat, names, porcelain] = await Promise.all([
      box
        .exec(`git diff --numstat ${shellArg(base)}`, {
          cwd: root,
          timeoutMs: 15_000,
        })
        .catch(() => ({ stdout: '' })),
      box
        .exec(`git diff --name-status ${shellArg(base)}`, {
          cwd: root,
          timeoutMs: 15_000,
        })
        .catch(() => ({ stdout: '' })),
      // Catches UNCOMMITTED work, including brand-new untracked files (`??`),
      // which `git diff <base>` never shows.
      box
        .exec('git status --porcelain', { cwd: root, timeoutMs: 15_000 })
        .catch(() => ({ stdout: '' })),
    ]);

    // path (git-root-relative) → status. Tracked-vs-base first…
    const statusOf = new Map<string, ChangedFile['status']>();
    for (const line of names.stdout.split('\n')) {
      const [code, ...rest] = line.trim().split('\t');
      if (!code || !rest.length) continue;
      const p = rest[rest.length - 1] ?? '';
      const letter = code[0] ?? '';
      statusOf.set(p, 'AMDRC'.includes(letter) ? (letter as 'A') : 'M');
    }
    // …then working-tree state (untracked → U; otherwise M/A/D/R).
    for (const raw of porcelain.stdout.split('\n')) {
      if (!raw) continue;
      const xy = raw.slice(0, 2);
      let p = raw.slice(3);
      if (p.includes(' -> ')) p = p.split(' -> ')[1] ?? p; // rename
      if (xy === '??') statusOf.set(p, 'U');
      else if (!statusOf.has(p)) {
        const l = (xy.trim()[0] ?? 'M') as string;
        statusOf.set(p, ('AMDRC'.includes(l) ? l : 'M') as 'M');
      }
    }

    const adds = new Map<string, [number, number]>();
    for (const line of numstat.stdout.split('\n')) {
      const m = line.trim().split('\t');
      if (m.length < 3 || !m[2]) continue;
      adds.set(m[2], [
        m[0] === '-' ? 0 : Number(m[0]) || 0,
        m[1] === '-' ? 0 : Number(m[1]) || 0,
      ]);
    }

    const files: ChangedFile[] = [];
    for (const [gitPath, status] of statusOf) {
      if (sub && !gitPath.startsWith(sub)) continue; // outside the app subdir
      if (/(^|\/)\.aned-/.test(gitPath)) continue; // Aned's own log files
      const [additions = 0, deletions = 0] = adds.get(gitPath) ?? [];
      files.push({
        path: sub ? gitPath.slice(sub.length) : gitPath,
        status,
        additions,
        deletions,
      });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return NextResponse.json({ base, files });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

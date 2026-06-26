import { NextResponse } from 'next/server';

import { appDir, workDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export interface Skill {
  name: string;
  description: string;
  /** 'aned' = bundled with Aned; 'repo' = found in the project's .claude/skills. */
  source: 'aned' | 'repo';
}

/** Pull `name` + `description` from a SKILL.md YAML front matter block. */
function parseSkill(md: string): { name?: string; description?: string } {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  const body = fm?.[1] ?? '';
  const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = body.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, description };
}

/** Skills available to the agent: bundled with Aned + any in the repo. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const out: Skill[] = [];

  // Only the PROJECT's own skills — Aned's built-ins are applied automatically
  // by the agent and aren't surfaced here.
  // Repo skills (sandbox): .claude/skills under the git root and the workdir.
  try {
    const box = await connectBox(manifest);
    const root = await appDir(box);
    const work = await workDir(box, manifest);
    const dirs = [
      ...new Set([`${root}/.claude/skills`, `${work}/.claude/skills`]),
    ];
    for (const dir of dirs) {
      const entries = await box.listDir(dir).catch(() => []);
      for (const e of entries) {
        if (!e.isDir) continue;
        const md = await box
          .readFile(`${dir}/${e.name}/SKILL.md`)
          .catch(() => '');
        if (!md) continue;
        const { name, description } = parseSkill(md);
        out.push({
          name: name ?? e.name,
          description: description ?? '',
          source: 'repo',
        });
      }
    }
  } catch {
    // sandbox down or no repo skills
  }

  // De-dupe by name (repo overrides bundled).
  const byName = new Map<string, Skill>();
  for (const s of out) byName.set(s.name, s);
  return NextResponse.json({ skills: [...byName.values()] });
}

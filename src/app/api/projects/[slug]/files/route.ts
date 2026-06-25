import { NextResponse } from 'next/server';

import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject } from '@/lib/store';
import type { FileNode } from '@/lib/types';

export const dynamic = 'force-dynamic';

const IGNORE = new Set(['node_modules', '.git', 'dist', '.next']);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const rel = new URL(req.url).searchParams.get('path') ?? '';

  try {
    const box = await connectBox(manifest);
    const app = await appDir(box);
    const dir = rel ? `${app}/${rel.replace(/^\/+/, '')}` : app;
    const entries = await box.listDir(dir);
    const nodes: FileNode[] = entries
      .filter((e) => !IGNORE.has(e.name))
      .map((e) => ({
        name: e.name,
        path: rel ? `${rel}/${e.name}` : e.name,
        isDir: e.isDir,
      }));
    return NextResponse.json(nodes);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

import { NextResponse } from 'next/server';

import { DS_FILE_LAYOUT } from '@/lib/design-system';
import { workDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Resolve (and persist) the design-system docs route by reading the DS manifest
 * the agent wrote in the sandbox. Backstops the chat-done read so the
 * Design-system tab finds the route even if that earlier write was missed.
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
    const work = await workDir(box, manifest);
    const raw = await box
      .readFile(`${work}/${DS_FILE_LAYOUT.manifest}`)
      .catch(() => '');
    if (!raw) return NextResponse.json({ route: null, manifest });

    // The DS manifest exists → a design system was built. Use its recorded
    // route, else the canonical default.
    let route = DS_FILE_LAYOUT.route as string;
    try {
      route = (JSON.parse(raw) as { route?: string }).route || route;
    } catch {
      // keep default
    }
    const updated =
      route === manifest.designRoute
        ? manifest
        : await updateProject(slug, { designRoute: route });
    return NextResponse.json({ route, manifest: updated });
  } catch {
    return NextResponse.json({ route: manifest.designRoute ?? null, manifest });
  }
}

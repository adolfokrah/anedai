import { NextResponse } from 'next/server';

import { connectBox } from '@/lib/session';
import { getProject } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Liveness of a ready project's sandbox. `alive` = the sandbox reconnects
 * (resuming it if idle-stopped); `server` = the dev server answers on its port.
 * The workspace uses this to decide: do nothing, restart the dev server in
 * place, or fully re-seed.
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
    const r = await box
      .exec(
        `curl -s -o /dev/null -w "%{http_code}" http://localhost:${manifest.devPort} || true`,
        { timeoutMs: 8000 },
      )
      .catch(() => ({ stdout: '', stderr: '', exitCode: 1 }));
    const server = /^[23]\d\d$/.test(r.stdout.trim());
    return NextResponse.json({ alive: true, server });
  } catch {
    return NextResponse.json({ alive: false, server: false });
  }
}

import { ensureRouteReporter } from '@/lib/route-reporter';
import { appDir } from '@/lib/seed';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Inject the dev-only route reporter into the running app so the workspace
 * address bar tracks the live page. Called by the workspace once the preview is
 * ready — decoupled from chat turns so it always runs. Idempotent + best-effort;
 * returns diagnostics for debugging delivery.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest)
    return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Always attempt (idempotent) — don't gate on the flag, so a stale flag from a
  // botched earlier run can't permanently block it.
  try {
    const box = await connectBox(manifest);
    const root = await appDir(box);
    const r = await ensureRouteReporter(box, root);
    if (r.injected || r.already)
      await updateProject(slug, { routeReporter: true });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json(
      {
        injected: false,
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 200 },
    );
  }
}

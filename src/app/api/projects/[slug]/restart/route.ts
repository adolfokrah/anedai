import { restartApp } from '@/lib/seed';
import { getProject, updateProject } from '@/lib/store';
import { ndjsonResponse } from '@/lib/stream';
import { captureThumb } from '@/lib/thumb';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

/**
 * Restart a project's dev server(s) in the existing sandbox (no reclone). Used
 * when the box is alive but the dev process died. Streams bring-up progress.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return ndjsonResponse(async (emit) => {
    try {
      await updateProject(slug, { status: 'seeding', error: undefined });
      const updated = await restartApp(manifest, emit);
      if (updated.status === 'ready')
        void captureThumb(slug, updated.previewUrl);
      emit({
        type: 'done',
        ok: updated.status === 'ready',
        manifest: updated,
        error: updated.error,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = await updateProject(slug, {
        status: 'error',
        error: message,
      });
      emit({ type: 'done', ok: false, manifest: failed, error: message });
    }
  });
}

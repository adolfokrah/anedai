import { getGithubToken } from '@/lib/auth';
import { seedProject } from '@/lib/seed';
import { getProject, updateProject } from '@/lib/store';
import { ndjsonResponse } from '@/lib/stream';
import { captureThumb } from '@/lib/thumb';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const token = (await getGithubToken(req)) ?? undefined;
  const manifest = await getProject(slug);
  if (!manifest) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  return ndjsonResponse(async (emit) => {
    try {
      console.log(`[seed] ${slug} (${manifest.mode}) start`);
      await updateProject(slug, { status: 'seeding', error: undefined });
      const updated = await seedProject(manifest, emit, token);
      console.log(`[seed] ${slug} → ${updated.status}`);
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
      console.error(`[seed] ${slug} failed:`, err);
      const failed = await updateProject(slug, {
        status: 'error',
        error: message,
      });
      emit({ type: 'done', ok: false, manifest: failed, error: message });
    }
  });
}

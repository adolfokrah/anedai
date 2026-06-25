import { type ChatImage, runProjectChat } from '@/lib/agent/run';
import type { Box } from '@/lib/runtime/types';
import { connectBox } from '@/lib/session';
import { getProject, updateProject } from '@/lib/store';
import { ndjsonResponse } from '@/lib/stream';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ChatBody {
  message: string;
  model?: string;
  images?: ChatImage[];
}

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
  const body = (await req.json().catch(() => ({}))) as ChatBody;
  if (!body.message?.trim()) {
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Bridge the request's abort signal to the agent's AbortController (Stop).
  const abortController = new AbortController();
  req.signal.addEventListener('abort', () => abortController.abort());

  return ndjsonResponse(async (emit) => {
    let box: Box;
    try {
      box = await connectBox(manifest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'done', ok: false, manifest, error: message });
      return;
    }

    const result = await runProjectChat(box, manifest, body.message, emit, {
      resume: manifest.sessionId,
      model: body.model,
      images: body.images,
      abortController,
    });

    const updated = result.sessionId
      ? await updateProject(slug, { sessionId: result.sessionId })
      : manifest;

    emit({
      type: 'done',
      ok: result.ok,
      manifest: updated,
      sessionId: result.sessionId,
      error: result.error,
    });
  });
}

import { promises as fs } from 'node:fs';

import { thumbPath } from '@/lib/thumb';

export const dynamic = 'force-dynamic';

/** Serve a project's thumbnail PNG, or 404 if none captured yet. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    const buf = await fs.readFile(thumbPath(slug));
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': 'image/png',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

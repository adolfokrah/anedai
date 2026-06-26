import { NextResponse } from 'next/server';

import { runtime } from '@/lib/runtime';
import { deleteProject, getProject } from '@/lib/store';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json(manifest);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  // Best-effort: terminate the sandbox so it doesn't linger and bill. A dead or
  // already-expired box just fails connect/destroy — ignore and purge anyway.
  if (manifest.sandboxId) {
    try {
      const box = await runtime.connect(manifest.sandboxId);
      await box.destroy();
    } catch {
      // box gone or unreachable — nothing to clean up
    }
  }
  await deleteProject(slug);
  return NextResponse.json({ ok: true });
}

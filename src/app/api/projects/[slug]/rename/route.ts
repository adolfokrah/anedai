import { NextResponse } from 'next/server';

import { getProject, updateProject } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Rename a project (display name only; the slug stays stable). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const manifest = await getProject(slug);
  if (!manifest) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  const updated = await updateProject(slug, { name: name.slice(0, 80) });
  return NextResponse.json(updated);
}

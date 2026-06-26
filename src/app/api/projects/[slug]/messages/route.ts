import { NextResponse } from 'next/server';

import { getMessages, getProject, saveMessages } from '@/lib/store';
import type { ChatTurn } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** The persisted workspace transcript. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return NextResponse.json(await getMessages(slug));
}

/** Replace the persisted transcript with the client's full turn array. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!(await getProject(slug))) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { turns?: ChatTurn[] };
  if (!Array.isArray(body.turns)) {
    return NextResponse.json({ error: 'turns required' }, { status: 400 });
  }
  await saveMessages(slug, body.turns);
  return NextResponse.json({ ok: true });
}

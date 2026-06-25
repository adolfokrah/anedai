import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Whether this browser session has a connected GitHub account. */
export async function GET(req: Request) {
  const session = await getSession(req);
  // The env GITHUB_TOKEN also counts as "able to push" for local/dev.
  const envFallback = !session && !!process.env.GITHUB_TOKEN;
  return NextResponse.json({
    connected: !!session || envFallback,
    login: session?.login ?? (envFallback ? 'token' : null),
    oauth: !!session,
  });
}

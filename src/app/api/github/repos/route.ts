import { NextResponse } from 'next/server';

import { getGithubToken } from '@/lib/auth';
import { listRepos } from '@/lib/github';

export const dynamic = 'force-dynamic';

/** The connected user's GitHub repos (for the connect-a-repo picker). */
export async function GET(req: Request) {
  const token = await getGithubToken(req);
  if (!token) {
    return NextResponse.json({ error: 'not connected' }, { status: 401 });
  }
  try {
    return NextResponse.json(await listRepos(token));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

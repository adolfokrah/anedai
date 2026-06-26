import { NextResponse } from 'next/server';

import { SESSION_COOKIE, deleteSession, getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Disconnect the current GitHub account. Beyond dropping our session, revoke the
 * OAuth GRANT on GitHub's side — otherwise the next authorize completes silently
 * with the same account (looks like a no-op refresh). Revoking forces GitHub to
 * show its authorize screen again, where a different signed-in account can be
 * used.
 */
export async function POST(req: Request) {
  const session = await getSession(req);
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (session?.token && clientId && clientSecret) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    await fetch(`https://api.github.com/applications/${clientId}/grant`, {
      method: 'DELETE',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Basic ${basic}`,
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ access_token: session.token }),
    }).catch(() => {});
  }

  await deleteSession(req);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

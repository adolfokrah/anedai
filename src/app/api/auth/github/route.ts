import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

import { STATE_COOKIE, callbackUrl } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Start the GitHub OAuth flow: set a state cookie, redirect to authorize. */
export async function GET(req: Request) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: 'GITHUB_CLIENT_ID is not set' },
      { status: 500 },
    );
  }
  const redirectUri = callbackUrl(req);
  const params = new URL(req.url).searchParams;
  const next = params.get('next') ?? '/';
  const popup = params.get('popup') === '1' ? '1' : '';
  const state = crypto.randomBytes(12).toString('hex');

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', 'repo read:user');
  authorize.searchParams.set('state', state);

  const res = NextResponse.redirect(authorize.toString());
  res.cookies.set(STATE_COOKIE, `${state}|${next}|${popup}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}

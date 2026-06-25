import { NextResponse } from 'next/server';

import {
  SESSION_COOKIE,
  STATE_COOKIE,
  appBaseUrl,
  callbackUrl,
  newSession,
  saveSession,
} from '@/lib/auth';
import { getViewer } from '@/lib/github';

export const dynamic = 'force-dynamic';

/** OAuth callback: verify state, exchange code → token, store a session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = appBaseUrl(req);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const stored = parseCookie(req.headers.get('cookie'), STATE_COOKIE);
  const [stState, next = '/', popupFlag = ''] = (stored ?? '').split('|');
  // Return to the project the user came from, even on error.
  const back = next.startsWith('/') ? next : '/';
  const popup = popupFlag === '1';

  // In popup mode, close the window + notify the opener instead of navigating.
  const closePopup = (status: string) =>
    new NextResponse(
      `<!doctype html><meta charset=utf-8><body style="background:#0a0a0a;color:#aaa;font:14px system-ui;display:grid;place-items:center;height:100vh">${status === 'connected' ? 'Connected — you can close this window.' : `GitHub error: ${status}`}<script>try{window.opener&&window.opener.postMessage('weave-github-${status === 'connected' ? 'connected' : 'error'}','*')}catch(e){}setTimeout(()=>window.close(),300)</script></body>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );

  const fail = (reason: string) =>
    popup
      ? closePopup(reason)
      : NextResponse.redirect(new URL(`${back}?github=${reason}`, base));

  if (!code || !state || !stState || state !== stState) return fail('state');

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail('config');

  const redirectUri = callbackUrl(req);

  try {
    const tokenRes = (await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      },
    ).then((r) => r.json())) as { access_token?: string; error?: string };

    const token = tokenRes.access_token;
    if (!token) return fail('token');

    const login = await getViewer(token);
    const { sid, cookieValue } = newSession();
    await saveSession(sid, { token, login });

    const res = popup
      ? closePopup('connected')
      : NextResponse.redirect(new URL(back, base));
    res.cookies.set(SESSION_COOKIE, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch {
    return fail('exchange');
  }
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

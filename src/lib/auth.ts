/**
 * Per-user GitHub auth via OAuth. A signed session cookie maps to a server-side
 * record holding the user's GitHub access token + login. github/git operations
 * use that token (falling back to GITHUB_TOKEN for local/dev).
 */

import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const SESSION_COOKIE = 'weave_gh';
export const STATE_COOKIE = 'weave_gh_state';

const DIR = path.join(process.cwd(), 'data', 'sessions');

interface SessionData {
  token: string;
  login: string;
}

function secret(): string {
  return process.env.AUTH_SECRET ?? 'dev-insecure-secret-change-me';
}

function sign(sid: string): string {
  const mac = crypto.createHmac('sha256', secret()).update(sid).digest('hex');
  return `${sid}.${mac}`;
}

/** Verify a signed cookie value → session id, or null. */
function unsign(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;
  const sid = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const exp = crypto.createHmac('sha256', secret()).update(sid).digest('hex');
  const a = Buffer.from(mac);
  const b = Buffer.from(exp);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? sid : null;
}

/** Parse a cookie header into a map. */
function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Base URL for OAuth redirects. Prefer APP_URL / the configured callback's
 * origin; else derive from the request — but force http for localhost, since
 * `next dev` has no TLS and a https://localhost redirect breaks.
 */
export function appBaseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.GITHUB_OAUTH_CALLBACK) {
    return new URL(process.env.GITHUB_OAUTH_CALLBACK).origin;
  }
  const u = new URL(req.url);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  const proto = local ? 'http' : u.protocol.replace(':', '');
  return `${proto}://${u.host}`;
}

/** The OAuth callback URL (env override or derived from the base). */
export function callbackUrl(req: Request): string {
  return (
    process.env.GITHUB_OAUTH_CALLBACK ??
    `${appBaseUrl(req)}/api/auth/github/callback`
  );
}

/** A fresh session id + the signed cookie value to set. */
export function newSession(): { sid: string; cookieValue: string } {
  const sid = crypto.randomBytes(18).toString('hex');
  return { sid, cookieValue: sign(sid) };
}

export async function saveSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(
    path.join(DIR, `${sid}.json`),
    JSON.stringify(data),
    'utf8',
  );
}

async function readSession(sid: string): Promise<SessionData | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, `${sid}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** Logged-in GitHub session for a request, or null. */
export async function getSession(req: Request): Promise<SessionData | null> {
  const cookies = parseCookies(req.headers.get('cookie'));
  const sid = unsign(cookies[SESSION_COOKIE]);
  return sid ? readSession(sid) : null;
}

/** GitHub token for this request: the user's OAuth token, else env fallback. */
export async function getGithubToken(req: Request): Promise<string | null> {
  const session = await getSession(req);
  return session?.token ?? process.env.GITHUB_TOKEN ?? null;
}

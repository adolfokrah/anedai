/** Shared helpers for the Aned tool slots (import-only; not a tool). */

const MAX_OUT = 30_000;

/** Truncate long tool output so it doesn't blow the context. */
export function clip(s: string): string {
  return s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n…[truncated]` : s;
}

export function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function shellArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Reject non-http(s) and private/loopback/metadata hosts (basic SSRF guard). */
export function blockedUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'invalid URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return 'only http(s) URLs are allowed';
  }
  const h = u.hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '169.254.169.254' ||
    h.endsWith('.local') ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    return 'that host is not allowed';
  }
  return null;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

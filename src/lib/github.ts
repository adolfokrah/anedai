/**
 * GitHub REST helpers for the ship flow. v1 auth is a personal access token
 * (`GITHUB_TOKEN`) with `repo` scope; per-user OAuth comes later.
 */

const API = 'https://api.github.com';

export function githubToken(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error('GITHUB_TOKEN is not set');
  return t;
}

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${githubToken()}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`GitHub ${res.status}: ${body.message ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Parse `owner` + `repo` from an https or ssh GitHub URL. */
export function parseRepo(url: string): { owner: string; repo: string } {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m || !m[1] || !m[2]) throw new Error(`unrecognized GitHub URL: ${url}`);
  return { owner: m[1], repo: m[2] };
}

/** Authenticated clone/push URL embedding the token. */
export function authedRemote(owner: string, repo: string): string {
  return `https://x-access-token:${githubToken()}@github.com/${owner}/${repo}.git`;
}

export async function defaultBranch(
  owner: string,
  repo: string,
): Promise<string> {
  const r = await gh<{ default_branch: string }>(`/repos/${owner}/${repo}`);
  return r.default_branch;
}

export async function openPullRequest(opts: {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body?: string;
}): Promise<string> {
  const r = await gh<{ html_url: string }>(
    `/repos/${opts.owner}/${opts.repo}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: opts.title,
        head: opts.head,
        base: opts.base,
        body: opts.body ?? '',
      }),
    },
  );
  return r.html_url;
}

/** Create a new repo under the authenticated user; returns owner + html_url. */
export async function createRepo(
  name: string,
): Promise<{ owner: string; htmlUrl: string }> {
  const r = await gh<{ html_url: string; owner: { login: string } }>(
    '/user/repos',
    {
      method: 'POST',
      body: JSON.stringify({ name, private: true, auto_init: false }),
    },
  );
  return { owner: r.owner.login, htmlUrl: r.html_url };
}

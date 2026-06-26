/**
 * GitHub REST helpers for the ship flow. Every call takes an explicit access
 * token — the logged-in user's OAuth token (per-user), or the GITHUB_TOKEN
 * fallback for local/dev. Resolve it with `getGithubToken(req)` in auth.ts.
 */

const API = 'https://api.github.com';

async function gh<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
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
export function authedRemote(
  owner: string,
  repo: string,
  token: string,
): string {
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

/** The authenticated user's login (for showing "connected as …"). */
export async function getViewer(token: string): Promise<string> {
  const r = await gh<{ login: string }>('/user', token);
  return r.login;
}

/** The user's repos (most recently pushed first), for the connect-a-repo picker. */
export async function listRepos(
  token: string,
): Promise<{ fullName: string; cloneUrl: string; private: boolean }[]> {
  const r = await gh<
    { full_name: string; clone_url: string; private: boolean }[]
  >(
    '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
    token,
  );
  return r.map((x) => ({
    fullName: x.full_name,
    cloneUrl: x.clone_url,
    private: x.private,
  }));
}

export async function defaultBranch(
  owner: string,
  repo: string,
  token: string,
): Promise<string> {
  const r = await gh<{ default_branch: string }>(
    `/repos/${owner}/${repo}`,
    token,
  );
  return r.default_branch;
}

/**
 * Open a PR, or return the existing one for the same head→base (GitHub 422s on
 * a duplicate). Returns its url + number.
 */
export async function openPullRequest(opts: {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body?: string;
  token: string;
}): Promise<{ url: string; number: number }> {
  try {
    const r = await gh<{ html_url: string; number: number }>(
      `/repos/${opts.owner}/${opts.repo}/pulls`,
      opts.token,
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
    return { url: r.html_url, number: r.number };
  } catch (e) {
    const existing = await gh<{ html_url: string; number: number }[]>(
      `/repos/${opts.owner}/${opts.repo}/pulls?head=${opts.owner}:${encodeURIComponent(opts.head)}&state=open`,
      opts.token,
    ).catch(() => []);
    if (existing[0])
      return { url: existing[0].html_url, number: existing[0].number };
    throw e;
  }
}

/** Find the open PR for a head branch, if any (agent may have opened it). */
export async function findOpenPullRequest(
  owner: string,
  repo: string,
  head: string,
  token: string,
): Promise<{ url: string; number: number } | null> {
  const list = await gh<{ html_url: string; number: number }[]>(
    `/repos/${owner}/${repo}/pulls?head=${owner}:${encodeURIComponent(head)}&state=open`,
    token,
  ).catch(() => []);
  return list[0] ? { url: list[0].html_url, number: list[0].number } : null;
}

/** Current state of a PR: whether it's open/closed and whether it merged. */
export async function getPullRequestState(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<{ state: 'open' | 'closed'; merged: boolean }> {
  const r = await gh<{ state: 'open' | 'closed'; merged: boolean }>(
    `/repos/${owner}/${repo}/pulls/${number}`,
    token,
  );
  return { state: r.state, merged: r.merged };
}

/** Merge a PR (squash by default). */
export async function mergePullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
  method: 'squash' | 'merge' | 'rebase' = 'squash',
): Promise<void> {
  await gh(`/repos/${owner}/${repo}/pulls/${number}/merge`, token, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: method }),
  });
}

/** Create a new repo under the authenticated user; returns owner + html_url. */
export async function createRepo(
  name: string,
  token: string,
): Promise<{ owner: string; htmlUrl: string }> {
  const r = await gh<{ html_url: string; owner: { login: string } }>(
    '/user/repos',
    token,
    {
      method: 'POST',
      body: JSON.stringify({ name, private: true, auto_init: false }),
    },
  );
  return { owner: r.owner.login, htmlUrl: r.html_url };
}

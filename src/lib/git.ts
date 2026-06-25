/**
 * Deterministic git lifecycle over a sandbox Box. Aned owns version control —
 * the coding agent never runs git itself. All ops run in the app dir with a
 * fixed Aned identity. Pushes use a token-authed remote (never the stored
 * origin, which may lack credentials).
 */

import { authedRemote, parseRepo } from '@/lib/github';
import type { Box } from '@/lib/runtime/types';

/** Committer identity for Aned's automated commits. */
export const GIT_ID = '-c user.email=agent@aned.dev -c user.name=Aned';

function sh(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Detect the repo's default branch (main/master), falling back to 'main'. */
export async function detectDefaultBranch(
  box: Box,
  app: string,
): Promise<string> {
  const r = await box
    .exec(
      "git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@'",
      { cwd: app },
    )
    .catch(() => ({ stdout: '', stderr: '', exitCode: 1 }));
  const name = r.stdout.trim();
  if (name) return name;
  // No remote HEAD (e.g. fresh scratch): use the current branch or 'main'.
  const cur = await box
    .exec('git branch --show-current', { cwd: app })
    .catch(() => ({ stdout: '', stderr: '', exitCode: 1 }));
  return cur.stdout.trim() || 'main';
}

/** Create `branch` off `base` if it doesn't exist, then check it out. */
export async function ensureBranch(
  box: Box,
  app: string,
  branch: string,
  base: string,
): Promise<void> {
  const exists = await box
    .exec(`git rev-parse --verify --quiet ${sh(branch)}`, { cwd: app })
    .then((r) => r.exitCode === 0)
    .catch(() => false);
  if (exists) {
    await box.exec(`git checkout ${sh(branch)}`, { cwd: app });
  } else {
    await box.exec(`git checkout -b ${sh(branch)} ${sh(base)}`, { cwd: app });
  }
}

/** Stage everything and commit if the tree is dirty. Returns true if committed. */
export async function commitAll(
  box: Box,
  app: string,
  message: string,
): Promise<boolean> {
  const r = await box.exec(
    `git ${GIT_ID} add -A && (git diff --cached --quiet && echo CLEAN || (git ${GIT_ID} commit -q -m ${sh(message)} && echo COMMITTED))`,
    { cwd: app, timeoutMs: 60_000 },
  );
  return r.stdout.includes('COMMITTED');
}

/** Push a named local branch to the token-authed remote derived from repoUrl. */
export async function push(
  box: Box,
  app: string,
  branch: string,
  repoUrl: string,
  token: string,
): Promise<void> {
  const { owner, repo } = parseRepo(repoUrl);
  const remote = authedRemote(owner, repo, token);
  const r = await box.exec(
    `git push ${sh(remote)} ${sh(branch)}:${sh(branch)} --force`,
    { cwd: app, timeoutMs: 120_000 },
  );
  if (r.exitCode !== 0) throw new Error(`push failed: ${r.stderr || r.stdout}`);
}

/** Push the current HEAD to a remote branch name (e.g. seed a new repo's main). */
export async function pushHead(
  box: Box,
  app: string,
  remoteBranch: string,
  repoUrl: string,
  token: string,
): Promise<void> {
  const { owner, repo } = parseRepo(repoUrl);
  const remote = authedRemote(owner, repo, token);
  const r = await box.exec(
    `git push ${sh(remote)} HEAD:${sh(remoteBranch)} --force`,
    { cwd: app, timeoutMs: 120_000 },
  );
  if (r.exitCode !== 0) throw new Error(`push failed: ${r.stderr || r.stdout}`);
}

/** Fast-forward the local base branch from the remote (best-effort). */
export async function pullBase(
  box: Box,
  app: string,
  base: string,
  repoUrl: string,
  token: string,
): Promise<void> {
  const { owner, repo } = parseRepo(repoUrl);
  const remote = authedRemote(owner, repo, token);
  await box
    .exec(
      `git checkout ${sh(base)} && git pull --ff-only ${sh(remote)} ${sh(base)}`,
      { cwd: app, timeoutMs: 120_000 },
    )
    .catch(() => {});
}

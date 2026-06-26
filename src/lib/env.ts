/**
 * User-supplied environment variables for a connected project. Parsed from
 * pasted `.env` text, written into the app's `.env` inside the sandbox before
 * bring-up, and injected into the dev server's process env. The file is always
 * gitignored so the agent never commits secrets into a PR.
 */

import type { Box } from '@/lib/runtime/types';

/** Parse `.env` text → a map. Ignores comments/blanks; strips quotes + `export`. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Serialize a map back to `.env` text (quoting values that need it). */
export function serializeEnv(env: Record<string, string>): string {
  return `${Object.entries(env)
    .map(([k, v]) => `${k}=${/[\s#'"]/.test(v) ? JSON.stringify(v) : v}`)
    .join('\n')}\n`;
}

/** Whether a `.gitignore` already excludes `.env`. */
function ignoresEnv(gitignore: string): boolean {
  return gitignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l === '.env' || l === '.env*' || l === '.env.*');
}

/**
 * Write the app's `.env` (in the workdir) and make sure the repo's `.gitignore`
 * (at the git root) excludes env files — so the agent's `git add -A` can never
 * commit secrets.
 */
export async function writeEnv(
  box: Box,
  workdir: string,
  gitRoot: string,
  env: Record<string, string>,
): Promise<string> {
  const target = `${workdir}/.env`;
  await box.writeFile(target, serializeEnv(env));

  const gi = await box.readFile(`${gitRoot}/.gitignore`).catch(() => '');
  if (!ignoresEnv(gi)) {
    const block = `${gi.trimEnd()}\n\n# Aned: local env (do not commit)\n.env\n.env.*\n!.env.example\n`;
    await box.writeFile(`${gitRoot}/.gitignore`, block.trimStart());
  }
  return target;
}

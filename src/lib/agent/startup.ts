/**
 * Agent-driven bring-up for connected repos. Instead of Aned guessing the
 * install/dev command (brittle), the agent detects the package manager, installs,
 * starts the dev server via the `start_app` tool, and diagnoses/fixes startup
 * failures (flags, env, missing services) until it serves. Returns the port.
 *
 * No import from `@/lib/seed` (would cycle) — the caller passes `app`.
 */

import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

import type { Box } from '@/lib/runtime/types';
import type { AgentEvent } from '@/lib/types';

import { resolveProvider } from './provider';
import { sandboxTools } from './tools';

const BUILTINS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Glob', 'Grep'];

const DEFAULT_PORT = 3000;

interface StartupOpts {
  /** The workdir already IS the app (a chosen subdir); don't hunt for it. */
  hasSubdir?: boolean;
  /** A start command the user pinned — use it (only fix host/port flags). */
  startCmd?: string;
  /** Target port (default 3000; e.g. 6006 for a docs/Storybook server). */
  port?: number;
  /** 'docs' = a component explorer / docs server (e.g. Storybook), not the app. */
  kind?: 'app' | 'docs';
  /** Log file start_app writes to (default .aned-dev.log; .aned-docs.log for docs). */
  logFile?: string;
  /** Env injected into install/build/start (user-supplied secrets etc.). */
  env?: Record<string, string>;
}

function prompt(port: number, opts: StartupOpts): string {
  const { hasSubdir, startCmd, kind } = opts;
  const docs = kind === 'docs';
  const what = docs
    ? 'a DOCS / component-explorer server (e.g. Storybook) for an existing repo'
    : 'an EXISTING app';
  const location = hasSubdir
    ? `Your working directory IS the target ${docs ? 'docs package' : 'app'}. Run install + start_app HERE — do NOT search the repo for another app or cd elsewhere.`
    : docs
      ? 'Your working directory is the repo root. Locate where the docs/Storybook server is configured (a `.storybook/` dir or a docs workspace) and cd there if needed.'
      : `Your working directory is the repo root. If this is a MONOREPO (root package.json has "workspaces", or there's pnpm-workspace.yaml / turbo.json / nx.json and no runnable dev script here), locate the primary runnable WEB app (a workspace whose package.json has a dev script for Next/Vite/etc.) and cd into it for install + start_app. If it's a single app, work here.`;
  const cmdLine = startCmd
    ? `\nSTART COMMAND (use THIS — only adjust it to bind host 0.0.0.0; KEEP its port): \`${startCmd}\`\n`
    : '';
  const log = opts.logFile ?? '.aned-dev.log';
  const startStep = docs
    ? `Start it with the **start_app** tool on port ${port}, bound to 0.0.0.0 (Storybook → \`storybook dev -p ${port} -h 0.0.0.0\`, run the binary directly e.g. \`npx storybook dev ...\`). Do NOT use run_cmd with \`&\`.`
    : `Start the dev server with the **start_app** tool. Use the app's OWN port — do NOT override it. Find the port from the dev script / framework config (vite.config server.port, next.config) / \`PORT\` env, else the framework default (Vite 5173, Next 3000, Astro 4321, CRA 3000). Only add the HOST flag to bind 0.0.0.0, WITHOUT changing the port: Next → \`next dev -H 0.0.0.0\`, Vite → \`vite --host 0.0.0.0\` (run the binary directly, e.g. \`npx vite --host 0.0.0.0\`, NOT \`npm run dev -- ...\` which mis-forwards flags). Pass the ACTUAL port the server prints to start_app — Aned builds the preview from exactly that port, so it must match. Do NOT use run_cmd with \`&\` — only start_app keeps it alive.`;
  const goal = docs
    ? `get it serving HTTP on port ${port}, bound to 0.0.0.0`
    : "get it serving HTTP on the app's OWN port (do not force a port), bound to 0.0.0.0";
  return `You are bringing up ${what} inside a sandbox so its server runs. Use ONLY the sandbox tools (read_file, list_dir, grep, run_cmd, start_app, web_fetch).

GOAL: ${goal}.

LOCATION: ${location}
${cmdLine}
Process:
1. Inspect package.json (scripts, engines, packageManager) + any lockfile to find the package manager and the right script. Read README/.env.example for required setup. In a monorepo, install at the workspace root if the package manager requires it (pnpm/yarn workspaces).
2. ENV & SECRETS — resolve BEFORE starting (don't change app features; never print secret values):
   a. Check for env files: .env, .env.local, .env.example/.env.sample. If a .env already exists (Aned may have written one from user values), KEEP it — never overwrite existing values, only ADD vars still missing. NEVER use a TEST/FIXTURE env file (test.env, .env.test, .env.ci, .env.example placeholders) as real runtime config — those hold fake CI values; do not copy them to .env or point the app at them. IMPORTANT: Aned writes the user's .env at the location it knows; if the runnable app is in a SUBDIRECTORY (monorepo) and a .env exists at the repo root but NOT in the app dir, COPY it into the app dir (\`cp <root>/.env <appdir>/.env\`) so the framework loads it. Same for the docs/storybook app dir if separate.
   b. Detect a SECRETS MANAGER from config + package.json scripts: Infisical (\`.infisical.json\`, \`infisical run\`), Doppler (\`doppler.yaml\`/\`.doppler.yaml\`, \`doppler run\`), dotenv-vault (\`.env.vault\`), SOPS (\`.sops.yaml\`), 1Password (\`op run\`), Vercel (\`vercel.json\`, \`vercel env pull\`). If you detect one, emit EXACTLY \`ANED_SECRETS_MANAGER: <name>\` in your report — name is one of: doppler, infisical, vercel, dotenv-vault, sops, 1password.
   c. If a manager IS configured: install its CLI (Doppler: \`curl -Ls https://cli.doppler.com/install.sh | sh\`; Infisical: \`npm i -g @infisical/cli\`; Vercel: \`npm i -g vercel\`). It needs a TOKEN to authenticate non-interactively (DOPPLER_TOKEN, INFISICAL_TOKEN, VERCEL_TOKEN, …). If the token IS in the environment, USE it: either pull secrets into a .env (\`doppler secrets download --no-file --format env > .env\`, \`infisical export > .env\`, \`vercel env pull .env\`) OR run the dev server THROUGH the manager (start command becomes e.g. \`doppler run -- <dev>\`). If the token is NOT set, you can't pull — emit \`ANED_MISSING_ENV: <TOKEN_NAME>\` and continue best-effort.
   d. If NO manager: when .env is absent but .env.example exists, copy it to .env and fill safe LOCAL defaults (DB URLs, ports, dev flags); leave real secrets you can't default blank.
   e. For any REQUIRED secret still unset (a manager token, or a blank key from d), emit EXACTLY \`ANED_MISSING_ENV: KEY_ONE, KEY_TWO\` (comma-separated names) in your final report — even if the server came up partly without them. This is how Aned prompts the user.
3. Install dependencies with run_cmd (pnpm/yarn/npm; if pnpm/yarn aren't on PATH, run them via \`npx --yes <pm>@<version>\` matching engines). Skip if deps are already installed. LARGE MONOREPO (the sandbox has limited disk + RAM — a full workspace install can ENOSPC or get OOM-\`Killed\`): install ONLY the target app's workspace, not everything. With pnpm: \`pnpm install --filter <appPkgName>...\` (the trailing \`...\` includes its workspace deps) — or \`--filter ./<subdir>...\`. This pulls a fraction of the tree. If install is Killed/ENOSPC, free space (\`rm -rf\` stray node_modules, \`pnpm store prune\`) and retry scoped; report it if it still won't fit (the project may need a bigger sandbox). PNPM ON THIS SANDBOX: the filesystem is an overlay with no reflink, so pnpm's default copy (and any \`.npmrc\` \`package-import-method=copy\`) DUPLICATES the store into node_modules and fills the small disk → \`ENOSPC: no space left on device\`. BEFORE installing with pnpm, force hardlinks: prepend \`npm_config_package_import_method=hardlink\` to the install command (or \`pnpm config set package-import-method hardlink\`); if a partial install already failed, \`rm -rf node_modules\` first. Respect the repo's own install flags (e.g. \`--ignore-workspace\` when its scripts use it).
4. ${startStep} If a secrets manager owns env, wrap the dev command through it (e.g. \`doppler run -- <dev>\`).
5. Verify: run_cmd \`curl -s -o /dev/null -w "%{http_code}" http://localhost:<PORT>\` where <PORT> is ${docs ? `${port}` : 'the port the server actually started on (from its startup log)'}. If it doesn't return 2xx/3xx, tail \`${log}\` (run_cmd \`tail -n 50 ${log}\`), DIAGNOSE the failure, FIX it, and start_app again. Repeat until it serves.
   - Wrong CLI flags → fix the command.
   - Missing env → see step 2 (default what's safe; emit ANED_MISSING_ENV for real secrets).
   - A required service (e.g. MongoDB/Postgres) → install + start it locally (e.g. \`apt-get\`/\`mongod\`) and point the app at it.
   - Native build issues (e.g. sharp) → install build deps / approve builds.
   - A missing build tool / loader (sass/less, a postcss or webpack plugin) or a package that "isn't installed" → INSTALL it (e.g. \`pnpm add -D sass\`). In a MONOREPO a dep often appears missing because it's hoisted from the workspace root and a single-package install (e.g. \`--ignore-workspace\`) skipped it — reinstall at the workspace root so hoisted deps resolve. NEVER rewrite the app's own source/styles (e.g. converting .scss→.css, deleting an import) to dodge a missing dependency — that changes the app; fix the INSTALL instead.
6. Do NOT change features — only what's needed to run it. GUIDING RULE: this app already works on the developer's machine, so a failure HERE is almost always an ENVIRONMENT difference — a missing dependency/build tool, wrong install scope (monorepo hoisting), an unprovisioned service, or missing env — NOT a bug in the app's code. Fix the environment (install/provision/configure); do NOT edit application source, styles, configs, or imports to work around it. When it serves, stop and report briefly (state the port it's on).`;
}

type Emit = (e: AgentEvent) => void;

export interface StartupResult {
  /** Port the server was started on. */
  port: number;
  /** Required env var names the agent flagged as unset (for the user to supply). */
  missingEnv: string[];
  /** Detected secrets manager (doppler/infisical/vercel/…), if any. */
  secretsManager?: string;
}

/** Run the bring-up agent turn; returns the port + any missing required env. */
export async function runStartup(
  box: Box,
  app: string,
  emit: Emit,
  opts: StartupOpts = {},
): Promise<StartupResult> {
  const targetPort = opts.port ?? DEFAULT_PORT;
  let port = targetPort;
  const { server, allowedTools } = sandboxTools(box, app, {
    includeStartApp: true,
    logFile: opts.logFile,
    env: opts.env,
    onStartApp: (p) => {
      port = p || targetPort;
    },
  });

  const guard: CanUseTool = async (toolName, input) => {
    if (toolName.startsWith('mcp__sandbox__')) {
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: 'Use the sandbox tools only.' };
  };

  const provider = resolveProvider();

  const run = query({
    prompt: prompt(targetPort, opts),
    options: {
      mcpServers: { sandbox: server },
      allowedTools,
      disallowedTools: BUILTINS,
      canUseTool: guard,
      maxTurns: 40,
      ...(provider.env ? { env: provider.env } : {}),
      ...(provider.model ? { model: provider.model } : {}),
    },
  });

  const missingEnv = new Set<string>();
  let secretsManager: string | undefined;
  try {
    for await (const msg of run) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            for (const k of parseMissingEnv(block.text)) missingEnv.add(k);
            secretsManager = parseManager(block.text) ?? secretsManager;
            emit({ type: 'log', line: block.text.trim().slice(0, 200) });
          } else if (block.type === 'tool_use') {
            const t = block.name.replace('mcp__sandbox__', '');
            const target = toolTarget(block.input);
            emit({ type: 'log', line: target ? `${t}: ${target}` : t });
          }
        }
      } else if (msg.type === 'result') {
        break;
      }
    }
  } catch (err) {
    emit({
      type: 'log',
      line: `bring-up error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return { port, missingEnv: [...missingEnv], secretsManager };
}

/** Pull env var names from an `ANED_MISSING_ENV: A, B` sentinel line. */
function parseMissingEnv(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/ANED_MISSING_ENV:\s*([^\n]+)/g)) {
    for (const part of (m[1] ?? '').split(',')) {
      const key = part.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out.push(key);
    }
  }
  return out;
}

/** Pull the secrets-manager name from an `ANED_SECRETS_MANAGER: x` line. */
function parseManager(text: string): string | undefined {
  const m = text.match(/ANED_SECRETS_MANAGER:\s*([a-z0-9-]+)/i);
  return m?.[1]?.toLowerCase();
}

function toolTarget(input: unknown): string | undefined {
  if (typeof input !== 'object' || !input) return undefined;
  const o = input as Record<string, unknown>;
  const v = o.cmd ?? o.command ?? o.path ?? o.pattern;
  return v ? String(v).slice(0, 120) : undefined;
}

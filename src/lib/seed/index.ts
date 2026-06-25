/**
 * Seed a project's sandbox: boot the box, scaffold (scratch) or clone (repo),
 * create the working branch, install deps, start the dev server, and wait until
 * the preview is live. Emits step/log events for the UI's seed progress view.
 *
 * The two entry modes diverge only here; everything after seed (agent edits,
 * preview, ship) is identical.
 */

import { runtime } from '@/lib/runtime';
import type { Box } from '@/lib/runtime/types';
import { saveProject } from '@/lib/store';
import type { AgentEvent, ProjectManifest } from '@/lib/types';

import { SCRATCH_DEV_PORT, SCRATCH_TEMPLATE } from './template';

const GIT_ID = '-c user.email=agent@weave.dev -c user.name=Weave';

type Emit = (e: AgentEvent) => void;

/** The app's working directory inside the sandbox (under the writable home). */
export async function appDir(box: Box): Promise<string> {
  return `${await box.homeDir()}/app`;
}

const devLog = (app: string) => `${app}/.weave-dev.log`;

/** Detect package manager + dev command + port for a cloned repo. */
async function detectRepo(
  box: Box,
  app: string,
): Promise<{ install: string; dev: string; port: number }> {
  let pkg: {
    dependencies?: Record<string, string>;
    packageManager?: string;
    engines?: { pnpm?: string; node?: string };
  } = {};
  try {
    pkg = JSON.parse(await box.readFile(`${app}/package.json`));
  } catch {
    // no package.json — fall back to a static server attempt
  }
  const hasNext = 'next' in { ...pkg.dependencies };
  const port = hasNext ? 3000 : SCRATCH_DEV_PORT;

  // Package manager from lockfile.
  const lock = await box
    .exec('ls pnpm-lock.yaml yarn.lock package-lock.json 2>/dev/null', {
      cwd: app,
    })
    .then((r) => r.stdout)
    .catch(() => '');
  const runner = lock.includes('pnpm-lock')
    ? 'pnpm'
    : lock.includes('yarn.lock')
      ? 'yarn'
      : 'npm';

  // The sandbox ships node + npm but not pnpm/yarn on PATH. Launch those via
  // `npx --yes <pm>@<version>` (no global install, no permissions needed) —
  // pinning the version the repo expects, since `npx pnpm` would otherwise grab
  // the latest (e.g. 11) and trip engines.pnpm "^9 || ^10". npm runs directly.
  const spec = runner === 'pnpm' ? `pnpm@${pnpmMajor(pkg)}` : runner;
  const launch = runner === 'npm' ? 'npm' : `npx --yes ${spec}`;
  const install = `${launch} install`;
  const runDev = runner === 'npm' ? 'npm run dev' : `${launch} dev`;

  // Bind to 0.0.0.0 so the port is reachable through the sandbox proxy.
  const dev = hasNext
    ? `${runDev} -- -H 0.0.0.0 -p ${port}`
    : `${runDev} -- --host 0.0.0.0 --port ${port}`;
  return { install, dev, port };
}

/**
 * Start the dev server detached (logging to a file), then poll until it answers
 * — streaming the dev log so compile output and crashes are visible. Returns
 * false (with the log tail emitted) if it never comes up.
 */
async function startDevAndWait(
  box: Box,
  app: string,
  dev: string,
  port: number,
  emit: Emit,
): Promise<boolean> {
  const log = devLog(app);
  await box.exec(`: > ${log}`, { cwd: app }).catch(() => {});
  // Hand the dev command (with its log redirect) to the runtime's background
  // mode so the server outlives this call. Logs land in the dev log file.
  await box.exec(`${dev} > ${log} 2>&1`, { cwd: app, background: true });

  let shown = 0;
  for (let i = 0; i < 60; i++) {
    const text = await box.readFile(log).catch(() => '');
    const lines = text.split('\n');
    for (const line of lines.slice(shown)) {
      if (line.trim()) emit({ type: 'log', line });
    }
    shown = lines.length;

    const r = await box
      .exec(
        `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port} || true`,
        { timeoutMs: 8000 },
      )
      .catch(() => ({ stdout: '', stderr: '', exitCode: 1 }));
    if (/^[23]\d\d$/.test(r.stdout.trim())) return true;
    await sleep(1500);
  }

  emit({ type: 'log', line: `dev server did not respond on :${port}` });
  return false;
}

export async function seedProject(
  manifest: ProjectManifest,
  emit: Emit,
): Promise<ProjectManifest> {
  emit({ type: 'step', label: 'Booting sandbox', status: 'active' });
  const box = await runtime.create();
  const home = await box.homeDir();
  const app = `${home}/app`;
  emit({ type: 'step', label: 'Booting sandbox', status: 'done' });

  // 1. Seed source.
  if (manifest.mode === 'repo') {
    emit({ type: 'step', label: 'Cloning repo', status: 'active' });
    const cloneUrl = cloneUrlFor(manifest.repoUrl ?? '');
    const clone = await box.execStream(
      `git clone --depth 1 ${shellArg(cloneUrl)} app`,
      (line) => emit({ type: 'log', line }),
      // GIT_TERMINAL_PROMPT=0 → fail fast on auth instead of hanging on a
      // username prompt (no tty in the sandbox) until the timeout aborts.
      { cwd: home, timeoutMs: 180_000, env: { GIT_TERMINAL_PROMPT: '0' } },
    );
    if (clone.exitCode !== 0) {
      const out = `${clone.stdout}\n${clone.stderr}`.trim();
      const authy = /authentication|denied|not found|could not read/i.test(out);
      throw new Error(
        `git clone failed (exit ${clone.exitCode}).${authy ? ' For a private repo, set GITHUB_TOKEN in .env.' : ''}\n${out}`,
      );
    }
    await box.exec(`git ${GIT_ID} checkout -b ${shellArg(manifest.branch)}`, {
      cwd: app,
    });
    emit({ type: 'step', label: 'Cloning repo', status: 'done' });
  } else {
    emit({ type: 'step', label: 'Scaffolding app', status: 'active' });
    await box.exec(`mkdir -p ${app}`);
    for (const [rel, content] of Object.entries(SCRATCH_TEMPLATE)) {
      await box.writeFile(`${app}/${rel}`, content);
    }
    await box.exec(
      `git init -q && git ${GIT_ID} add -A && git ${GIT_ID} commit -q -m "scaffold" && git branch -M ${shellArg(manifest.branch)}`,
      { cwd: app },
    );
    emit({ type: 'step', label: 'Scaffolding app', status: 'done' });
  }

  // 2. Install + detect dev command.
  const { install, dev, port } =
    manifest.mode === 'repo'
      ? await detectRepo(box, app)
      : { install: 'npm install', dev: 'npm run dev', port: SCRATCH_DEV_PORT };

  emit({ type: 'step', label: 'Installing dependencies', status: 'active' });
  const inst = await box.execStream(
    install,
    (line) => emit({ type: 'log', line }),
    { cwd: app, timeoutMs: 600_000 },
  );
  if (inst.exitCode !== 0)
    throw new Error(`dependency install failed (exit ${inst.exitCode})`);
  emit({ type: 'step', label: 'Installing dependencies', status: 'done' });

  // 3. Start dev server (detached) + wait for it.
  emit({ type: 'step', label: 'Starting dev server', status: 'active' });
  const up = await startDevAndWait(box, app, dev, port, emit);
  emit({
    type: 'step',
    label: 'Starting dev server',
    status: up ? 'done' : 'error',
  });

  const tail = up
    ? ''
    : (await box.readFile(devLog(app)).catch(() => ''))
        .split('\n')
        .slice(-25)
        .join('\n')
        .trim();

  // 4. Persist.
  const updated: ProjectManifest = {
    ...manifest,
    sandboxId: box.id,
    devPort: port,
    previewUrl: await box.previewUrl(port),
    status: up ? 'ready' : 'error',
    error: up
      ? undefined
      : `dev server didn't start on :${port}.\n${tail || 'no output'}`,
  };
  await saveProject(updated);
  return updated;
}

/**
 * Embed GITHUB_TOKEN into a GitHub https URL so private repos clone without an
 * interactive credential prompt. Non-GitHub or token-less URLs pass through.
 */
function cloneUrlFor(url: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return url;
  const m = url.match(/^https:\/\/github\.com\/(.+)$/);
  return m ? `https://x-access-token:${token}@github.com/${m[1]}` : url;
}

/**
 * Pick a pnpm version the repo accepts. Prefer the exact `packageManager`
 * pin; else the highest major named in `engines.pnpm`; else a safe modern
 * default. Returned as a version/tag for `pnpm@<x>`.
 */
function pnpmMajor(pkg: {
  packageManager?: string;
  engines?: { pnpm?: string };
}): string {
  const pm = pkg.packageManager;
  if (pm?.startsWith('pnpm@'))
    return pm.slice('pnpm@'.length).split('+')[0] ?? '10';
  const eng = pkg.engines?.pnpm;
  if (eng) {
    const majors = [...eng.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
    if (majors.length) return String(Math.max(...majors));
  }
  return '10';
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Shell-escape a single argument. */
function shellArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

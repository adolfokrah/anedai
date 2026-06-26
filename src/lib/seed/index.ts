/**
 * Boot a project's sandbox. SCRATCH: scaffold our template + install + start dev
 * (deterministic, instant). REPO: box only — the chat agent clones the repo and
 * brings it up conversationally (see the workspace's first auto turn).
 * `restartApp` re-runs bring-up in place for recovery.
 */

import { runStartup } from '@/lib/agent/startup';
import { writeEnv } from '@/lib/env';
import { detectDefaultBranch } from '@/lib/git';
import { runtime } from '@/lib/runtime';
import type { Box } from '@/lib/runtime/types';
import { connectBox } from '@/lib/session';
import { saveProject } from '@/lib/store';
import type { AgentEvent, ProjectManifest } from '@/lib/types';

import { scaffold } from './template';

const GIT_ID = '-c user.email=agent@aned.dev -c user.name=Aned';

type Emit = (e: AgentEvent) => void;

/**
 * The repo/git root inside the sandbox (clone/scaffold target). Git operations
 * (branch, commit, push, pull) always run here, even for monorepos.
 */
export async function appDir(box: Box): Promise<string> {
  return `${await box.homeDir()}/app`;
}

/**
 * The app's working directory — the repo root, or a subdirectory of it for a
 * monorepo (`manifest.subdir`). Everything app-scoped (bring-up, file tree,
 * design system, the chat agent's cwd) uses this; git still uses {@link appDir}.
 */
export async function workDir(
  box: Box,
  manifest: { subdir?: string },
): Promise<string> {
  const root = await appDir(box);
  const sub = manifest.subdir?.replace(/^\/+|\/+$/g, '');
  return sub ? `${root}/${sub}` : root;
}

const devLog = (app: string) => `${app}/.aned-dev.log`;

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
  env?: Record<string, string>,
): Promise<boolean> {
  const log = devLog(app);
  await box.exec(`: > ${log}`, { cwd: app }).catch(() => {});
  // Hand the dev command (with its log redirect) to the runtime's background
  // mode so the server outlives this call. Logs land in the dev log file.
  await box.exec(`${dev} > ${log} 2>&1`, { cwd: app, background: true, env });

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

/** Poll until the dev server (already started, e.g. by the agent) answers. */
async function waitForDev(
  box: Box,
  port: number,
  emit: Emit,
): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
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
  token?: string,
): Promise<ProjectManifest> {
  emit({ type: 'step', label: 'Booting sandbox', status: 'active' });
  const box = await runtime.create();
  const home = await box.homeDir();
  const app = `${home}/app`;
  // Persist the sandbox id IMMEDIATELY — if a later step throws, the manifest
  // still points at this box so Retry reconnects + re-runs bring-up (the agent
  // fixes it) instead of orphaning it and creating a new one.
  await saveProject({ ...manifest, sandboxId: box.id, status: 'seeding' });
  emit({ type: 'step', label: 'Booting sandbox', status: 'done' });

  // REPO: Aned does the one-time CLONE (token-authed, big-repo friendly), sets
  // the committer identity, then HANDS OFF. The chat agent owns everything else:
  // install, run, build, fix, and ALL git (pull, branch, commit, push, PR) — so
  // it keeps the token in its env and origin stays authed for pushing.
  if (manifest.mode === 'repo') {
    emit({ type: 'step', label: 'Cloning repo', status: 'active' });
    const cloneUrl = cloneUrlFor(manifest.repoUrl ?? '', token);
    const clone = await box.execStream(
      `git clone --depth 1 ${shellArg(cloneUrl)} app`,
      (line) => emit({ type: 'log', line }),
      { cwd: home, timeoutMs: 300_000, env: { GIT_TERMINAL_PROMPT: '0' } },
    );
    if (clone.exitCode !== 0) {
      const out = `${clone.stdout}\n${clone.stderr}`.trim();
      const authy = /authentication|denied|not found|could not read/i.test(out);
      throw new Error(
        `git clone failed (exit ${clone.exitCode}).${authy ? ' For a private repo, connect GitHub or set GITHUB_TOKEN.' : ''}\n${out}`,
      );
    }
    await box
      .exec(
        'git config user.email agent@aned.dev && git config user.name Aned',
        { cwd: app },
      )
      .catch(() => {});
    const baseBranch = await detectDefaultBranch(box, app);
    emit({ type: 'step', label: 'Cloning repo', status: 'done' });
    return await saveProject({
      ...manifest,
      sandboxId: box.id,
      status: 'ready',
      baseBranch,
      error: undefined,
    });
  }

  // SCRATCH: our own template — deterministic scaffold + install + dev (instant
  // and reliable; nothing to clone). 'website' → Next.js; 'app' → Vite+TanStack.
  emit({ type: 'step', label: 'Scaffolding app', status: 'active' });
  await box.exec(`mkdir -p ${app}`);
  const sc = scaffold(manifest.kind ?? 'website');
  for (const [rel, content] of Object.entries(sc.files)) {
    await box.writeFile(`${app}/${rel}`, content);
  }
  await box.exec(
    `git init -q && git ${GIT_ID} add -A && git ${GIT_ID} commit -q -m "chore: scaffold project" && git branch -M main`,
    { cwd: app },
  );
  emit({ type: 'step', label: 'Scaffolding app', status: 'done' });

  emit({ type: 'step', label: 'Installing dependencies', status: 'active' });
  const inst = await box.execStream(
    'npm install',
    (line) => emit({ type: 'log', line }),
    { cwd: app, timeoutMs: 600_000 },
  );
  if (inst.exitCode !== 0)
    throw new Error(`dependency install failed (exit ${inst.exitCode})`);
  emit({ type: 'step', label: 'Installing dependencies', status: 'done' });

  const port = sc.devPort;
  // Next dev needs the proxy host in allowedDevOrigins.
  const devEnv = sc.needsPreviewHost
    ? { PREVIEW_HOST: new URL(await box.previewUrl(port)).host }
    : undefined;

  emit({ type: 'step', label: 'Starting dev server', status: 'active' });
  const up = await startDevAndWait(box, app, 'npm run dev', port, emit, devEnv);
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

  const updated: ProjectManifest = {
    ...manifest,
    sandboxId: box.id,
    devPort: port,
    baseBranch: 'main',
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
 * Restart an existing project's dev server(s) IN PLACE — reconnect to the
 * sandbox (resuming it if idle-stopped) and re-run bring-up, WITHOUT recloning
 * or rescaffolding. Used when the box is still alive but the dev process died
 * (e.g. after an idle stop); preserves all files, including uncommitted work in
 * scratch projects. Throws if the sandbox is truly gone (caller re-seeds).
 */
export async function restartApp(
  manifest: ProjectManifest,
  emit: Emit,
): Promise<ProjectManifest> {
  const box = await connectBox(manifest); // throws if the sandbox is gone
  const home = await box.homeDir();
  const app = `${home}/app`;
  const work = await workDir(box, manifest);

  // Re-write the user's env (gitignored) in case the box was reset.
  if (manifest.env && Object.keys(manifest.env).length) {
    await writeEnv(box, work, app, manifest.env).catch(() => {});
  }

  let port: number;
  let up: boolean;
  let docsPort: number | undefined;
  let docsPreviewUrl: string | undefined;
  let secretsManager: string | undefined;
  const missingEnv = new Set<string>();

  if (manifest.mode === 'repo') {
    emit({ type: 'step', label: 'Starting app', status: 'active' });
    const appStart = await runStartup(box, work, emit, {
      hasSubdir: true, // Aned resolved the app dir; agent must NOT hunt for it
      startCmd: manifest.startCmd,
      env: manifest.env,
    });
    port = appStart.port;
    for (const k of appStart.missingEnv) missingEnv.add(k);
    secretsManager = appStart.secretsManager;
    up = await waitForDev(box, port, emit);
    emit({
      type: 'step',
      label: 'Starting app',
      status: up ? 'done' : 'error',
    });

    if (up && manifest.docsStartCmd) {
      emit({ type: 'step', label: 'Starting docs', status: 'active' });
      const docsDir = await workDir(box, { subdir: manifest.docsSubdir });
      const docsStart = await runStartup(box, docsDir, emit, {
        startCmd: manifest.docsStartCmd,
        port: 6006,
        kind: 'docs',
        logFile: '.aned-docs.log',
        hasSubdir: !!manifest.docsSubdir,
        env: manifest.env,
      });
      docsPort = docsStart.port;
      for (const k of docsStart.missingEnv) missingEnv.add(k);
      const docsUp = await waitForDev(box, docsPort, emit);
      if (docsUp) docsPreviewUrl = await box.previewUrl(docsPort);
      emit({
        type: 'step',
        label: 'Starting docs',
        status: docsUp ? 'done' : 'error',
      });
    }
  } else {
    const sc = scaffold(manifest.kind ?? 'website');
    port = sc.devPort;
    const devEnv = sc.needsPreviewHost
      ? { PREVIEW_HOST: new URL(await box.previewUrl(port)).host }
      : undefined;
    emit({ type: 'step', label: 'Starting dev server', status: 'active' });
    up = await startDevAndWait(box, app, 'npm run dev', port, emit, devEnv);
    emit({
      type: 'step',
      label: 'Starting dev server',
      status: up ? 'done' : 'error',
    });
  }

  const tail = up
    ? ''
    : (await box.readFile(devLog(app)).catch(() => ''))
        .split('\n')
        .slice(-25)
        .join('\n')
        .trim();

  const updated: ProjectManifest = {
    ...manifest,
    sandboxId: box.id,
    devPort: port,
    docsPort,
    docsPreviewUrl,
    missingEnv: missingEnv.size ? [...missingEnv] : undefined,
    secretsManager,
    previewUrl: await box.previewUrl(port),
    status: up ? 'ready' : 'error',
    error: up
      ? undefined
      : `dev server didn't restart on :${port}.\n${tail || 'no output'}`,
  };
  await saveProject(updated);
  return updated;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Shell-escape a single argument. */
function shellArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Embed the token into a GitHub https URL so the clone (and the agent's pushes
 * via origin) authenticate without an interactive prompt. Non-GitHub or
 * token-less URLs pass through.
 */
function cloneUrlFor(url: string, token?: string): string {
  const tok = token ?? process.env.GITHUB_TOKEN;
  if (!tok) return url;
  const m = url.match(/^https:\/\/github\.com\/(.+)$/);
  return m ? `https://x-access-token:${tok}@github.com/${m[1]}` : url;
}

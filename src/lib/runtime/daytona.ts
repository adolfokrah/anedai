/**
 * Daytona implementation of the Runtime/Box interface.
 *
 * Notes from the Daytona Node SDK (`@daytonaio/sdk`, v0.190):
 *  - `new Daytona({ apiKey, apiUrl })` — also reads DAYTONA_API_KEY / DAYTONA_API_URL.
 *  - `daytona.create({ image, resources:{cpu,memory,disk}, public, envVars }, { timeout })`
 *    boots a sandbox. `public: true` makes the port preview reachable WITHOUT a
 *    token — required so the preview loads in an <iframe>. Resources let us give
 *    heavy installs (e.g. Payload + sharp) enough RAM.
 *  - `sandbox.process.executeCommand(cmd, cwd?, env?, timeoutSec?)` blocks and
 *    returns { exitCode, result }. There is no native background flag, so a
 *    long-lived dev server runs inside a SESSION with `{ async: true }`, which
 *    returns immediately and keeps running.
 *  - `sandbox.fs.downloadFile/uploadFile/listFiles`; `getPreviewLink(port)` →
 *    { url, token }; `daytona.get(id)` reconnects; `setAutostopInterval(min)`.
 */

import { Daytona, type Sandbox } from '@daytonaio/sdk';

import type {
  Box,
  CreateOptions,
  DirEntry,
  ExecOptions,
  ExecResult,
  Runtime,
} from './types';

// Default: Daytona's DEFAULT snapshot — it ships the toolbox's expected shell
// (zsh at /usr/bin/zsh) plus node + git, so commands run. A custom image/snapshot
// MUST also include zsh, or every executeCommand fails with
// "fork/exec /usr/bin/zsh: no such file". Heavy full-stack repos (Payload + Next
// + Mongo) OOM on the default RAM — point DAYTONA_SNAPSHOT at a prebuilt snapshot
// with more RAM (resources are baked in), or set DAYTONA_IMAGE + DAYTONA_CPU/
// MEMORY/DISK. See sandboxConfig().
const CREATE_TIMEOUT_S = 180;

function client(): Daytona {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) throw new Error('DAYTONA_API_KEY is not set');
  // `target` (region) is a CLIENT-config field, not a create param — default EU.
  return new Daytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL,
    target: process.env.DAYTONA_TARGET || 'eu',
  });
}

/**
 * Extra create params from env, for heavy repos that OOM/ENOSPC on the default
 * snapshot (e.g. Payload + Next + Mongo):
 *  - DAYTONA_SNAPSHOT — a prebuilt snapshot name (must include the toolbox shell
 *    zsh + node + git); resources are baked into the snapshot. PREFERRED.
 *  - DAYTONA_IMAGE — a custom image (resources below apply to images).
 *  - DAYTONA_CPU / DAYTONA_MEMORY / DAYTONA_DISK — cores / GiB / GiB. Honored
 *    with an image/snapshot (Daytona ignores resources on the default snapshot).
 *  - DAYTONA_TARGET — region the sandbox runs in. Defaults to 'eu'.
 * None set → the default snapshot (fixed, smaller RAM), EU region.
 */
function sandboxConfig(): {
  snapshot?: string;
  image?: string;
  resources?: { cpu?: number; memory?: number; disk?: number };
} {
  const cfg: {
    snapshot?: string;
    image?: string;
    resources?: { cpu?: number; memory?: number; disk?: number };
  } = {};
  // Default to Daytona's `daytona-large` pre-built snapshot (4 vCPU / 8 GiB /
  // 10 GiB, with the toolbox shell + node + git baked in) so a fresh Aned never
  // silently ships the 1 GiB `daytona-small` default — real installs/monorepos
  // OOM in 1 GiB. Override with DAYTONA_SNAPSHOT, or DAYTONA_IMAGE for a custom
  // image (which also unlocks the DAYTONA_CPU/MEMORY/DISK overrides below).
  // A custom image wins (and unlocks resource overrides); otherwise a snapshot.
  // image + snapshot together is invalid, so never set both.
  const DEFAULT_SNAPSHOT = 'daytona-large';
  if (process.env.DAYTONA_IMAGE) {
    cfg.image = process.env.DAYTONA_IMAGE;
  } else {
    cfg.snapshot = process.env.DAYTONA_SNAPSHOT || DEFAULT_SNAPSHOT;
  }
  const num = (v?: string) => {
    const n = v ? Number(v) : Number.NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  // Resources can ONLY be specified with an IMAGE. Daytona bakes resources into
  // snapshots and rejects create() with "Cannot specify Sandbox resources when
  // using a snapshot" — this includes the DEFAULT snapshot used when no image is
  // set. So: size up by setting DAYTONA_IMAGE; sizing comes from the snapshot
  // otherwise.
  if (cfg.image && !cfg.snapshot) {
    // Default to the Tier-2 per-sandbox ceiling (1 GiB OOMs real installs);
    // override any axis via env.
    const DEFAULT_CPU = 4;
    const DEFAULT_MEMORY = 8; // GiB
    const DEFAULT_DISK = 10; // GiB
    cfg.resources = {
      cpu: num(process.env.DAYTONA_CPU) ?? DEFAULT_CPU,
      memory: num(process.env.DAYTONA_MEMORY) ?? DEFAULT_MEMORY,
      disk: num(process.env.DAYTONA_DISK) ?? DEFAULT_DISK,
    };
  }
  return cfg;
}

function secs(ms?: number): number | undefined {
  return ms ? Math.ceil(ms / 1000) : undefined;
}

/** Quote + cd into cwd for commands that have no cwd parameter (sessions). */
function withCwd(cmd: string, cwd?: string): string {
  return cwd ? `cd ${cwd.replace(/'/g, `'\\''`)} && ${cmd}` : cmd;
}

class DaytonaBox implements Box {
  constructor(private readonly sbx: Sandbox) {}

  get id(): string {
    return this.sbx.id;
  }

  async exec(cmd: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (opts.background) {
      // Long-lived process: run in a session so it survives the call returning.
      const sessionId = `bg-${this.sbx.id}-${Date.now()}`;
      await this.sbx.process.createSession(sessionId);
      await this.sbx.process.executeSessionCommand(sessionId, {
        command: withCwd(cmd, opts.cwd),
        async: true,
      });
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    const r = await this.sbx.process.executeCommand(
      cmd,
      opts.cwd,
      opts.env,
      secs(opts.timeoutMs),
    );
    return { stdout: r.result ?? '', stderr: '', exitCode: r.exitCode ?? 0 };
  }

  async execStream(
    cmd: string,
    onLine: (line: string) => void,
    opts: ExecOptions = {},
  ): Promise<ExecResult> {
    // Daytona's executeCommand is blocking with no live callback; run it, then
    // forward the captured output line-by-line once it completes.
    const r = await this.sbx.process.executeCommand(
      cmd,
      opts.cwd,
      opts.env,
      secs(opts.timeoutMs),
    );
    const out = r.result ?? '';
    for (const line of out.split('\n')) {
      if (line.trim()) onLine(line);
    }
    return { stdout: out, stderr: '', exitCode: r.exitCode ?? 0 };
  }

  async readFile(path: string): Promise<string> {
    const buf = await this.sbx.fs.downloadFile(path);
    return buf.toString('utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sbx.fs.uploadFile(Buffer.from(content, 'utf-8'), path);
  }

  async listDir(path: string): Promise<DirEntry[]> {
    const entries = await this.sbx.fs.listFiles(path);
    return entries.map((e) => ({ name: e.name, isDir: e.isDir }));
  }

  async homeDir(): Promise<string> {
    return (await this.sbx.getUserRootDir()) ?? '/home/daytona';
  }

  async previewUrl(port: number): Promise<string> {
    const link = await this.sbx.getPreviewLink(port);
    return link.url;
  }

  async keepAlive(ms: number): Promise<void> {
    // Auto-stop interval is in minutes; keep it ahead of our heartbeat.
    await this.sbx.setAutostopInterval(Math.max(1, Math.ceil(ms / 60_000)));
  }

  async destroy(): Promise<void> {
    await this.sbx.delete();
  }
}

export class DaytonaRuntime implements Runtime {
  async create(opts: CreateOptions = {}): Promise<Box> {
    const params = { public: true, ...sandboxConfig() };
    const sbx = await client().create(params, {
      timeout: opts.timeoutMs
        ? Math.ceil(opts.timeoutMs / 1000)
        : CREATE_TIMEOUT_S,
    });
    console.log(
      `[daytona] created sandbox ${sbx.id}`,
      params.snapshot
        ? `(snapshot ${params.snapshot})`
        : params.image
          ? `(image ${params.image})`
          : params.resources
            ? `(resources ${JSON.stringify(params.resources)})`
            : '(default snapshot)',
    );
    return new DaytonaBox(sbx);
  }

  async connect(id: string): Promise<Box> {
    const sbx = await client().get(id);
    return new DaytonaBox(sbx);
  }
}

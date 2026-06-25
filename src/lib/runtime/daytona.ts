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

// Use Daytona's DEFAULT snapshot (not a custom image): it ships the toolbox's
// expected shell (zsh at /usr/bin/zsh) plus node + git, so commands actually
// run. A custom image without that shell makes every executeCommand fail with
// "fork/exec /usr/bin/zsh: no such file". `resources` is image-only, so the box
// gets default RAM — fine for scratch/SPA; heavy full-stack repos need a
// prebuilt snapshot with more RAM (future).
const CREATE_TIMEOUT_S = 180;

function client(): Daytona {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) throw new Error('DAYTONA_API_KEY is not set');
  return new Daytona({ apiKey, apiUrl: process.env.DAYTONA_API_URL });
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
    const sbx = await client().create(
      { public: true },
      {
        timeout: opts.timeoutMs
          ? Math.ceil(opts.timeoutMs / 1000)
          : CREATE_TIMEOUT_S,
      },
    );
    console.log(`[daytona] created sandbox ${sbx.id} (default snapshot)`);
    return new DaytonaBox(sbx);
  }

  async connect(id: string): Promise<Box> {
    const sbx = await client().get(id);
    return new DaytonaBox(sbx);
  }
}

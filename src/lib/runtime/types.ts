/**
 * Provider-agnostic sandbox runtime. E2B is the first implementation
 * (`lib/runtime/daytona.ts`); Fly Machines / self-hosted Docker can swap in behind
 * the same interface without touching the agent loop or route handlers.
 */

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOptions {
  /** Working directory inside the sandbox. */
  cwd?: string;
  /** Extra env vars for this command. */
  env?: Record<string, string>;
  /** Run detached (long-lived dev server); resolves once started. */
  background?: boolean;
  /** Hard timeout in ms for a blocking command. */
  timeoutMs?: number;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

/** A running sandbox (one per active project workspace). */
export interface Box {
  readonly id: string;

  /** Run a command and resolve with its output (or start it in background). */
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>;
  /** Run a command, streaming stdout+stderr line-by-line. */
  execStream(
    cmd: string,
    onLine: (line: string) => void,
    opts?: ExecOptions,
  ): Promise<ExecResult>;

  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;

  /** Writable home/root directory for the sandbox user (varies by provider). */
  homeDir(): Promise<string>;

  /** Public https URL for a port exposed inside the sandbox. */
  previewUrl(port: number): Promise<string>;

  /** Extend the sandbox's idle timeout (heartbeat while workspace is open). */
  keepAlive(ms: number): Promise<void>;
  /** Terminate the sandbox. */
  destroy(): Promise<void>;
}

export interface CreateOptions {
  /** Idle timeout in ms before the sandbox is auto-killed. */
  timeoutMs?: number;
}

export interface Runtime {
  /** Boot a fresh sandbox. */
  create(opts?: CreateOptions): Promise<Box>;
  /** Reconnect to an existing sandbox by id; throws if it's gone. */
  connect(id: string): Promise<Box>;
}

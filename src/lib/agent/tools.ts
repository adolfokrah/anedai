/**
 * Custom agent tools that proxy every file/exec operation into the project's
 * sandbox. The Claude Agent SDK's built-in Read/Write/Edit/Bash/Glob/Grep act
 * on OUR host filesystem, so we disable them (see `run.ts`) and expose these
 * sandbox-targeted equivalents via an in-process MCP server instead.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { Box } from '@/lib/runtime/types';

const MAX_OUT = 30_000;

function text(s: string, isError = false) {
  const body = s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n…[truncated]` : s;
  return { content: [{ type: 'text' as const, text: body }], isError };
}

/**
 * Build the MCP server (and its allowed tool names) bound to one sandbox.
 * `app` is the absolute app directory; agent paths are resolved relative to it.
 */
export function sandboxTools(box: Box, app: string) {
  const abs = (p: string) =>
    `${app}/${p.replace(/^\.\//, '').replace(/^\/+/, '')}`;

  const server = createSdkMcpServer({
    name: 'sandbox',
    version: '1.0.0',
    tools: [
      tool(
        'read_file',
        'Read a file from the app, relative to the app root (e.g. "src/App.tsx").',
        { path: z.string() },
        async ({ path }) => {
          try {
            return text(await box.readFile(abs(path)));
          } catch (e) {
            return text(`read failed: ${msg(e)}`, true);
          }
        },
      ),
      tool(
        'write_file',
        'Create or overwrite a file with full contents. Path is relative to the app root.',
        { path: z.string(), content: z.string() },
        async ({ path, content }) => {
          try {
            await box.writeFile(abs(path), content);
            return text(`wrote ${path}`);
          } catch (e) {
            return text(`write failed: ${msg(e)}`, true);
          }
        },
      ),
      tool(
        'str_replace',
        'Replace an exact, unique substring in a file. `old` must occur exactly once.',
        { path: z.string(), old: z.string(), new: z.string() },
        async ({ path, old, new: next }) => {
          try {
            const cur = await box.readFile(abs(path));
            const count = cur.split(old).length - 1;
            if (count === 0) return text(`"old" not found in ${path}`, true);
            if (count > 1)
              return text(
                `"old" is not unique in ${path} (${count} matches)`,
                true,
              );
            await box.writeFile(abs(path), cur.replace(old, next));
            return text(`edited ${path}`);
          } catch (e) {
            return text(`edit failed: ${msg(e)}`, true);
          }
        },
      ),
      tool(
        'list_dir',
        'List entries in a directory, relative to the app root (default ".").',
        { path: z.string().optional() },
        async ({ path }) => {
          try {
            const entries = await box.listDir(abs(path ?? '.'));
            return text(
              entries
                .map((e) => (e.isDir ? `${e.name}/` : e.name))
                .sort()
                .join('\n') || '(empty)',
            );
          } catch (e) {
            return text(`list failed: ${msg(e)}`, true);
          }
        },
      ),
      tool(
        'grep',
        'Search file contents with a regex across the app (ripgrep-style).',
        { pattern: z.string(), glob: z.string().optional() },
        async ({ pattern, glob }) => {
          const inc = glob ? `--include=${shellArg(glob)}` : '';
          const r = await box.exec(
            `grep -rnI ${inc} -e ${shellArg(pattern)} . | head -200 || true`,
            { cwd: app, timeoutMs: 20_000 },
          );
          return text(r.stdout || '(no matches)');
        },
      ),
      tool(
        'run_cmd',
        'Run a shell command in the app directory (e.g. install a package, run a build). Avoid starting long-lived servers.',
        { cmd: z.string() },
        async ({ cmd }) => {
          const r = await box.exec(cmd, { cwd: app, timeoutMs: 120_000 });
          const out = [r.stdout, r.stderr].filter(Boolean).join('\n');
          return text(`exit ${r.exitCode}\n${out}`, r.exitCode !== 0);
        },
      ),
      tool(
        'web_fetch',
        'Fetch a public URL (docs, an API, a reference page) and return its text content. Use to look up library docs/APIs while building. HTML is reduced to readable text.',
        { url: z.string() },
        async ({ url }) => {
          const blocked = blockedUrl(url);
          if (blocked) return text(blocked, true);
          try {
            const res = await fetch(url, {
              redirect: 'follow',
              headers: { 'user-agent': 'AnedAgent/1.0' },
              signal: AbortSignal.timeout(20_000),
            });
            const ct = res.headers.get('content-type') ?? '';
            const raw = await res.text();
            const body = ct.includes('html') ? stripHtml(raw) : raw;
            return text(`(${res.status} ${ct})\n${body}`, !res.ok);
          } catch (e) {
            return text(`fetch failed: ${msg(e)}`, true);
          }
        },
      ),
    ],
  });

  const allowedTools = [
    'mcp__sandbox__read_file',
    'mcp__sandbox__write_file',
    'mcp__sandbox__str_replace',
    'mcp__sandbox__list_dir',
    'mcp__sandbox__grep',
    'mcp__sandbox__run_cmd',
    'mcp__sandbox__web_fetch',
  ];

  return { server, allowedTools };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Reject non-http(s) and private/loopback/metadata hosts (basic SSRF guard). */
function blockedUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'invalid URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return 'only http(s) URLs are allowed';
  }
  const h = u.hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '169.254.169.254' || // cloud metadata
    h.endsWith('.local') ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    return 'that host is not allowed';
  }
  return null;
}

/** Reduce HTML to readable text (drop scripts/styles/tags, collapse space). */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shellArg(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

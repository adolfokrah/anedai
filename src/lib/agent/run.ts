/**
 * Run one chat turn against a project's running sandbox. The agent edits real
 * React source via the sandbox-proxied tools; the dev server hot-reloads, so
 * the preview iframe reflects changes live. Streams text + tool progress.
 */

import type {
  CanUseTool,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

import { designSystemPrompt } from '@/lib/design-system';
import type { Box } from '@/lib/runtime/types';
import { appDir } from '@/lib/seed';
import type { AgentEvent, ProjectManifest } from '@/lib/types';

import { sandboxTools } from './tools';

const BUILTINS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Glob', 'Grep'];

type Emit = (e: AgentEvent) => void;

export interface ChatResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
  /** Conventional Commit subject the agent ended with (commit + PR title). */
  summary?: string;
}

const CONVENTIONAL =
  /^(feat|fix|chore|refactor|docs|style|test|perf|build|ci)(\(.+?\))?!?:\s+.+/i;

/** Pull the last Conventional Commit subject line out of the agent's prose. */
function extractSummary(text: string): string | undefined {
  let found: string | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (CONVENTIONAL.test(line)) found = line.slice(0, 72);
  }
  return found;
}

/**
 * Opinionated aesthetic guidance so output looks designed, not default. Applied
 * to scratch builds especially; for connected repos it's secondary to matching
 * the repo's existing system.
 */
const DESIGN_DIRECTIVE = `DESIGN — make it look like a polished, modern product (think Linear, Vercel, Stripe dashboards), never a generic bootstrap/AI demo:
- Layout & space: generous whitespace, clear visual hierarchy, an 8px spacing rhythm, max-width containers, aligned grids. Let content breathe.
- Type: one clean sans (system/Inter/Geist). A real scale — large semibold headings, muted secondary text. Tight tracking on big headings. Never walls of same-size text.
- Color: a restrained neutral palette + ONE accent. Prefer a refined dark theme by default (near-black bg, not pure #000; layered surfaces). Ensure AA contrast. Use subtle, not harsh, borders (low-opacity).
- Surfaces & depth: rounded corners (lg/xl), hairline borders, soft shadows or subtle ring — not heavy drop shadows. Cards/panels visually distinct from the background.
- Components: real states (hover, focus-visible ring, active, disabled), smooth 150–200ms transitions, accessible focus. Consistent sizing for buttons/inputs/badges.
- Polish: status badges with semantic color, sensible empty states, icon set (lucide-react) for affordances, tasteful charts (recharts) when data viz is asked. Make numbers/labels scannable.
- Responsive by default; no horizontal overflow.
Use Tailwind utility classes (the scratch scaffold has Tailwind v4 ready). Install lucide-react / recharts via run_cmd when they elevate the result.`;

function systemPrompt(manifest: ProjectManifest): string {
  return `You are Aned's coding agent and a senior product designer. You edit a REAL, running React app inside a sandbox using ONLY the provided sandbox tools (read_file, write_file, str_replace, list_dir, grep, run_cmd, web_fetch). All paths are relative to the app root. A dev server is already running with hot reload — do NOT start, stop, or restart it; your file edits appear in the live preview automatically.

Project: ${manifest.name} (${manifest.mode === 'repo' ? 'connected repo' : 'built from scratch'}).

Guidelines:
- Explore with list_dir/grep/read_file before editing; match the project's existing conventions, framework, and styling.
- Prefer str_replace for small edits; write_file for new files or full rewrites.
- Use run_cmd to install packages (e.g. "npm install <pkg>") when genuinely needed — never to launch servers.
- NEVER run git (commit/branch/checkout/push/merge/pull) via run_cmd. Aned owns version control — it branches, commits, and pushes around your work automatically. Just edit files.
- Keep changes focused on the request. End your reply with a final line that is a Conventional Commit subject — \`<type>: <summary>\` where type is one of feat, fix, chore, refactor, docs, style, test, perf (≤70 chars, lowercase summary). It becomes the commit message + PR title. Example: \`feat: add pricing page with three tiers\`.
- For ANY UI/design work (new screens, layouts, components, restyles, redesigns), FIRST invoke the **design-taste-frontend** skill and follow its process — read the brief, state the design read, then build. Do not free-hand a generic interface.
- The design system is the source of truth: compose screens from its components by reference; never redefine a component inline on a page. If something is missing, add it to the design system first, then use it.

${DESIGN_DIRECTIVE}

${designSystemPrompt(manifest.mode === 'repo' ? 'scanned' : 'greenfield')}`;
}

export interface ChatImage {
  /** base64 (no data: prefix). */
  data: string;
  mediaType: string;
}

export async function runProjectChat(
  box: Box,
  manifest: ProjectManifest,
  message: string,
  emit: Emit,
  opts: {
    resume?: string;
    model?: string;
    images?: ChatImage[];
    abortController?: AbortController;
  } = {},
): Promise<ChatResult> {
  const app = await appDir(box);
  const { server, allowedTools } = sandboxTools(box, app);

  // Allow only our sandbox tools + the Skill loader (for design-taste-frontend);
  // deny everything else so a headless run never blocks on a permission prompt
  // and never touches our host filesystem.
  const guard: CanUseTool = async (toolName, input) => {
    if (toolName.startsWith('mcp__sandbox__') || toolName === 'Skill') {
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: 'Use the sandbox tools only.' };
  };

  const promptText = `${systemPrompt(manifest)}\n\nUSER REQUEST:\n${message}`;
  // With attached images, send a structured user message (text + vision image
  // blocks) via an async-iterable prompt; otherwise a plain string prompt.
  const prompt = opts.images?.length
    ? imagePrompt(promptText, opts.images)
    : promptText;

  const run = query({
    prompt,
    options: {
      mcpServers: { sandbox: server },
      allowedTools: [...allowedTools, 'Skill'],
      disallowedTools: BUILTINS,
      canUseTool: guard,
      // Load vendored skills from our repo's .claude/skills (cwd = server root).
      settingSources: ['project'],
      skills: ['design-taste-frontend'],
      maxTurns: 60,
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.abortController
        ? { abortController: opts.abortController }
        : {}),
    },
  });

  let sessionId: string | undefined;
  let transcript = '';
  try {
    for await (const msg of run) {
      if ('session_id' in msg && msg.session_id) sessionId = msg.session_id;
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            transcript += `${block.text}\n`;
            emit({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            emit({
              type: 'tool',
              name: block.name.replace('mcp__sandbox__', ''),
              target: toolTarget(block.input),
            });
          }
        }
      } else if (msg.type === 'result') {
        if (msg.subtype === 'success')
          return { ok: true, sessionId, summary: extractSummary(transcript) };
        const detail =
          'errors' in msg && Array.isArray(msg.errors) && msg.errors.length
            ? msg.errors.join('; ')
            : msg.subtype;
        return { ok: false, sessionId, error: `agent ended: ${detail}` };
      }
    }
  } catch (err) {
    return {
      ok: false,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: false, sessionId, error: 'agent stream ended without a result' };
}

function toolTarget(input: unknown): string | undefined {
  if (typeof input !== 'object' || !input) return undefined;
  const o = input as Record<string, unknown>;
  const v = o.path ?? o.pattern ?? o.cmd;
  return v ? String(v) : undefined;
}

/** A one-shot async-iterable prompt carrying text + vision image blocks. */
async function* imagePrompt(
  text: string,
  images: ChatImage[],
): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        { type: 'text', text },
        ...images.map((im) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: im.mediaType as
              | 'image/png'
              | 'image/jpeg'
              | 'image/gif'
              | 'image/webp',
            data: im.data,
          },
        })),
      ],
    },
  } as SDKUserMessage;
}

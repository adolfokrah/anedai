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
import { workDir } from '@/lib/seed';
import { updateProject } from '@/lib/store';
import type { AgentEvent, ProjectManifest } from '@/lib/types';

import { VISION_MODEL, modelHasVision } from '@/lib/models';

import { anthropicEnabled, resolveProvider } from './provider';
import { sandboxTools } from './tools';

const BUILTINS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Glob', 'Grep'];

/** Chat mode: build = edit + commit + PR; plan = read-only, produce a plan. */
export type ChatMode = 'build' | 'plan';

/** Sandbox tools that don't mutate the app — the only ones plan mode may use. */
const READONLY_TOOLS = [
  'mcp__sandbox__read_file',
  'mcp__sandbox__list_dir',
  'mcp__sandbox__grep',
  'mcp__sandbox__web_fetch',
  'mcp__sandbox__ask_user',
];

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
export function extractSummary(text: string): string | undefined {
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
- Imagery: you CANNOT generate raster images. For visuals, prefer inline SVG (icons, logos, illustrations, patterns) and CSS (gradients, shapes); use lucide-react for icons. When a real photo is needed, use a placeholder/stock URL (e.g. https://placehold.co/<w>x<h>, Unsplash source) — never leave a broken or empty <img>, and don't reference local image files that don't exist.
Use Tailwind utility classes (the scratch scaffold has Tailwind v4 ready). Install lucide-react / recharts via run_cmd when they elevate the result.`;

/**
 * PLAN MODE — read-only investigation that ends in a concrete implementation
 * plan. No mutating tools are exposed (see READONLY_TOOLS), so the agent cannot
 * edit, run commands, commit, or open a PR even if it tries.
 */
function planPrompt(manifest: ProjectManifest): string {
  return `You are Aned's coding agent and a senior product designer, in PLAN MODE (read-only: read_file, list_dir, grep, web_fetch — you CANNOT edit, run commands, commit, or open PRs). Do not claim to have made changes.

Project: ${manifest.name} (${manifest.mode === 'repo' ? 'connected repo' : 'built from scratch'}).

Investigate quietly first (read the code to ground the plan), then give the user a SHORT, PLAIN-LANGUAGE plan they can actually follow. The reader is often NON-TECHNICAL (a business owner) — write for them.

HARD RULES for the output:
- NO code blocks, NO file paths, NO config snippets, NO library/version names, NO dials/variance tables, NO risk tables, NO investigation/file tables. Those confuse the user. Keep all of that internal.
- Plain words, not jargon. Short. Think a friendly one-screen brief, not an engineering doc.

Structure your reply as:
1. **Overview** — 2–3 sentences: what you'll build and the look & feel, in plain language.
2. **What you'll get** — a short bullet list of the pages/sections or features, described by what the user sees (e.g. "A bold hero with your headline and a 'Get a Quote' button", "A services section", "A photo gallery of past work"). 5–9 bullets max.
3. **The look** — 2–4 plain bullets on the design direction with YOUR pick (e.g. "Dark, premium feel with a gold accent — reads trustworthy and high-end").
4. **Need from you** — ONLY real things you can't invent: contact details, real numbers/stats, photos. Each with the placeholder you'll use until they provide it. Skip this section entirely if there's nothing.

End with ONE short line: "Switch to Build and I'll get started." No commit line.`;
}

export function systemPrompt(
  manifest: ProjectManifest,
  mode: ChatMode = 'build',
): string {
  if (mode === 'plan') return planPrompt(manifest);
  const base = manifest.baseBranch || 'main';
  const projectSlug =
    manifest.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'project';
  const connected = !!manifest.repoUrl;

  return `You are Aned's coding agent and a senior product designer. You edit a REAL, running React app inside a sandbox using the provided tools (read_file, write_file, str_replace, list_dir, grep, run_cmd, start_app, web_fetch). All paths are relative to the app root. A dev server is already running on port ${manifest.devPort} with hot reload — your file edits appear in the live preview automatically. Do NOT launch a second dev server; only use start_app to RESTART it if it has crashed (see DEBUGGING).

Project: ${manifest.name} (${manifest.mode === 'repo' ? 'connected repo' : 'built from scratch'}).${
    manifest.mode === 'scratch'
      ? `${
          manifest.kind === 'app'
            ? ' Stack: Vite + React + TanStack Router (CODE-BASED routes — add routes in src/router.tsx, components in src/routes/) + Tailwind v4. For a dashboard/web-app feel.'
            : ' Stack: Next.js App Router (pages in src/app/**/page.tsx, layouts in layout.tsx, `@/*` → src/*) + Tailwind v4. For a marketing site / landing page.'
        } UI: shadcn/ui is preconfigured (components.json, the \`cn\` util at @/lib/utils, a CSS-variable theme, lucide-react). ADD components with \`npx shadcn@latest add <name>\` (e.g. button card input dialog) and compose them — do NOT hand-roll primitives. The design system extends these tokens/components.`
      : ''
  }

Guidelines:
- CLARIFY, don't guess: whenever a request is ambiguous or you need a decision or content from the user (a choice between approaches, missing copy/data, a design/UX direction, which page they mean), use the **ask_user** tool to ask — concrete options (your recommended one first) + allowOther for free text. It shows a form and pauses for their answer. The design-system intake is one example; apply the same for any task. Don't over-ask — only when the answer genuinely changes what you build.
- Explore with list_dir/grep/read_file before editing; match the project's existing conventions, framework, and styling.
- Prefer str_replace for small edits; write_file for new files or full rewrites.
- Use run_cmd to install packages (e.g. "npm install <pkg>") when genuinely needed — never to launch a dev server (one is already running).
- SKILLS: a project skill is a folder at \`.claude/skills/<name>/SKILL.md\` with YAML front matter (\`name\`, \`description\`) then markdown instructions. When the user asks to create or edit a skill, gather what it should do (use ask_user if details are unclear), then write/update that file with rich, specific guidance. It becomes invocable via \`/<name>\`.
- DEBUGGING: the dev server logs to \`.aned-dev.log\` in the app dir. When the user reports the app (or a page) broken, blank, erroring, or not loading — and before guessing — read the REAL error: \`tail -n 80 .aned-dev.log\` and \`curl -s -o /dev/null -w "%{http_code}" http://localhost:${manifest.devPort}\`. Diagnose from that, then fix the cause.${
    connected
      ? " This repo works on the developer's machine, so a failure is usually an ENVIRONMENT issue — a missing dependency/build tool (e.g. sass), wrong install scope (monorepo hoisting / `--ignore-workspace`), an unprovisioned service (DB), or missing env — NOT the app code. Fix the environment / install the missing tooling; do not gut working source to dodge it."
      : ''
  } If the dev server is DOWN (no node process, or curl fails to connect), restart it with start_app on port ${manifest.devPort} bound to 0.0.0.0, then re-check the log.

VERSION CONTROL — you manage git yourself via run_cmd. The sandbox is preconfigured: committer identity is set${connected ? ', `origin` is authenticated, and the `gh` CLI is authenticated (GH_TOKEN set)' : ' (no GitHub remote connected yet — commit locally; skip push/PR)'}. Default branch: \`${base}\`. For EACH task:
  1. Branch: ensure you're on a feature branch off \`${base}\`, NOT on \`${base}\` itself. If you're on \`${base}\`, create one named \`${projectSlug}/<short-task-title>\` (kebab-case), e.g. \`git checkout -b ${projectSlug}/add-pricing\`. If you already made a feature branch earlier this session, reuse it (\`git checkout <branch>\`).
  2. Edit the code.
  3. Commit: \`git add -A && git commit -m "<type>: <summary>"\` — a Conventional Commit subject (feat/fix/chore/refactor/docs/style/test/perf, ≤70 chars).${
    connected
      ? `\n  4. Push: \`git push -u origin <branch>\`. Then OPEN A PR — this is YOUR job (Aned does not do it). Prefer \`gh pr create --fill --base ${base} --head <branch>\`; if \`gh\` isn't installed, install it (or open the PR via the GitHub API with curl using $GITHUB_TOKEN: POST https://api.github.com/repos/<owner>/<repo>/pulls). Skip if a PR for the branch already exists. Merging is done by the user in the Aned UI; do NOT merge.`
      : ''
  }
- Keep changes focused. End your reply with the same Conventional Commit subject on its own final line. Example: \`feat: add pricing page with three tiers\`.
- For ANY UI/design work (new screens, layouts, components, restyles, redesigns), FIRST invoke the **design-taste-frontend** skill and follow its process — read the brief, state the design read, then build. Do not free-hand a generic interface.
- The design system is the source of truth: compose screens from its components by reference; never redefine a component inline on a page. If something is missing, add it to the design system first, then use it.
- WIRE THE WORKSPACE TABS via \`anedai.json\` at the app root (the runtime config Aned reads each turn). routes are ALWAYS full https URLs, never relative paths — take the base from what start_app returned: \`{ "app": { "port": <p>, "route": "<app's full preview URL>" } }\`. Add a \`designSystem\` entry for the design-system view: if it's a ROUTE on the SAME app (e.g. /design-system), use the app's port + the full URL to that route: \`"designSystem": { "port": <appPort>, "route": "<app's full preview URL>/design-system" }\`. If it's a SEPARATE server (Storybook / docs app on its own port), start it via start_app role:"docs" (the main app is role:"app") and record its own port + the FULL https URL start_app returned: \`"designSystem": { "port": <docsPort>, "route": "<full URL>" }\`. If the project runs a separate BACKEND/API the user opted into, start it via start_app role:"backend", point the frontend's API env at the backend's PUBLIC url (not localhost), handle CORS, and record \`"backend": { "port": <p>, "route": "<full URL>" }\`.

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
    /** Route the user is viewing in the preview (so "this page" is resolvable). */
    viewing?: string;
    /** A skill the user invoked via `/` — its SKILL.md is injected as context. */
    skill?: string;
    githubToken?: string;
    abortController?: AbortController;
    /** build (default) edits + ships; plan is read-only and produces a plan. */
    mode?: ChatMode;
  } = {},
): Promise<ChatResult> {
  const mode: ChatMode = opts.mode ?? 'build';
  const planning = mode === 'plan';
  const app = await workDir(box, manifest);
  // The agent's run_cmd env: the user's project env (so builds/tests see it),
  // plus the GitHub token so `git push` / `gh` work inside the sandbox.
  const cmdEnv: Record<string, string> = { ...(manifest.env ?? {}) };
  if (opts.githubToken) {
    cmdEnv.GH_TOKEN = opts.githubToken;
    cmdEnv.GITHUB_TOKEN = opts.githubToken;
  }
  const { server, allowedTools } = sandboxTools(box, app, {
    env: Object.keys(cmdEnv).length ? cmdEnv : undefined,
    // Let the agent restart the dev server if its own edit (or a crash) takes
    // it down — it reads .aned-dev.log to diagnose, then start_app to recover.
    // Plan mode is read-only, so it never needs to (re)start the server.
    includeStartApp: !planning,
    // ask_user renders a dynamic question form in the chat and ends the turn.
    onAsk: (questions) => emit({ type: 'questions', questions }),
    // role 'docs' → DS tab (docsPreviewUrl); 'backend' → API server, no tab
    // (backendUrl, the frontend calls it); else the main app (Pages tab).
    onStartApp: (port, role = 'app') => {
      void box
        .previewUrl(port)
        .then(async (url) => {
          const patch =
            role === 'docs'
              ? { docsPort: port, docsPreviewUrl: url }
              : role === 'backend'
                ? { backendPort: port, backendUrl: url }
                : { devPort: port, previewUrl: url };
          await updateProject(manifest.slug, patch);
          emit({ type: 'preview', url, port, role });
        })
        .catch(() => {});
    },
  });

  // Plan mode exposes only read-only tools; build mode gets the full set.
  const tools = planning
    ? allowedTools.filter((t) => READONLY_TOOLS.includes(t))
    : allowedTools;

  // Allow only our sandbox tools + the Skill loader (for design-taste-frontend);
  // deny everything else so a headless run never blocks on a permission prompt
  // and never touches our host filesystem. In plan mode also deny any mutating
  // sandbox tool, defending the read-only contract even if one slips into scope.
  const guard: CanUseTool = async (toolName, input) => {
    const isSandbox = toolName.startsWith('mcp__sandbox__');
    if (planning && isSandbox && !READONLY_TOOLS.includes(toolName)) {
      return { behavior: 'deny', message: 'Plan mode is read-only.' };
    }
    if (isSandbox || toolName === 'Skill') {
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: 'Use the sandbox tools only.' };
  };

  // The route the user is looking at — so "this page", "here", "fix this"
  // resolve to a concrete route. The agent maps it to the file that renders it.
  const context = opts.viewing
    ? `\n\nCONTEXT: The user is currently viewing the route \`${opts.viewing}\` in the live preview. If they say "this page", "here", or otherwise refer to what's on screen, they mean that route — locate the file that renders it (Next: app${opts.viewing}/page.* or a matching route; SPA: the matching route component) before editing.`
    : '';

  // A `/`-invoked skill. Repo skills live in the SANDBOX (the SDK can't load
  // them), so inject the SKILL.md as context; for a bundled skill not found in
  // the sandbox, fall back to the SDK Skill tool via a directive.
  let skillBlock = '';
  if (opts.skill && /^[A-Za-z0-9_-]+$/.test(opts.skill)) {
    const md = await box
      .readFile(`${app}/.claude/skills/${opts.skill}/SKILL.md`)
      .catch(() => '');
    skillBlock = md
      ? `\n\nACTIVE SKILL — "${opts.skill}". Follow this skill's process for this task:\n\n${md.slice(0, 16000)}`
      : `\n\nThe user invoked the "${opts.skill}" skill — use it for this task.`;
  }

  // DESIGN-SYSTEM-FIRST GATE (build mode only): until a design system exists,
  // the agent must establish it before building any product page. Checked each
  // build turn; once design-system/design-system.json exists, the gate lifts.
  let dsGate = '';
  if (!planning) {
    const dsExists = !!(await box
      .readFile(`${app}/design-system/design-system.json`)
      .catch(() => ''));
    if (!dsExists) {
      dsGate = `\n\nDESIGN SYSTEM FIRST — this project has NO design system yet (no design-system/design-system.json). Before building ANY page, section, or feature, you MUST establish the design system this turn: token-first foundation (color/type/spacing/radii/shadows for light AND dark), the core components, and the living /design-system route — grounded in the user's confirmed design preferences. Only AFTER it exists may you build the requested UI, composing those components. NEVER build product pages on top of a missing design system.`;
    }
  }

  const promptText = `${systemPrompt(manifest, mode)}${context}${skillBlock}${dsGate}\n\nUSER REQUEST:\n${message}`;
  // With attached images, send a structured user message (text + vision image
  // blocks) via an async-iterable prompt; otherwise a plain string prompt.
  const prompt = opts.images?.length
    ? imagePrompt(promptText, opts.images)
    : promptText;

  // Pick the LLM provider from the UI's model choice (DeepSeek / MiMo run on
  // their Anthropic-compatible endpoints via an env swap; Claude is native).
  // Image turns require vision: if the chosen model can't see images and Claude
  // is configured, route this turn to a Claude vision model instead.
  let modelChoice = opts.model;
  if (
    opts.images?.length &&
    !modelHasVision(modelChoice ?? '') &&
    anthropicEnabled()
  ) {
    modelChoice = VISION_MODEL;
    emit({
      type: 'text',
      text: `_Attached image — switching this turn to ${VISION_MODEL} (vision)._`,
    });
  }
  const provider = resolveProvider(modelChoice);
  // Verify which model actually runs (the model can't self-report reliably).
  console.log(
    `[agent] provider=${provider.name} model=${provider.model} endpoint=${
      provider.env?.ANTHROPIC_BASE_URL ?? 'anthropic-native'
    }`,
  );

  const run = query({
    prompt,
    options: {
      mcpServers: { sandbox: server },
      allowedTools: [...tools, 'Skill'],
      disallowedTools: BUILTINS,
      canUseTool: guard,
      // Load vendored skills from our repo's .claude/skills (cwd = server root).
      settingSources: ['project'],
      skills: ['design-taste-frontend'],
      maxTurns: 60,
      // Keep Claude Code's coding system prompt, but append a truthful identity
      // for non-Anthropic models so they don't claim to be Claude.
      ...(provider.identity
        ? {
            systemPrompt: {
              type: 'preset' as const,
              preset: 'claude_code' as const,
              append: provider.identity,
            },
          }
        : {}),
      ...(provider.env ? { env: provider.env } : {}),
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(provider.model ? { model: provider.model } : {}),
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

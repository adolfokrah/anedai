/**
 * The runtime loop: take a loaded AgentSpec + a live sandbox, bind tools to a
 * ToolContext, lower subagents into delegate tools, and drive the AI SDK
 * multi-step loop — streaming text + tool activity as AgentEvents.
 *
 * Same external contract as the claude-agent-sdk path (ChatResult + AgentEvent
 * stream), so the chat route + UI are unchanged.
 */

import {
  type ModelMessage,
  type Tool,
  tool as aiTool,
  hasToolCall,
  stepCountIs,
  streamText,
} from 'ai';

import { anthropicEnabled } from '@/lib/agent/provider';
import {
  type ChatImage,
  type ChatMode,
  type ChatResult,
  extractSummary,
} from '@/lib/agent/run';
import { PROVIDERS, VISION_MODEL, modelHasVision } from '@/lib/models';
import type { Box } from '@/lib/runtime/types';
import { workDir } from '@/lib/seed';
import { getMessages, updateProject } from '@/lib/store';
import type { AgentEvent, ChatTurn, ProjectManifest } from '@/lib/types';
import { z } from 'zod';

import type { ToolContext } from './context';
import type { AgentSpec, SubagentDef, ToolDef } from './define';
import { resolveModel } from './models';

type Emit = (e: AgentEvent) => void;

export interface RunOpts {
  /** Ignored — resume is by replaying persisted messages, not a session id. */
  resume?: string;
  model?: string;
  images?: ChatImage[];
  viewing?: string;
  skill?: string;
  githubToken?: string;
  abortController?: AbortController;
  mode?: ChatMode;
}

function toModelMessages(turns: ChatTurn[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const t of turns) {
    const text = t.text?.trim();
    if (text) out.push({ role: t.role, content: text });
  }
  return out;
}

function pickTarget(input: unknown): string | undefined {
  if (typeof input !== 'object' || !input) return undefined;
  const o = input as Record<string, unknown>;
  const v = o.path ?? o.pattern ?? o.cmd ?? o.command ?? o.message;
  return v ? String(v).slice(0, 120) : undefined;
}

/** Bind tool defs to a context → AI SDK tools (optionally a name subset). */
function bindTools(
  defs: Record<string, ToolDef>,
  ctx: ToolContext,
  names?: string[],
): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const [name, def] of Object.entries(defs)) {
    if (names && !names.includes(name)) continue;
    out[name] = aiTool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: (input: unknown) => def.execute(input, ctx),
    });
  }
  return out;
}

/** Lower each subagent into a `{ message }` delegate tool (Eve's contract). */
function lowerSubagents(
  subs: Record<string, SubagentDef>,
  sharedDefs: Record<string, ToolDef>,
  ctx: ToolContext,
): Record<string, Tool> {
  // Child loops share the parent's sandbox tools, minus ask_user (children
  // don't prompt the user) and the subagent tools themselves.
  const childNames = Object.keys(sharedDefs).filter((n) => n !== 'ask_user');
  const childCtx: ToolContext = { ...ctx, onAsk: undefined };
  const childTools = bindTools(sharedDefs, childCtx, childNames);

  const out: Record<string, Tool> = {};
  for (const [name, sub] of Object.entries(subs)) {
    out[name] = aiTool({
      description: sub.description,
      inputSchema: z.object({ message: z.string() }),
      execute: async ({ message }: { message: string }) => {
        if (sub.run) return sub.run(message, ctx);
        let text = '';
        const r = streamText({
          model: ctx.model,
          system: sub.instructions,
          prompt: message,
          tools: childTools,
          stopWhen: [stepCountIs(Math.max(1, sub.maxSteps ?? 40))],
        });
        for await (const part of r.fullStream) {
          if (part.type === 'text-delta') text += part.text;
          else if (part.type === 'tool-call')
            ctx.emit({
              type: 'tool',
              name: `${name}:${part.toolName}`,
              target: pickTarget(part.input),
            });
          else if (part.type === 'error') {
            // Surface the child's failure to the parent instead of dropping it.
            const e = part.error;
            const detail = e instanceof Error ? e.message : String(e);
            return `${name} failed: ${detail}${text.trim() ? `\n\nPartial output:\n${text.trim()}` : ''}`;
          }
        }
        await r.finishReason;
        return text.trim() || `(${name} finished)`;
      },
    });
  }
  return out;
}

export async function runAgent(
  agent: AgentSpec,
  box: Box,
  manifest: ProjectManifest,
  message: string,
  emit: Emit,
  opts: RunOpts = {},
): Promise<ChatResult> {
  const mode: ChatMode = opts.mode ?? 'build';
  const planning = mode === 'plan';
  const app = await workDir(box, manifest);

  const cmdEnv: Record<string, string> = { ...(manifest.env ?? {}) };
  if (opts.githubToken) {
    cmdEnv.GH_TOKEN = opts.githubToken;
    cmdEnv.GITHUB_TOKEN = opts.githubToken;
  }

  // Image turns need vision: route to a Claude vision model if the choice
  // can't see images and Claude is configured.
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
  const resolved = resolveModel(modelChoice);
  console.log(
    `[agents] provider=${resolved.provider} model=${resolved.modelId}`,
  );

  const ctx: ToolContext = {
    box,
    model: resolved.model,
    app,
    abs: (p) => `${app}/${p.replace(/^\.\//, '').replace(/^\/+/, '')}`,
    env: Object.keys(cmdEnv).length ? cmdEnv : undefined,
    emit,
    manifest,
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
  };

  // Build the toolset. Plan mode = read-only slots only; build mode = all
  // tools + lowered subagents.
  const boundAll = bindTools(agent.tools, ctx);
  const toolset = planning
    ? bindTools(agent.tools, ctx, agent.readonly)
    : {
        ...boundAll,
        ...(agent.subagents
          ? lowerSubagents(agent.subagents, agent.tools, ctx)
          : {}),
      };

  // System prompt: base + per-turn context.
  let system = agent.instructions(manifest, mode);
  if (opts.viewing) {
    system += `\n\nCONTEXT: The user is currently viewing the route \`${opts.viewing}\` in the live preview. If they say "this page", "here", or refer to what's on screen, they mean that route — locate the file that renders it before editing.`;
  }
  if (opts.skill && /^[A-Za-z0-9_-]+$/.test(opts.skill)) {
    const md = await box
      .readFile(`${app}/.claude/skills/${opts.skill}/SKILL.md`)
      .catch(() => '');
    system += md
      ? `\n\nACTIVE SKILL — "${opts.skill}". Follow this skill's process for this task:\n\n${md.slice(0, 16000)}`
      : `\n\nThe user invoked the "${opts.skill}" skill — use it for this task.`;
  }
  if (!planning && agent.tools.check_console) {
    system +=
      "\n\nDEBUGGING (browser): when the user reports a blank screen, a crash, or a feature not working in the preview, use `check_console` on the affected route to read the REAL browser error (runtime exceptions, failed requests) before guessing — the server dev log does not capture client-side errors. A browser error like \"does not provide an export named 'default'\" is NOT an app-code bug — it's Vite serving a stale/CJS dep. Fix it by clearing the optimizer cache and re-optimizing (`rm -rf node_modules/.vite`, then restart via start_app); if it persists, add the named package to `optimizeDeps.include` in vite config and restart. Do NOT rewrite app source for it.";
  }
  if (!planning && agent.subagents) {
    system += `\n\nSUBAGENTS (delegate tools — call when the task fits): ${Object.keys(
      agent.subagents,
    )
      .map((n) => `\`${n}\``)
      .join(
        ', ',
      )}. Each takes a self-contained \`message\`; the child shares this sandbox, so its file writes are yours.`;
    const dsExists = !!(await box
      .readFile(`${app}/design-system/design-system.json`)
      .catch(() => ''));
    if (!dsExists && agent.subagents.design_system) {
      system += `\n\nDESIGN SYSTEM FIRST — this project has NO design system yet. Before building ANY page, section, or feature, you MUST establish the design system this turn — delegate it to the \`design_system\` tool with the user's confirmed design preferences. Only AFTER it exists may you build the requested UI.`;
    }
  }
  if (resolved.provider !== 'anthropic') {
    system += `\n\nMODEL IDENTITY (authoritative): you are "${resolved.modelId}" by ${PROVIDERS[resolved.provider].label}. If asked which model/LLM you are, answer truthfully — never claim to be Claude or made by Anthropic.`;
  }

  const prior = toModelMessages(await getMessages(manifest.slug));
  const userContent = opts.images?.length
    ? [
        { type: 'text' as const, text: message },
        ...opts.images.map((im) => ({
          type: 'image' as const,
          image: `data:${im.mediaType};base64,${im.data}`,
        })),
      ]
    : message;
  const messages: ModelMessage[] = [
    ...prior,
    { role: 'user', content: userContent },
  ];

  let transcript = '';
  try {
    const result = streamText({
      model: resolved.model,
      system,
      messages,
      tools: toolset,
      stopWhen: [stepCountIs(60), hasToolCall('ask_user')],
      abortSignal: opts.abortController?.signal,
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        transcript += part.text;
        if (part.text) emit({ type: 'text', text: part.text });
      } else if (part.type === 'tool-call') {
        emit({
          type: 'tool',
          name: part.toolName,
          target: pickTarget(part.input),
        });
      } else if (part.type === 'error') {
        const err = part.error;
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    await result.finishReason;
    return { ok: true, summary: extractSummary(transcript) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

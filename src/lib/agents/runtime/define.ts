/**
 * The `define*` helpers — the authoring surface for our filesystem-first agent
 * convention (modeled on Eve's defineTool/defineAgent/defineSubagent).
 *
 * These are pure identity functions: they exist for types + a stable import
 * the authored slots target. The runtime (load.ts/run.ts) turns the registries
 * they produce into a live AI SDK agent, binding each tool to a ToolContext.
 *
 * Naming is by PATH, not a field: a file at aned/tools/read_file.ts is the
 * tool `read_file`; a folder aned/subagents/reviewer/ is the subagent
 * `reviewer`. The barrels (index.ts) wire the names.
 */

import type { z } from 'zod';

import type { ProjectManifest } from '@/lib/types';

import type { ToolContext } from './context';

/**
 * Erased tool shape stored in the registry. Authors get full input typing via
 * `defineTool` (inferred from the Zod schema); the stored def erases it so a
 * heterogeneous `Record<string, ToolDef>` type-checks.
 */
export interface ToolDef {
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: unknown, ctx: ToolContext) => Promise<unknown> | unknown;
}

export function defineTool<S extends z.ZodTypeAny>(def: {
  description: string;
  inputSchema: S;
  execute: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown> | unknown;
}): ToolDef {
  return def as unknown as ToolDef;
}

/**
 * A specialist subagent, lowered into a `{ message }` delegate tool. By default
 * it runs a child loop sharing the parent's tools + sandbox (Eve's built-in
 * `agent` behavior). `run` overrides with a custom implementation (e.g. the
 * reviewer's structured `generateObject`). `instructions` is its system prompt.
 */
export interface SubagentDef {
  /** Required — the parent reads this to decide when to delegate. */
  description: string;
  /** Child system prompt. */
  instructions: string;
  /** Child loop step cap (default 40). */
  maxSteps?: number;
  /**
   * Custom executor — bypasses the child loop. Gets the delegate `message` and
   * the parent ToolContext; returns the tool result string.
   */
  run?: (message: string, ctx: ToolContext) => Promise<string>;
}

export function defineSubagent(def: SubagentDef): SubagentDef {
  return def;
}

/** The composed agent the runtime executes. */
export interface AgentSpec {
  /** Default model id (overridden per-turn by the UI pick). */
  model?: string;
  /** Dynamic base system prompt. */
  instructions: (manifest: ProjectManifest, mode: 'build' | 'plan') => string;
  /** Tool slots, keyed by name (from the tools/ barrel). */
  tools: Record<string, ToolDef>;
  /** Tool names that are safe in plan mode (read-only). */
  readonly: string[];
  /** Specialist subagents, keyed by name (from the subagents/ barrel). */
  subagents?: Record<string, SubagentDef>;
}

export function defineAgent(spec: AgentSpec): AgentSpec {
  return spec;
}

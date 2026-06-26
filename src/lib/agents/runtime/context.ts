/**
 * ToolContext — the per-request accessors every tool's `execute` receives
 * (our equivalent of Eve's `ctx`). Built once per turn in runtime/run.ts and
 * injected into each tool; carries the live Daytona box + the chat emitter.
 */

import type { LanguageModel } from 'ai';

import type { Box } from '@/lib/runtime/types';
import type { AgentEvent, AskQuestion, ProjectManifest } from '@/lib/types';

export interface ToolContext {
  /** Live sandbox for this project/turn. */
  box: Box;
  /** The resolved model for this turn (subagents/child loops reuse it). */
  model: LanguageModel;
  /** Absolute app directory inside the sandbox. */
  app: string;
  /** Resolve an agent-relative path against the app root. */
  abs: (p: string) => string;
  /** Env injected into run_cmd/start_app (e.g. GH_TOKEN). */
  env?: Record<string, string>;
  /** Stream an event to the chat (text/tool/preview/questions). */
  emit: (e: AgentEvent) => void;
  /** The project record. */
  manifest: ProjectManifest;
  /** Present a question form + end the turn (ask_user). */
  onAsk?: (questions: AskQuestion[]) => void;
  /**
   * Wire the preview when start_app launches a server. `role`: 'app' →
   * previewUrl/devPort (Pages tab); 'docs' → docsPreviewUrl/docsPort (DS tab);
   * 'backend' → backendUrl/backendPort (no tab; the frontend calls it).
   */
  onStartApp?: (port: number, role?: 'app' | 'docs' | 'backend') => void;
}

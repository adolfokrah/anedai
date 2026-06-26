/**
 * Public entry for the AI SDK agent engine. Binds the runtime loop to the
 * authored Aned agent. The chat route calls this when AGENT_ENGINE=aisdk.
 */

import type { ChatResult } from '@/lib/agent/run';
import type { Box } from '@/lib/runtime/types';
import type { AgentEvent, ProjectManifest } from '@/lib/types';

import { aned } from './aned/agent';
import { type RunOpts, runAgent } from './runtime/run';

export function runProjectChatAISDK(
  box: Box,
  manifest: ProjectManifest,
  message: string,
  emit: (e: AgentEvent) => void,
  opts: RunOpts = {},
): Promise<ChatResult> {
  return runAgent(aned, box, manifest, message, emit, opts);
}

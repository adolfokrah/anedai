/**
 * Base system prompt for the Aned agent. Reuses the canonical builder so the
 * two engines never diverge. The runtime appends per-turn context (viewing
 * route, active skill, design-system gate, subagent note, identity).
 */

export { systemPrompt as instructions } from '@/lib/agent/run';

/**
 * Subagent slot barrel — name = directory (the Eve path-naming rule). Add a
 * folder under subagents/ with an agent.ts, then one line here.
 */

import type { SubagentDef } from '../../runtime/define';

import bringup from './bringup/agent';
import design_system from './design_system/agent';
import reviewer from './reviewer/agent';

export const subagents: Record<string, SubagentDef> = {
  bringup,
  design_system,
  reviewer,
};

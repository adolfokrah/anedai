/**
 * The Aned agent — composed from its authored slots. This is the single object
 * the runtime executes (runtime/run.ts). Identity of each tool/subagent comes
 * from its file/folder name via the barrels.
 */

import { defineAgent } from '../runtime/define';
import { instructions } from './instructions';
import { subagents } from './subagents';
import { READONLY, tools } from './tools';

export const aned = defineAgent({
  instructions,
  tools,
  readonly: READONLY,
  subagents,
});

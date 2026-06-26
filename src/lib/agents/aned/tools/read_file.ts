import { z } from 'zod';

import { defineTool } from '../../runtime/define';
import { clip, msg } from '../lib/util';

export default defineTool({
  description:
    'Read a file from the app, relative to the app root (e.g. "src/App.tsx").',
  inputSchema: z.object({ path: z.string() }),
  execute: async ({ path }, ctx) => {
    try {
      return clip(await ctx.box.readFile(ctx.abs(path)));
    } catch (e) {
      return `read failed: ${msg(e)}`;
    }
  },
});

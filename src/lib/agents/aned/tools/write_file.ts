import { z } from 'zod';

import { defineTool } from '../../runtime/define';
import { msg } from '../lib/util';

export default defineTool({
  description:
    'Create or overwrite a file with full contents. Path is relative to the app root.',
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  execute: async ({ path, content }, ctx) => {
    try {
      await ctx.box.writeFile(ctx.abs(path), content);
      return `wrote ${path}`;
    } catch (e) {
      return `write failed: ${msg(e)}`;
    }
  },
});

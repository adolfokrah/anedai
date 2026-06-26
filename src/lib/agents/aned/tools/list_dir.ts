import { z } from 'zod';

import { defineTool } from '../../runtime/define';
import { msg } from '../lib/util';

export default defineTool({
  description:
    'List entries in a directory, relative to the app root (default ".").',
  inputSchema: z.object({ path: z.string().optional() }),
  execute: async ({ path }, ctx) => {
    try {
      const entries = await ctx.box.listDir(ctx.abs(path ?? '.'));
      return (
        entries
          .map((e) => (e.isDir ? `${e.name}/` : e.name))
          .sort()
          .join('\n') || '(empty)'
      );
    } catch (e) {
      return `list failed: ${msg(e)}`;
    }
  },
});

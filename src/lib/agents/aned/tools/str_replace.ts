import { z } from 'zod';

import { defineTool } from '../../runtime/define';
import { msg } from '../lib/util';

export default defineTool({
  description:
    'Replace an exact, unique substring in a file. `old` must occur exactly once.',
  inputSchema: z.object({
    path: z.string(),
    old: z.string(),
    new: z.string(),
  }),
  execute: async ({ path, old, new: next }, ctx) => {
    try {
      const cur = await ctx.box.readFile(ctx.abs(path));
      const count = cur.split(old).length - 1;
      if (count === 0) return `"old" not found in ${path}`;
      if (count > 1) return `"old" is not unique in ${path} (${count} matches)`;
      await ctx.box.writeFile(ctx.abs(path), cur.replace(old, next));
      return `edited ${path}`;
    } catch (e) {
      return `edit failed: ${msg(e)}`;
    }
  },
});

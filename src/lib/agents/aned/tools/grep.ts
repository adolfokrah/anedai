import { z } from 'zod';

import { defineTool } from '../../runtime/define';
import { clip, shellArg } from '../lib/util';

export default defineTool({
  description:
    'Search file contents with a regex across the app (ripgrep-style).',
  inputSchema: z.object({ pattern: z.string(), glob: z.string().optional() }),
  execute: async ({ pattern, glob }, ctx) => {
    const inc = glob ? `--include=${shellArg(glob)}` : '';
    const r = await ctx.box.exec(
      `grep -rnI ${inc} -e ${shellArg(pattern)} . | head -200 || true`,
      { cwd: ctx.app, timeoutMs: 20_000 },
    );
    return clip(r.stdout || '(no matches)');
  },
});

import { z } from 'zod';

import { defineTool } from '../../runtime/define';
import { clip } from '../lib/util';

export default defineTool({
  description:
    'Run a shell command in the app directory (install deps, run a build, git, etc.). Avoid starting long-lived servers (use start_app). Long ops like clone/install are fine — up to ~5 min.',
  inputSchema: z.object({ cmd: z.string() }),
  execute: async ({ cmd }, ctx) => {
    const r = await ctx.box.exec(cmd, {
      cwd: ctx.app,
      timeoutMs: 300_000,
      env: ctx.env,
    });
    const out = [r.stdout, r.stderr].filter(Boolean).join('\n');
    return clip(`exit ${r.exitCode}\n${out}`);
  },
});

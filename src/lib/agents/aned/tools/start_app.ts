import { z } from 'zod';

import { defineTool } from '../../runtime/define';
import { msg } from '../lib/util';

const LOG_FILE = '.aned-dev.log';

export default defineTool({
  description:
    "Start a server DETACHED so it keeps running. Use this (not run_cmd &) to launch a server. Pass the command, the port it listens on, and the role: 'app' = the main project (default, Pages tab); 'docs' = a separate design-system/docs/Storybook server (DS tab); 'backend' = a separate API/backend server (no tab — point the frontend at the returned URL). Returns the public preview URL — record it in anedai.json.",
  inputSchema: z.object({
    command: z.string(),
    port: z.number(),
    role: z.enum(['app', 'docs', 'backend']).optional(),
  }),
  execute: async ({ command, port, role }, ctx) => {
    try {
      // Vite caches a pre-bundled copy of deps in node_modules/.vite. After the
      // agent installs a package mid-session that cache goes stale, and CJS deps
      // (e.g. void-elements) get served un-wrapped → "does not provide an export
      // named 'default'" in the browser. Clearing it forces a clean re-optimize
      // on (re)start, which fixes that whole class of error.
      if (/\bvite\b/.test(command)) {
        await ctx.box
          .exec('rm -rf node_modules/.vite', { cwd: ctx.app, env: ctx.env })
          .catch(() => {});
      }
      const log =
        role === 'docs'
          ? '.aned-docs.log'
          : role === 'backend'
            ? '.aned-backend.log'
            : LOG_FILE;
      await ctx.box.exec(`${command} > ${ctx.app}/${log} 2>&1`, {
        cwd: ctx.app,
        background: true,
        env: ctx.env,
      });
      ctx.onStartApp?.(port, role ?? 'app');
      const url = await ctx.box.previewUrl(port).catch(() => null);
      const tag =
        role === 'docs'
          ? ' (docs/design-system server)'
          : role === 'backend'
            ? ' (backend/API server — point the frontend at this URL)'
            : '';
      return `started on :${port}${url ? ` → ${url}` : ''}${tag} (logs: ${log}). Verify: curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}. Record this full URL in anedai.json.`;
    } catch (e) {
      return `start failed: ${msg(e)}`;
    }
  },
});

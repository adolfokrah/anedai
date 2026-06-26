import { z } from 'zod';

import { defineTool } from '../../runtime/define';
import { captureConsole } from '../lib/browser';
import { clip, msg } from '../lib/util';

export default defineTool({
  description:
    "Load a route of the running preview in a headless browser and report the BROWSER console — console errors/warnings/logs, uncaught runtime errors, and failed network requests. Use this to debug client-side problems (blank screen, a React crash, a feature not working) that the server dev log (.aned-dev.log) does NOT show. Defaults to '/'.",
  inputSchema: z.object({
    path: z
      .string()
      .optional()
      .describe('Route to load, e.g. "/" or "/pricing". Default "/".'),
    waitMs: z
      .number()
      .optional()
      .describe('Settle time after load for runtime errors (default 2500).'),
  }),
  execute: async ({ path, waitMs }, ctx) => {
    const base = ctx.manifest.previewUrl;
    if (!base)
      return 'The app is not running yet (no preview URL). Start it with start_app, then check again.';

    let url: string;
    try {
      url = new URL(path ?? '/', base).toString();
    } catch {
      url = base;
    }

    try {
      const r = await captureConsole(url, waitMs ?? 2500);
      const out: string[] = [`Loaded ${url}`];
      if (r.loadError) out.push(`PAGE FAILED TO LOAD: ${r.loadError}`);

      if (r.pageErrors.length)
        out.push(
          `UNCAUGHT ERRORS (${r.pageErrors.length}):\n${r.pageErrors.join('\n---\n')}`,
        );

      const problems = r.logs.filter(
        (l) => l.type === 'error' || l.type === 'warning',
      );
      if (problems.length)
        out.push(
          `CONSOLE ${problems.length} error/warning:\n${problems
            .map((l) => `[${l.type}] ${l.text}`)
            .join('\n')}`,
        );

      if (r.failed.length)
        out.push(
          `FAILED REQUESTS (${r.failed.length}):\n${r.failed
            .map((f) => `${f.url} — ${f.reason}`)
            .join('\n')}`,
        );

      if (
        !r.loadError &&
        !r.pageErrors.length &&
        !problems.length &&
        !r.failed.length
      )
        out.push(
          `Clean — no errors, warnings, or failed requests (${r.logs.length} console logs total).`,
        );

      return clip(out.join('\n\n'));
    } catch (e) {
      return `console check failed: ${msg(e)} (is Chromium installed for Playwright?)`;
    }
  },
});

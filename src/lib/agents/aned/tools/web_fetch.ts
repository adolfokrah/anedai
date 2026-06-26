import { z } from 'zod';

import { defineTool } from '../../runtime/define';
import { blockedUrl, clip, msg, stripHtml } from '../lib/util';

export default defineTool({
  description:
    'Fetch a public URL (docs, an API, a reference page) and return its text content. HTML is reduced to readable text.',
  inputSchema: z.object({ url: z.string() }),
  execute: async ({ url }) => {
    const blocked = blockedUrl(url);
    if (blocked) return blocked;
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'AnedAgent/1.0' },
        signal: AbortSignal.timeout(20_000),
      });
      const ct = res.headers.get('content-type') ?? '';
      const raw = await res.text();
      const body = ct.includes('html') ? stripHtml(raw) : raw;
      return clip(`(${res.status} ${ct})\n${body}`);
    } catch (e) {
      return `fetch failed: ${msg(e)}`;
    }
  },
});

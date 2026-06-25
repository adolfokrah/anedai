/**
 * NDJSON streaming for route handlers. Each AgentEvent is written as one JSON
 * line; the browser client splits on newlines (mirrors the old streamAgent).
 * Simpler than SSE framing and matches the existing client parser shape.
 */

import type { AgentEvent } from './types';

/** A function that pushes events; resolves/rejects to end the stream. */
export type Producer = (emit: (e: AgentEvent) => void) => Promise<void>;

export function ndjsonResponse(produce: Producer): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      };
      try {
        await produce(emit);
      } catch (err) {
        emit({
          type: 'log',
          line: `stream error: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

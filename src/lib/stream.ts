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
  // The producer (seed/restart/chat) can run far longer than the client keeps
  // the connection open. If the client disconnects, the controller closes and
  // any further enqueue throws — swallow it so the producer finishes (e.g. seed
  // still completes + persists the manifest) instead of crashing.
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          closed = true; // client gone
        }
      };
      // Heartbeat: agent steps (npm install, a compile) can run for a minute+
      // with no events. Without traffic an idle proxy/connection drops the
      // stream → the client sees a "network error". A blank line every 10s
      // keeps it warm; the client's parser ignores empty lines.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode('\n'));
        } catch {
          closed = true;
        }
      }, 10_000);
      try {
        await produce(emit);
      } catch (err) {
        emit({
          type: 'log',
          line: `stream error: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
    cancel() {
      closed = true; // client disconnected
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable proxy/dev-server buffering so chunks (and heartbeats) flush.
      'x-accel-buffering': 'no',
    },
  });
}

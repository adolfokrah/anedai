/**
 * Reconnect to a project's running sandbox between requests. The sandbox id is
 * the durable handle; we re-attach and refresh its idle timeout. If the box has
 * expired, callers re-seed (Phase 5) — for now we surface a clear error.
 */

import { runtime } from '@/lib/runtime';
import type { Box } from '@/lib/runtime/types';
import type { ProjectManifest } from '@/lib/types';

const KEEPALIVE_MS = 60 * 60 * 1000;

export async function connectBox(manifest: ProjectManifest): Promise<Box> {
  if (!manifest.sandboxId) {
    throw new Error('project sandbox not started — seed it first');
  }
  const box = await runtime.connect(manifest.sandboxId);
  await box.keepAlive(KEEPALIVE_MS).catch(() => {});
  return box;
}

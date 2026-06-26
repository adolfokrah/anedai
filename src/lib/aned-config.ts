/**
 * `anedai.json` — the project's runtime wiring at the app root, maintained by
 * the agent. It tells Aned which servers run where so the workspace tabs hit
 * the right ports:
 *
 *   {
 *     "app":          { "port": 3500, "route": "https://3500-….eu/" },
 *     "designSystem": { "port": 3000, "route": "https://3000-….eu/docs" },
 *     "install": "pnpm install"
 *   }
 *
 * `route` is ALWAYS a FULL https URL (the agent writes it from what start_app
 * returns) — never a relative path. The only exception is the scaffold pre-seed,
 * which writes `port` ONLY (no route) before the public URL exists; the resolver
 * then derives the URL from the port.
 *
 * `designSystem` covers two shapes, both with a full-URL `route`:
 *  - SEPARATE server (e.g. Storybook on its own port): its own `port` + URL.
 *  - SAME app, exposed route: the app's `port` + the full URL to that route
 *    (e.g. "https://3000-….eu/docs").
 * Omit `designSystem` entirely only when there's no design-system view.
 */

import type { Box } from '@/lib/runtime/types';

/** Filename at the app root. */
export const ANED_CONFIG_FILE = 'anedai.json';

export interface AnedServer {
  /** Port the server listens on inside the sandbox. */
  port?: number;
  /** Full https preview URL (always absolute, never a relative path). */
  route?: string;
  /** Dev command (informational; helps the agent restart consistently). */
  devCommand?: string;
  /** Detected framework (vite/next/astro/storybook…). */
  framework?: string;
}

export interface AnedConfig {
  app?: AnedServer;
  designSystem?: AnedServer;
  /** Optional backend/API server (monorepo), when the user opted to run it. */
  backend?: AnedServer;
  /** Install command for the project. */
  install?: string;
}

/** Resolved wiring derived from anedai.json (public URLs + ports). */
export interface ResolvedAnedConfig {
  previewUrl?: string;
  devPort?: number;
  docsPreviewUrl?: string;
  docsPort?: number;
  backendUrl?: string;
  backendPort?: number;
}

function isUrl(s?: string): boolean {
  return !!s && /^https?:\/\//.test(s);
}

/**
 * Resolve one server entry to a full public URL. `route` must be a FULL https
 * URL (the agent writes it from what start_app returns) — used as-is. A relative
 * route is rejected; we fall back to resolving the bare `port` instead (used
 * only by the scaffold pre-seed, which writes port-only before the public URL
 * exists). We never build URLs by joining a base + a relative path.
 */
async function resolveUrl(
  box: Box,
  entry?: AnedServer,
): Promise<string | undefined> {
  if (!entry) return undefined;
  if (isUrl(entry.route)) return entry.route;
  if (entry.port)
    return (
      (await box.previewUrl(entry.port).catch(() => undefined)) || undefined
    );
  return undefined;
}

/** Read + parse anedai.json from the app dir (null if absent/invalid). */
export async function readAnedConfig(
  box: Box,
  app: string,
): Promise<AnedConfig | null> {
  const raw = await box.readFile(`${app}/${ANED_CONFIG_FILE}`).catch(() => '');
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as AnedConfig;
  } catch {
    return null;
  }
}

/**
 * Read anedai.json and resolve it to manifest-shaped tab wiring (public URLs +
 * ports). Returns an empty object when the file is absent — callers patch the
 * manifest with whatever fields resolved.
 */
export async function resolveAnedConfig(
  box: Box,
  app: string,
): Promise<ResolvedAnedConfig> {
  const cfg = await readAnedConfig(box, app);
  if (!cfg) return {};
  const out: ResolvedAnedConfig = {};

  const appUrl = await resolveUrl(box, cfg.app);
  if (appUrl) out.previewUrl = appUrl;
  if (cfg.app?.port) out.devPort = cfg.app.port;

  // The design system tab is driven entirely by the `designSystem` entry when
  // present — works for BOTH cases, always via a full-URL `route`:
  //  - SEPARATE server: its own port (e.g. Storybook on 6006) + full URL.
  //  - SAME app, exposed route: the app's port + the full URL to that route.
  // Either way we produce one full docsPreviewUrl; the DS tab serves it.
  const ds = cfg.designSystem;
  if (ds?.route || ds?.port) {
    const port = ds.port ?? cfg.app?.port;
    const dsUrl = await resolveUrl(box, { ...ds, port });
    if (dsUrl) out.docsPreviewUrl = dsUrl;
    if (port) out.docsPort = port;
  }

  // Optional backend — no tab; the frontend calls it at this URL.
  const be = cfg.backend;
  if (be?.route || be?.port) {
    const beUrl = await resolveUrl(box, be);
    if (beUrl) out.backendUrl = beUrl;
    if (be.port) out.backendPort = be.port;
  }
  return out;
}

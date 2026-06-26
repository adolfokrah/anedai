/**
 * Model + provider registry for the build agent.
 *
 * The Claude Agent SDK drives the Claude Code CLI, which speaks the Anthropic
 * Messages API. Every provider here exposes an Anthropic-COMPATIBLE endpoint,
 * so we run the same agent against any of them by pointing the CLI's env at the
 * provider's base URL (see lib/agent/provider.ts) — no SDK swap, no proxy.
 *
 * This module is import-safe on the client (pure data + pure helpers). Anything
 * that reads API keys from the environment lives in provider.ts (server only).
 */

export type ProviderId = 'anthropic' | 'deepseek' | 'mimo';

export interface Provider {
  id: ProviderId;
  label: string;
  /** Env var holding the provider's API key (drives availability). */
  authEnv: string;
  /** Anthropic-compatible base URL. Undefined = native Anthropic API. */
  baseUrl?: string;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  anthropic: {
    id: 'anthropic',
    label: 'Claude',
    authEnv: 'ANTHROPIC_API_KEY',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    authEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/anthropic',
  },
  mimo: {
    id: 'mimo',
    label: 'MiMo (Xiaomi)',
    authEnv: 'MIMO_API_KEY',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
  },
};

export interface Model {
  /** The model string the endpoint expects (also the unique select id). */
  id: string;
  provider: ProviderId;
  label: string;
  /** Accepts image input. Only vision models may receive attachments. */
  vision?: boolean;
}

export const MODELS: Model[] = [
  {
    id: 'claude-opus-4-8',
    provider: 'anthropic',
    label: 'Opus 4.8',
    vision: true,
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    label: 'Sonnet 4.6',
    vision: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    label: 'Haiku 4.5',
    vision: true,
  },
  { id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek V3' },
  { id: 'deepseek-reasoner', provider: 'deepseek', label: 'DeepSeek R1' },
  { id: 'mimo-v2.5-pro', provider: 'mimo', label: 'MiMo v2.5 Pro' },
];

/**
 * Providers turned OFF for now — their key may be configured, but their models
 * show as "unavailable" in the picker, aren't selectable, and are never the
 * default. Flip by editing this list. (Claude paused for now.)
 */
export const DISABLED_PROVIDERS: ProviderId[] = ['anthropic'];

export function isProviderDisabled(id: ProviderId): boolean {
  return DISABLED_PROVIDERS.includes(id);
}

/** Provider priority for the default model when several keys are configured. */
export const PROVIDER_PRIORITY: ProviderId[] = [
  'anthropic',
  'deepseek',
  'mimo',
];

/** The model picked first within each provider (the provider's default). */
export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-4-6',
  deepseek: 'deepseek-chat',
  mimo: 'mimo-v2.5-pro',
};

/** A Claude vision model — turns with image attachments are routed here. */
export const VISION_MODEL = 'claude-sonnet-4-6';

/**
 * Static fallback for client initial state before /api/models resolves the
 * real, key-derived default. Not authoritative — the fetch overrides it.
 */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** A model plus whether it's currently selectable (false = disabled provider). */
export type AvailableModel = Model & { available?: boolean };

export function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

export function modelById(id: string): Model | undefined {
  return MODELS.find((m) => m.id === id);
}

export function providerForModel(id: string): Provider | undefined {
  const m = modelById(id);
  return m ? PROVIDERS[m.provider] : undefined;
}

export function modelHasVision(id: string): boolean {
  return !!modelById(id)?.vision;
}

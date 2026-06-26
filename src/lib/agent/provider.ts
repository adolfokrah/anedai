/**
 * Agent LLM provider selection (SERVER ONLY — reads API keys from env).
 *
 * The Claude Agent SDK drives the Claude Code CLI, which speaks the Anthropic
 * Messages API. Each provider in the registry exposes an Anthropic-compatible
 * endpoint, so we run the same agent against any of them by pointing the CLI's
 * env at the provider's base URL (ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN +
 * ANTHROPIC_MODEL). Native Anthropic needs no swap.
 *
 * Availability is auto-derived from which `*_API_KEY` vars are set.
 */

import {
  DEFAULT_MODEL_BY_PROVIDER,
  MODELS,
  type Model,
  PROVIDERS,
  PROVIDER_PRIORITY,
  type ProviderId,
  isProviderDisabled,
  modelById,
} from '@/lib/models';

/** Provider ids whose API key is set (regardless of the disabled list). */
export function configuredProviders(): ProviderId[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).filter(
    (id) => !!process.env[PROVIDERS[id].authEnv],
  );
}

/**
 * Provider ids that are usable: key configured AND not in DISABLED_PROVIDERS.
 * Drives the default + model resolution (a disabled provider never runs).
 */
export function enabledProviders(): ProviderId[] {
  return configuredProviders().filter((id) => !isProviderDisabled(id));
}

/** Configured models tagged with whether they're selectable (not disabled). */
export function configuredModels(): (Model & { available: boolean })[] {
  const configured = new Set(configuredProviders());
  return MODELS.filter((m) => configured.has(m.provider)).map((m) => ({
    ...m,
    available: !isProviderDisabled(m.provider),
  }));
}

/** Models the user may actually pick — configured AND enabled. */
export function availableModels(): Model[] {
  const on = new Set(enabledProviders());
  return MODELS.filter((m) => on.has(m.provider));
}

/** Whether Claude is usable (configured AND not disabled) — gates image turns. */
export function anthropicEnabled(): boolean {
  return (
    !!process.env[PROVIDERS.anthropic.authEnv] &&
    !isProviderDisabled('anthropic')
  );
}

/**
 * The default model for new projects: the highest-priority configured provider
 * (Claude → DeepSeek → MiMo), or Claude's default as a last resort.
 */
export function defaultModel(): string {
  const on = new Set(enabledProviders());
  for (const p of PROVIDER_PRIORITY) {
    if (on.has(p)) return DEFAULT_MODEL_BY_PROVIDER[p];
  }
  return DEFAULT_MODEL_BY_PROVIDER.anthropic;
}

export interface ProviderConfig {
  name: ProviderId;
  /** Model string to force on the SDK. */
  model: string;
  /** Replaces the CLI subprocess env (spread over process.env). Undefined = inherit. */
  env?: Record<string, string | undefined>;
  /**
   * Identity correction appended to the claude_code system prompt. The SDK's
   * default prompt says "You are Claude Code", so a non-Anthropic model would
   * wrongly claim to be Claude. Undefined for native Anthropic (no correction).
   */
  identity?: string;
}

/** Truthful identity line for a non-Anthropic model running on our harness. */
function identityNote(name: ProviderId, model: string): string | undefined {
  if (name === 'anthropic') return undefined;
  const vendor = PROVIDERS[name].label;
  return `\n\nMODEL IDENTITY (authoritative — overrides any earlier claim): The underlying language model answering here is "${model}" by ${vendor}. The "Claude Code" harness is only the client software wrapping you; it is NOT your identity. If the user asks which model or LLM you are, answer truthfully that you are ${model} (${vendor}). Never claim to be Claude, Anthropic, or any other vendor's model.`;
}

/**
 * Resolve which LLM the agent runs on for a given UI model choice.
 *
 * Falls back to {@link defaultModel} when the requested model is unknown or its
 * provider isn't configured. Native Anthropic returns no env (the SDK uses the
 * ambient ANTHROPIC_API_KEY); compatible providers get the base-URL env swap.
 */
export function resolveProvider(uiModel?: string): ProviderConfig {
  const on = new Set(enabledProviders());

  // Honor the UI choice only if its provider is configured; else fall back.
  const requested = uiModel ? modelById(uiModel) : undefined;
  const wanted =
    requested && on.has(requested.provider) ? requested.id : defaultModel();

  const m = modelById(wanted);
  // Unknown model id (e.g. registry drift) — pass it straight to the SDK on
  // native Anthropic and let the API reject it with a clear error.
  if (!m) return { name: 'anthropic', model: wanted };

  const provider = PROVIDERS[m.provider];
  const key = process.env[provider.authEnv];

  // Native Anthropic, or a compatible provider whose key is somehow missing:
  // no env swap (the SDK falls back to ambient ANTHROPIC_API_KEY).
  if (!provider.baseUrl || !key) {
    return {
      name: m.provider,
      model: m.id,
      identity: identityNote(m.provider, m.id),
    };
  }

  return {
    name: m.provider,
    model: m.id,
    identity: identityNote(m.provider, m.id),
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: provider.baseUrl,
      ANTHROPIC_AUTH_TOKEN: key,
      // Some CLI paths read API_KEY rather than AUTH_TOKEN — set both.
      ANTHROPIC_API_KEY: key,
      ANTHROPIC_MODEL: m.id,
      ANTHROPIC_SMALL_FAST_MODEL: m.id,
    },
  };
}

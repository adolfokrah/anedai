/**
 * Map a UI model id to a concrete AI SDK language model. In-process provider
 * selection (no env swap): Anthropic + DeepSeek native; MiMo via the Anthropic
 * provider with Xiaomi's Anthropic-compatible baseURL.
 *
 * Availability + default come from the shared registry helpers (provider.ts),
 * which /api/models also uses — so the picker and this resolver agree.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import type { LanguageModel } from 'ai';

import { defaultModel, enabledProviders } from '@/lib/agent/provider';
import { PROVIDERS, type ProviderId, modelById } from '@/lib/models';

export interface ResolvedModel {
  model: LanguageModel;
  modelId: string;
  provider: ProviderId;
}

function build(modelId: string, provider: ProviderId): LanguageModel {
  const key = process.env[PROVIDERS[provider].authEnv] ?? '';
  switch (provider) {
    case 'deepseek':
      return createDeepSeek({ apiKey: key })(modelId);
    case 'mimo':
      return createAnthropic({
        apiKey: key,
        baseURL: `${PROVIDERS.mimo.baseUrl}/v1`,
      })(modelId);
    default:
      return createAnthropic({ apiKey: key })(modelId);
  }
}

export function resolveModel(uiModel?: string): ResolvedModel {
  const on = new Set(enabledProviders());
  const requested = uiModel ? modelById(uiModel) : undefined;
  const id =
    requested && on.has(requested.provider) ? requested.id : defaultModel();
  const m = modelById(id);
  const provider = m?.provider ?? 'anthropic';
  return { model: build(id, provider), modelId: id, provider };
}

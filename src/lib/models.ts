/** Models selectable for the build agent. id = Agent SDK model string. */
export const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

// Default to Sonnet — much faster than Opus, strong enough for rebuild/compose.
// Users can switch to Opus for the hardest work via the model selector.
export const DEFAULT_MODEL: ModelId = 'claude-sonnet-4-6';

export function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

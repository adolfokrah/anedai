'use client';

import { useEffect, useState } from 'react';

import { type AvailableModel, MODELS } from '@/lib/models';

interface ModelsResponse {
  models: AvailableModel[];
  default: string;
}

/**
 * Fetch the models the server has keys for, each tagged `available` (disabled
 * providers come back available:false → shown greyed). API keys are
 * server-secret, so availability can't be derived on the client. Falls back to
 * the full static list (all available) until the fetch resolves.
 */
export function useModels(): {
  models: AvailableModel[];
  defaultModel?: string;
} {
  const [data, setData] = useState<ModelsResponse | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ModelsResponse | null) => {
        if (live && d?.models?.length) setData(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return {
    models: data?.models ?? MODELS,
    defaultModel: data?.default,
  };
}

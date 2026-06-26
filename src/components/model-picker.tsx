'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  type AvailableModel,
  MODELS,
  PROVIDERS,
  type ProviderId,
  modelLabel,
} from '@/lib/models';

/** Shared model selector (popover) used on the landing + workspace composer. */
export function ModelPicker({
  model,
  setModel,
  models = MODELS,
  disabled,
}: {
  model: string;
  setModel: (m: string) => void;
  /** Models to offer (with `available`) — pass the list from useModels(). */
  models?: AvailableModel[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Group by provider, preserving registry order, so the menu reads
  // "Claude / DeepSeek / MiMo" with their models beneath each.
  const groups: { provider: ProviderId; items: AvailableModel[] }[] = [];
  for (const m of models) {
    let g = groups.find((x) => x.provider === m.provider);
    if (!g) {
      g = { provider: m.provider, items: [] };
      groups.push(g);
    }
    g.items.push(m);
  }
  const multiProvider = groups.length > 1;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          className='flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
        >
          {modelLabel(model)}
          <ChevronsUpDown className='size-3 opacity-60' />
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-56 p-1'>
        {groups.map((g) => (
          <div key={g.provider}>
            {multiProvider && (
              <div className='px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
                {PROVIDERS[g.provider].label}
              </div>
            )}
            {g.items.map((m) => {
              const unavailable = m.available === false;
              return (
                <button
                  key={m.id}
                  type='button'
                  disabled={unavailable}
                  onClick={() => {
                    if (unavailable) return;
                    setModel(m.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    unavailable
                      ? 'cursor-not-allowed text-muted-foreground/50'
                      : `hover:bg-muted ${m.id === model ? 'text-foreground' : 'text-muted-foreground'}`
                  }`}
                >
                  {m.id === model && !unavailable ? (
                    <Check className='size-3 shrink-0' />
                  ) : (
                    <span className='size-3 shrink-0' />
                  )}
                  <span className='flex-1'>{m.label}</span>
                  {unavailable && (
                    <span className='text-[10px] text-muted-foreground/50'>
                      unavailable
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

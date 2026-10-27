'use client';

import { useEffect, useState } from 'react';
import { ChevronDownIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { ModelEffortPickerProps, ModelRef } from '../pi-chat/config';
import { useChatText } from '../pi-chat/labels';

interface Choice { readonly section: 'model' | 'effort'; readonly value: string; readonly label: string; readonly detail?: string }

const key = (model: ModelRef) => `${model.provider}/${model.modelId}`;

/**
 * One pill for the model and the thinking level ("GPT-5 mini · Medium") that opens the host's shadcn dropdown menu with a radio
 * group for each. Only the configured parts show; with neither there is no pill.
 */
export function ModelEffortPicker({ model, effort, currentModel, currentEffort, disabled, busy, onModel, onEffort }: ModelEffortPickerProps) {
  const { labels } = useChatText();
  const name = labels.effortName;
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the menu closes when the picker becomes disabled (a run starts), once per change
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const models: Choice[] = (model?.options ?? []).map(option => ({ section: 'model', value: key(option), label: option.label ?? option.modelId, detail: option.provider }));
  // A model or level outside the offered list is still shown, so the label never lies about what runs.
  if (model && currentModel && !models.some(choice => choice.value === key(currentModel))) models.unshift({ section: 'model', value: key(currentModel), label: currentModel.modelId, detail: currentModel.provider });
  const levels: Choice[] = (effort?.options ?? []).map(level => ({ section: 'effort', value: level, label: name(level), ...(labels.effortDetail(level) ? { detail: labels.effortDetail(level)! } : {}) }));
  if (effort && currentEffort && !levels.some(choice => choice.value === currentEffort)) levels.unshift({ section: 'effort', value: currentEffort, label: name(currentEffort) });
  if (!models.length && !levels.length) return null;
  const modelValue = currentModel ? key(currentModel) : '';

  const pickModel = (value: string) => {
    const option = model?.options.find(item => key(item) === value);
    if (option && value !== modelValue) onModel({ provider: option.provider, modelId: option.modelId });
  };
  const modelLabel = model ? models.find(choice => choice.value === modelValue)?.label || currentModel?.modelId || labels.model : undefined;
  const effortLabel = effort ? currentEffort ? name(currentEffort) : labels.effortDefault : undefined;
  const summary = [modelLabel, effortLabel].filter(Boolean).join(' · ');
  const description = labels.modelSummary(modelLabel, effortLabel);
  const section = (title: string, items: readonly Choice[], value: string, pick: (value: string) => void) => items.length > 0 && <DropdownMenuGroup>
    <DropdownMenuLabel>{title}</DropdownMenuLabel>
    <DropdownMenuRadioGroup value={value} onValueChange={next => pick(String(next))}>
      {items.map(choice => <DropdownMenuRadioItem key={choice.value} value={choice.value} data-testid={`composer-${choice.section}-option`} data-value={choice.value} closeOnClick className="max-sm:min-h-11 pointer-coarse:min-h-11">
        <span className="flex min-w-0 flex-1 flex-col"><span className="truncate">{choice.label}</span>
          {choice.detail && <span className="truncate text-xs text-muted-foreground">{choice.detail}</span>}</span>
      </DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup>
  </DropdownMenuGroup>;
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <div className="min-w-0 max-w-[65%] shrink @max-[480px]/composer:max-w-20">
      <DropdownMenuTrigger render={<Button variant="ghost" />} data-testid="composer-model" data-value={modelValue} data-effort={currentEffort ?? ''} disabled={disabled} aria-label={description} title={description} className="min-w-0 max-w-full">
        {busy && <Loader2Icon data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        <span data-testid="composer-model-label" className="min-w-0 truncate">{summary}</span>
        <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
      </DropdownMenuTrigger>
    </div>
    <DropdownMenuContent side="top" align="start" aria-label={labels.modelAndEffort} data-testid="composer-model-menu" className="w-56 max-w-[calc(100vw-1rem)]">
      {model && section(labels.model, models, modelValue, pickModel)}
      {model && effort && models.length > 0 && levels.length > 0 && <DropdownMenuSeparator />}
      {effort && section(labels.effort, levels, currentEffort ?? '', value => { if (value !== currentEffort) onEffort(value); })}
    </DropdownMenuContent>
  </DropdownMenu>;
}

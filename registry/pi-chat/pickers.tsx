'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, Loader2Icon } from 'lucide-react';
import type { EffortConfig, ModelConfig, ModelRef } from './config';
import { cn } from '../utils/utils';
import { useChatText } from './labels';

interface Choice { readonly section: 'model' | 'effort'; readonly value: string; readonly label: string; readonly detail?: string }

const key = (model: ModelRef) => `${model.provider}/${model.modelId}`;

/**
 * One pill for the model and the thinking level ("GPT-5 mini · Medium") that opens one listbox with a section for each
 * (arrow keys, Enter, Escape, outside click). Only the configured parts show; with neither there is no pill.
 */
export function ModelEffortPicker({ model, effort, currentModel, currentEffort, disabled, busy, onModel, onEffort }: {
  readonly model: ModelConfig | undefined; readonly effort: EffortConfig | undefined;
  readonly currentModel: ModelRef | undefined; readonly currentEffort: string | undefined;
  readonly disabled: boolean; readonly busy: 'model' | 'effort' | null;
  readonly onModel: (model: ModelRef) => void; readonly onEffort: (level: string) => void;
}) {
  const { labels } = useChatText();
  const name = labels.effortName;
  const models: Choice[] = (model?.options ?? []).map(option => ({ section: 'model', value: key(option), label: option.label ?? option.modelId, detail: option.provider }));
  // A model or level outside the offered list is still shown, so the label never lies about what runs.
  if (model && currentModel && !models.some(choice => choice.value === key(currentModel))) models.unshift({ section: 'model', value: key(currentModel), label: currentModel.modelId, detail: currentModel.provider });
  const levels: Choice[] = (effort?.options ?? []).map(level => ({ section: 'effort', value: level, label: name(level), ...(labels.effortDetail(level) ? { detail: labels.effortDetail(level)! } : {}) }));
  if (effort && currentEffort && !levels.some(choice => choice.value === currentEffort)) levels.unshift({ section: 'effort', value: currentEffort, label: name(currentEffort) });
  const choices = [...models, ...levels];
  const modelValue = currentModel ? key(currentModel) : '';
  const isCurrent = (choice: Choice) => choice.value === (choice.section === 'model' ? modelValue : currentEffort);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null), list = useRef<HTMLUListElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const selected = Math.max(0, choices.findIndex(isCurrent));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    setActive(selected);
    const outside = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>('[data-active=true]')?.scrollIntoView({ block: 'nearest' }); }, [open, active]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  if (!choices.length) return null;

  const choose = (index: number) => {
    const choice = choices[index];
    setOpen(false);
    if (!choice || isCurrent(choice)) return;
    if (choice.section === 'effort') return onEffort(choice.value);
    const option = model?.options.find(item => key(item) === choice.value);
    if (option) onModel({ provider: option.provider, modelId: option.modelId });
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => (index + 1) % choices.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index - 1 + choices.length) % choices.length); }
    else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Tab') { event.preventDefault(); choose(active); trigger.current?.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  };
  const modelLabel = model ? models.find(choice => choice.value === modelValue)?.label || currentModel?.modelId || labels.model : undefined;
  const effortLabel = effort ? currentEffort ? name(currentEffort) : labels.effortDefault : undefined;
  const summary = [modelLabel, effortLabel].filter(Boolean).join(' · ');
  const description = labels.modelSummary(modelLabel, effortLabel);
  const row = (choice: Choice, index: number) => <li key={`${choice.section}:${choice.value}`} role="option" aria-selected={isCurrent(choice)} data-testid={`composer-${choice.section}-option`} data-value={choice.value} data-active={index === active}
    onMouseEnter={() => setActive(index)} onMouseDown={event => { event.preventDefault(); choose(index); trigger.current?.focus(); }}
    className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm max-sm:min-h-11 pointer-coarse:min-h-11', index === active ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
    <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-medium text-foreground">{choice.label}</span>
      {choice.detail && <span className="truncate text-xs opacity-70">{choice.detail}</span>}</span>
    {isCurrent(choice) && <CheckIcon className="size-4 shrink-0" aria-hidden="true" />}
  </li>;
  const section = (title: string, items: readonly Choice[], offset: number) => items.length > 0 && <li role="presentation" key={title}>
    <ul role="group" aria-label={title} className="m-0 list-none p-0">
      <li role="presentation" className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">{title}</li>
      {items.map((choice, index) => row(choice, offset + index))}
    </ul></li>;
  return <div ref={root} className="relative min-w-0 shrink" onKeyDown={onKeyDown}>
    <button ref={trigger} type="button" data-testid="composer-model" data-value={modelValue} data-effort={currentEffort ?? ''} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={description} title={description}
      onClick={() => setOpen(value => !value)}
      className="inline-flex h-11 min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-full bg-muted px-4 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none max-sm:px-3">
      {busy && <Loader2Icon className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      <span data-testid="composer-model-label" className="min-w-0 truncate">{summary}</span>
      <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
    </button>
    {open && <ul ref={list} role="listbox" aria-label={labels.modelAndEffort} data-testid="composer-model-menu" className="absolute bottom-full left-0 z-20 mb-2 m-0 max-h-80 min-w-56 list-none overflow-y-auto rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:mb-0 max-sm:max-h-[70dvh] max-sm:rounded-b-none max-sm:p-2 max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {model && section(labels.model, models, 0)}
      {effort && section(labels.effort, levels, models.length)}
    </ul>}
  </div>;
}

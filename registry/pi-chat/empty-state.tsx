import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useChatText } from './labels';

export interface Suggestion { readonly label: string; readonly hint?: string; readonly text: string }

/** Shown before the first message: a quiet title and optional starter prompts that fill the composer. */
export function EmptyState({ title, description, avatar, suggestions, onSelect, children }: {
  readonly title: string; readonly description?: string; readonly avatar?: ReactNode; readonly suggestions?: readonly Suggestion[]; readonly onSelect?: (text: string) => void; readonly children?: ReactNode;
}) {
  const { labels } = useChatText();
  return <div data-testid="empty-state" className="mx-auto flex h-full w-full max-w-[720px] flex-col items-center justify-center gap-5 px-6 text-center max-sm:pb-24">
    {avatar && <span data-testid="empty-state-icon" className="flex size-8 items-center justify-center overflow-hidden text-muted-foreground [&>img]:size-full [&>img]:rounded-md [&>img]:object-cover [&>svg]:size-5">{avatar}</span>}
    <div className="space-y-1.5">
      <p className="m-0 text-2xl font-semibold tracking-tight">{title}</p>
      <p className="m-0 max-w-sm text-base leading-6 text-muted-foreground">{description ?? labels.emptyDescription}</p>
    </div>
    {children}
    {suggestions && suggestions.length > 0 && <ul className="m-0 flex w-full max-w-lg list-none flex-wrap justify-center gap-2 p-0">
      {suggestions.map(item => <li key={item.label}><Button variant="ghost" onClick={() => onSelect?.(item.text)} data-testid="suggestion"
        className="flex-col gap-1">
        <span>{item.label}</span>{item.hint && <span>{item.hint}</span>}</Button></li>)}
    </ul>}
  </div>;
}

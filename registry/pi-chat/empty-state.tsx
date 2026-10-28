import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useChatText } from './labels';

export interface Suggestion { readonly label: string; readonly hint?: string; readonly text: string }

/** Shown before the first message: a quiet title and optional starter prompts that fill the composer. */
export function EmptyState({ title, description, avatar, suggestions, onSelect, children }: {
  readonly title: string; readonly description?: string; readonly avatar?: ReactNode; readonly suggestions?: readonly Suggestion[]; readonly onSelect?: (text: string) => void; readonly children?: ReactNode;
}) {
  const { labels } = useChatText();
  return <Empty data-testid="empty-state" className="mx-auto min-h-full w-full max-w-[720px] max-md:mb-24">
    <EmptyHeader>
      {avatar && <EmptyMedia data-testid="empty-state-icon"><span className="flex size-8 items-center justify-center overflow-hidden [&>img]:size-full [&>img]:object-cover [&>svg]:size-5">{avatar}</span></EmptyMedia>}
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description ?? labels.emptyDescription}</EmptyDescription>
    </EmptyHeader>
    {(children || (suggestions && suggestions.length > 0)) && <EmptyContent>
      {children}
      {suggestions && suggestions.length > 0 && <ul className="m-0 flex w-full max-w-lg list-none flex-wrap justify-center gap-2 p-0">
        {suggestions.map(item => <li key={item.label}><Button variant="ghost" onClick={() => onSelect?.(item.text)} data-testid="suggestion"
          className="h-auto flex-col gap-1 whitespace-normal">
          <span>{item.label}</span>{item.hint && <span>{item.hint}</span>}</Button></li>)}
      </ul>}
    </EmptyContent>}
  </Empty>;
}

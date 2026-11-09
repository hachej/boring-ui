'use client';

// D-1978 part 3: the conversation log sheet of the agent bar. The bar's history arrow (`onHistory`) opens it; it is a shadcn Drawer that is not modal, so the bar stays
// usable under it (the arrow flips and closes it again) and there is no overlay. Focus moves to the close button on open and back to what had it (the arrow)
// on close; Escape closes. The app owns the data and every word (title, entries, status labels): it passes `entries` and `labels`, the kit draws them.
import { useEffect, useRef } from 'react';
import { CheckIcon, ChevronDownIcon } from '../_shared/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from '@/components/ui/drawer';

/** One row of the log. `id` is the app's stable key. */
export type ConversationLogEntry =
  /** A centred time marker between exchanges, « 08:10 ». */
  | { readonly kind: 'time'; readonly id: string; readonly time: string }
  /** What the person said or typed, a bubble on the right. */
  | { readonly kind: 'user'; readonly id: string; readonly text: string }
  /** What the agent answered, a bubble on the left; `items` are boxed suggestions (bold `title`, then `text`) and `actions` the buttons under them. */
  | { readonly kind: 'agent'; readonly id: string; readonly text: string; readonly items?: readonly { readonly title: string; readonly text: string }[]; readonly actions?: readonly { readonly label: string; readonly primary?: boolean; readonly onSelect: () => void }[] }
  /** A status line; `state: 'done'` adds a check chip carrying the app's `label`, `'working'` (the default) shows the text alone. */
  | { readonly kind: 'status'; readonly id: string; readonly text: string; readonly state?: 'working' | 'done'; readonly label?: string }
  /** A question that was asked and its answer, one chip: the question, then the answer in bold. */
  | { readonly kind: 'question'; readonly id: string; readonly question: string; readonly answer: string };

export interface ConversationLogLabels { readonly title: string; readonly close: string; readonly empty: string }
export const conversationLogLabels: ConversationLogLabels = { title: 'Historique', close: 'Fermer l’historique', empty: 'Rien pour le moment.' };

export interface ConversationLogProps {
  readonly open: boolean;
  /** Called with false on Escape or the close button. Pass the same state to the bar's `historyOpen`. */
  readonly onOpenChange: (open: boolean) => void;
  readonly entries: readonly ConversationLogEntry[];
  readonly labels?: Partial<ConversationLogLabels>;
  /** Distance from the top of the window to the sheet, a CSS length. Default 4rem (the page header stays visible). */
  readonly top?: string;
  /** Distance from the bottom of the window to the sheet, a CSS length. Default: the bar's top edge, measured when the sheet opens (the bar stays under it). */
  readonly bottom?: string;
}

function barClearance() {
  const bar = typeof document === 'undefined' ? null : document.querySelector('[data-slot="agent-bar"]');
  return bar ? `${Math.max(0, Math.round(window.innerHeight - bar.getBoundingClientRect().top + 12))}px` : '6rem';
}

function Row({ entry }: { readonly entry: ConversationLogEntry }) {
  switch (entry.kind) {
    case 'time': return <p data-testid="conversation-log-time" className="self-center text-xs text-muted-foreground">{entry.time}</p>;
    case 'user': return <p data-testid="conversation-log-user" className="max-w-[85%] self-end rounded-(--radius-3xl) bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">{entry.text}</p>;
    case 'status': return <p data-testid="conversation-log-status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span>{entry.text}</span>
      {entry.state === 'done' ? <Badge variant="secondary" className="gap-1"><CheckIcon className="size-3" aria-hidden="true" />{entry.label}</Badge> : null}
    </p>;
    case 'question': return <p data-testid="conversation-log-question" className="w-fit max-w-full rounded-(--radius-xl) bg-muted px-3 py-1.5 text-sm">{entry.question} <strong className="font-semibold">{entry.answer}</strong></p>;
    case 'agent': return <div data-testid="conversation-log-agent" className="flex max-w-[90%] flex-col gap-2 self-start">
      <p className="w-fit rounded-(--radius-3xl) bg-primary px-4 py-2.5 text-sm text-primary-foreground">{entry.text}</p>
      {entry.items?.map(item => <p key={item.title} data-testid="conversation-log-item" className="rounded-(--radius-xl) bg-muted px-3 py-2 text-sm"><strong className="font-semibold">{item.title}</strong>{item.text}</p>)}
      {entry.actions?.length ? <div className="flex flex-wrap gap-2">{entry.actions.map(action => <Button key={action.label} type="button" variant={action.primary ? 'default' : 'secondary'} data-conversation-log="" onClick={action.onSelect}>{action.label}</Button>)}</div> : null}
    </div>;
  }
}

export function ConversationLog({ open, onOpenChange, entries, labels, top = '4rem', bottom }: ConversationLogProps) {
  const words = { ...conversationLogLabels, ...labels };
  const list = useRef<HTMLDivElement>(null);
  // The last element outside the sheet that had the focus (the bar's arrow) gets it back on close.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const track = (event: FocusEvent) => { if (event.target instanceof HTMLElement && !event.target.closest('[data-conversation-log]')) opener.current = event.target; };
    document.addEventListener('focusin', track);
    return () => document.removeEventListener('focusin', track);
  }, []);
  const clearance = bottom ?? (open ? barClearance() : '6rem');
  // The log opens on its latest entry.
  useEffect(() => { if (open && list.current) list.current.scrollTop = list.current.scrollHeight; }, [open, entries.length]);

  return <Drawer open={open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal showSwipeHandle>
    <DrawerContent data-conversation-log="" initialFocus={() => document.querySelector<HTMLElement>('[data-testid="conversation-log-close"]')} finalFocus={() => opener.current}
      style={{ bottom: clearance, height: `calc(100dvh - ${top} - ${clearance})`, maxHeight: 'none' }}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <DrawerTitle>{words.title}</DrawerTitle>
        <DrawerClose render={<Button type="button" variant="secondary" size="icon" data-conversation-log="" data-testid="conversation-log-close" aria-label={words.close} />}><ChevronDownIcon /></DrawerClose>
      </div>
      <Separator />
      <div ref={node => { list.current = node; if (node) node.scrollTop = node.scrollHeight; }} data-testid="agent-log" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {entries.length ? entries.map(entry => <Row key={entry.id} entry={entry} />) : <p className="m-auto text-sm text-muted-foreground">{words.empty}</p>}
      </div>
    </DrawerContent>
  </Drawer>;
}

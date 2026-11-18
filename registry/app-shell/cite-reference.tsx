'use client';

// A reference an app cites to the agent: one pill in the composer (icon, title, number or subtitle, remove). `CiteButton` (or `useAgentLayer().talkAbout(citeToken(ref), { add: true })`)
// adds it; the shell registers the `cite` mention kind itself, so no app code draws the chip. What the agent receives is `@"cite:{"kind","id","title"}"`, read back with `citedReferences`.
import { useSyncExternalStore } from 'react';
import { hasMention, mentionedPaths, mentionToken } from '@hachej/boring-ui-kit/chat-text';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AtIcon, CheckIcon } from '../_shared/icons';
import type { MentionKind } from '../pi-chat/config';
import { cn } from '../utils/utils';
import { shellWords, useInternal } from './layer-context';

/** What an app cites: its own kind of thing (`card`, `invoice`), its id, a title, and an optional number or one muted line. */
export interface CiteReference {
  readonly kind: string;
  readonly id: string | number;
  readonly title: string;
  readonly subtitle?: string | undefined;
}

export const CITE_MENTION = 'cite';

export const citeMentionPath = ({ kind, id, title, subtitle }: CiteReference): string =>
  `${CITE_MENTION}:${JSON.stringify({ kind, id, title, ...(subtitle ? { subtitle } : {}) })}`;

/** The one `@` token for `talkAbout`, quoted when the value has spaces. */
export const citeToken = (reference: CiteReference): string => mentionToken(citeMentionPath(reference));

/** The reference a mention value (with its `cite:` prefix) stands for; undefined when it is not a well-formed citation. */
export function parseCiteReference(value: string): CiteReference | undefined {
  if (!value.startsWith(`${CITE_MENTION}:`)) return undefined;
  try {
    const parsed = JSON.parse(value.slice(CITE_MENTION.length + 1)) as Partial<CiteReference>;
    if (typeof parsed.kind !== 'string' || typeof parsed.title !== 'string' || (typeof parsed.id !== 'string' && typeof parsed.id !== 'number')) return undefined;
    return { kind: parsed.kind, id: parsed.id, title: parsed.title, ...(typeof parsed.subtitle === 'string' && parsed.subtitle ? { subtitle: parsed.subtitle } : {}) };
  } catch { return undefined; }
}

/** The citations a message carries, in order, once each: what the agent's side reads. */
export function citedReferences(text: string): CiteReference[] {
  const seen = new Set<string>();
  return mentionedPaths(text).flatMap(value => {
    const reference = parseCiteReference(value);
    const key = reference && `${reference.kind}:${reference.id}`;
    if (!reference || seen.has(key!)) return [];
    seen.add(key!);
    return [reference];
  });
}

/** The composer's chip and the sent message's mention for a citation; `word` is the kit's label (« Reference », « Référence »). */
export const citeMentionKind = (word: string): MentionKind => ({
  label: value => { const reference = parseCiteReference(`${CITE_MENTION}:${value}`); return reference ? `${word}: ${reference.title}` : value; },
  present: value => { const reference = parseCiteReference(`${CITE_MENTION}:${value}`); return reference ? { title: reference.title, ...(reference.subtitle ? { badge: reference.subtitle } : {}) } : { title: value }; },
  icon: <AtIcon className="size-4" aria-hidden="true" />,
});

const noSubscription = () => () => {};

/** A small button that cites `reference` to the agent: adds one chip (a second citation adds a second, the same one again changes nothing). Shown only when the agent's chat has `mentions`. */
export function CiteButton({ reference, className }: { readonly reference: CiteReference; readonly className?: string }) {
  const layer = useInternal();
  const controller = layer.agent?.controller, enabled = layer.agent?.chatProps?.mentions !== undefined;
  const draft = useSyncExternalStore(controller?.subscribe ?? noSubscription, () => controller?.getSnapshot().draft.text ?? '');
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  if (!enabled) return null;
  const done = hasMention(draft, citeMentionPath(reference)), label = `${done ? text.referencedInAgent : text.referenceInAgent}: ${reference.title}`;
  return <Tooltip>
    <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" data-testid="cite-reference" data-cited={done ? '' : undefined} aria-label={label} className={cn('max-md:min-w-11 pointer-coarse:min-w-11', className)}
      onClick={() => layer.talkAbout(citeToken(reference), { add: true })} />}>{done ? <CheckIcon aria-hidden="true" /> : <AtIcon aria-hidden="true" />}</TooltipTrigger>
    <TooltipContent side="top">{text.referenceInAgent}</TooltipContent>
  </Tooltip>;
}

'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ResourceLocator } from '@hachej/boring-files';
import { randomUUID } from '@hachej/boring-files/platform';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { captureMarkdownQuote, markdownQuoteResolution, type MarkdownQuoteAnchor, type MarkdownQuoteRange } from '@hachej/boring-ui-kit/markdown-quote';
import { createMarkStore, type MarkStore, type MarkResource, type MarkColour } from '@hachej/boring-ui-kit/mark-store';
import type { MarkdownQuoteCapture } from '@hachej/boring-ui-kit/markdown-editor';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { MarkdownEditor } from '../markdown-editor/markdown-editor';

export interface HighlightAction { readonly id: string; readonly label: string; readonly run: (id: string) => void }
export interface Highlight { readonly id: string; readonly anchor: MarkdownQuoteAnchor; readonly colour: MarkColour; readonly actions?: readonly HighlightAction[] }
export interface HighlightsProps {
  readonly controller: MarkdownController;
  readonly resource?: MarkResource;
  readonly locator?: ResourceLocator;
  readonly store?: MarkStore;
  readonly marks?: readonly Highlight[];
  readonly locale?: 'en' | 'fr';
}
const labels = {
  en: { title: 'Highlights', add: 'Highlight selection', note: 'Comment', save: 'Save comment', remove: 'Remove highlight', actions: 'Highlight actions', tray: 'Unplaced highlights', missing: 'Text missing', ambiguous: 'Several exact matches', candidate: 'Use candidate', attach: 'Attach to selection', refused: 'Select exact text in the document or Markdown source.', conflict: 'Marks changed elsewhere. Reload before editing.', unknown: 'Mark save unconfirmed. Check its outcome before editing.', check: 'Check save outcome', reload: 'Reload marks', failed: 'Marks could not be saved.', unavailable: 'Marks unavailable', projection: 'Source view shows every exact mark; rich view refuses uncertain projections.', source: 'Annotated source', confirmed: 'Confirmed for this version only' },
  fr: { title: 'Surlignages', add: 'Surligner la sélection', note: 'Commentaire', save: 'Enregistrer le commentaire', remove: 'Supprimer le surlignage', actions: 'Actions du surlignage', tray: 'Surlignages non placés', missing: 'Texte absent', ambiguous: 'Plusieurs correspondances exactes', candidate: 'Choisir ce passage', attach: 'Rattacher à la sélection', refused: 'Sélectionnez un passage exact du document ou de la source Markdown.', conflict: 'Les annotations ont changé ailleurs. Rechargez avant de modifier.', unknown: 'Enregistrement non confirmé. Vérifiez son résultat avant de modifier.', check: 'Vérifier le résultat', reload: 'Recharger les annotations', failed: 'Les annotations n’ont pas pu être enregistrées.', unavailable: 'Annotations indisponibles', projection: 'La vue source montre chaque annotation exacte ; la vue enrichie refuse les projections incertaines.', source: 'Source annotée', confirmed: 'Confirmé pour cette version uniquement' },
};
const empty = { marks: [], save: { kind: 'idle' }, dirty: false, lifecycle: 'active' } as const;
const idleSubscribe = () => () => {};
type Choice = { readonly source: string; readonly range: MarkdownQuoteRange };

/** Borrows supplied controllers/stores. Only the default sidecar store is owned here. */
export function Highlights({ controller, resource, locator, store: supplied, marks: suppliedMarks, locale = 'en' }: HighlightsProps) {
  const l = labels[locale];
  const [owned, setOwned] = useState<{ store: MarkStore; client: MarkResource['client']; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [capture, setCapture] = useState<{ controller: MarkdownController; text: string; value: MarkdownQuoteCapture } | null>(null);
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const path = locator?.resource.path, providerId = locator?.resource.providerId, view = JSON.stringify(locator?.view);
  const client = resource?.client, scope = resource?.identity.scopeId, principal = resource?.identity.principalId, initiator = resource?.identity.initiatorId;
  const ownerKey = JSON.stringify([scope, principal, initiator, path, providerId, view]);
  useEffect(() => {
    if (supplied || !resource || !locator) { setOwned(null); return; }
    let live = true, acquired: MarkStore | undefined;
    setOwned(null); setError(null);
    void createMarkStore(resource, locator).then(store => { acquired = store; if (live) setOwned({ store, client: resource.client, key: ownerKey }); else store.dispose(); }, () => { if (live) setError(l.unavailable); });
    return () => { live = false; acquired?.dispose(); };
  }, [supplied, client, scope, principal, initiator, path, providerId, view]);
  const store = supplied ?? (owned?.client === client && owned?.key === ownerKey ? owned.store : null);
  const binding = useRef({ controller, store }); binding.current = { controller, store };
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const snapshot = useSyncExternalStore(store?.subscribe ?? idleSubscribe, store?.getSnapshot ?? (() => empty), store?.getSnapshot ?? (() => empty));
  const marks: readonly Highlight[] = suppliedMarks ?? snapshot.marks;
  const result = snapshot.save.kind === 'settled' ? snapshot.save.result : null;
  const busy = snapshot.lifecycle !== 'active' || snapshot.save.kind === 'pending' || !!result && result.kind !== 'saved';
  const currentBinding = () => live.current && binding.current.controller === controller && binding.current.store === store && controller.getSnapshot().lifecycle === 'active';
  const currentText = () => currentBinding() && controller.getSnapshot().text === state.text;
  const selection = capture?.controller === controller && capture.text === state.text && capture.value.kind === 'captured' ? capture.value.anchor : null;
  const selectQuote = useCallback((value: MarkdownQuoteCapture) => { setCapture({ controller, text: controller.getSnapshot().text, value }); }, [controller]);
  const placed = useMemo(() => marks.map(mark => ({ mark, placement: markdownQuoteResolution.resolve(mark.anchor, state.text, String(state.bufferVersion)) })), [marks, state.text, state.bufferVersion]);
  const decorations = useMemo(() => marks.map(mark => ({ ...mark, ...(choices[mark.id]?.source === state.text ? { confirmed: choices[mark.id] } : {}) })), [marks, choices, state.text]);
  const current = marks.find(m => m.id === active);
  const activate = useCallback((id: string) => { setActive(id); setNote(store?.getSnapshot().marks.find(m => m.id === id)?.note ?? ''); }, [store]);
  useEffect(() => { setActive(null); setCapture(null); setChoices({}); setError(null); }, [controller, store]);
  const run = async (operation: () => Promise<unknown>) => {
    if (!currentBinding()) return;
    setError(null);
    try {
      const value = await operation();
      if (currentBinding() && value && typeof value === 'object' && 'kind' in value && !['saved', 'available', 'missing'].includes(String(value.kind))) setError(value.kind === 'conflict' ? l.conflict : value.kind === 'unknown' ? l.unknown : l.failed);
    } catch { if (currentBinding()) setError(l.failed); }
  };
  const add = () => {
    if (!currentText() || !selection || !store || busy) return;
    void run(() => store.add({ id: randomUUID(), anchor: selection, colour: 'accent', note: '', author: resource?.identity.principalId ?? state.identity.principalId, time: new Date().toISOString() }));
  };
  const choose = (mark: Highlight, range: MarkdownQuoteRange) => {
    if (!currentText() || busy) return;
    const fresh = markdownQuoteResolution.resolve(mark.anchor, controller.getSnapshot().text, String(state.bufferVersion));
    if (fresh.kind !== 'ambiguous' || !fresh.candidates.some(r => r.start === range.start && r.end === range.end)) return;
    setChoices(previous => ({ ...previous, [mark.id]: { source: state.text, range } })); activate(mark.id);
    const captured = captureMarkdownQuote(state.text, range);
    if (store && captured.kind === 'captured') void run(() => store.edit(mark.id, { anchor: captured.anchor }));
  };
  const lost = placed.filter(p => (p.placement.kind === 'missing' || p.placement.kind === 'ambiguous') && choices[p.mark.id]?.source !== state.text);
  const noteId = useId();
  return <section data-boring="highlights" className="flex min-w-0 flex-col gap-4" lang={locale}>
    <header className="flex flex-wrap items-center justify-between gap-2"><h2>{l.title}</h2>
      {store && <Button className="min-h-11" disabled={busy || !selection} onMouseDown={event => event.preventDefault()} onClick={add}>{l.add}</Button>}
    </header>
    {error && <p role="alert">{error}</p>}
    {result && result.kind !== 'saved' && <div role="alert"><p>{result.kind === 'unknown' ? l.unknown : result.kind === 'conflict' ? l.conflict : l.failed}</p>
      {result.kind === 'unknown' ? <Button onClick={() => void run(() => store!.reconcile())}>{l.check}</Button> : <Button onClick={() => void run(async () => { await store!.reload(); if (currentBinding()) { setActive(null); setChoices({}); } })}>{l.reload}</Button>}
    </div>}
    <MarkdownEditor controller={controller} highlights={decorations} onQuoteSelection={selectQuote} onHighlightActivate={activate} autosave={false} />
    <p>{l.projection}</p>
    <details><summary>{l.source}</summary><AnnotatedSource source={state.text} placements={placed} choices={choices} activate={activate} /></details>
    {current && <div className="flex flex-col gap-2" data-testid="highlight-context">
      {(store || current.actions?.length) && <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" className="min-h-11" />}>{l.actions}</DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuGroup>
          {current.actions?.map(action => <DropdownMenuItem key={action.id} onClick={() => { if (currentText()) action.run(current.id); }}>{action.label}</DropdownMenuItem>)}
          {store && <DropdownMenuItem disabled={busy} onClick={() => { if (currentText()) void run(() => store.remove(current.id)); }}>{l.remove}</DropdownMenuItem>}
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>}
      {choices[current.id]?.source === state.text && <p role="status">{l.confirmed}</p>}
      {store && <><Label htmlFor={noteId}>{l.note}</Label><Textarea id={noteId} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
        <Button className="min-h-11" disabled={busy} onClick={() => { if (currentText()) void run(() => store.edit(current.id, { note })); }}>{l.save}</Button></>}
    </div>}
    {lost.length > 0 && <aside aria-label={l.tray} className="flex flex-col gap-4"><h3>{l.tray}</h3>
      {lost.map(({ mark, placement }) => <article key={mark.id} className="flex min-w-0 flex-col gap-2" data-testid="lost-mark">
        <p>{mark.anchor.fallback}</p><p>{placement.kind === 'missing' ? l.missing : l.ambiguous}</p>
        {placement.kind === 'ambiguous' && placement.candidates.map((range, index) => <Button key={range.start} variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-left" disabled={busy} onClick={() => choose(mark, range)}>{l.candidate} {index + 1}: {state.text.slice(Math.max(0, range.start - 24), range.end + 24)}</Button>)}
        {store && <Button className="min-h-11" disabled={busy || !selection} onClick={() => { if (currentText() && selection) void run(() => store.edit(mark.id, { anchor: selection })); }}>{l.attach}</Button>}
      </article>)}
    </aside>}
  </section>;
}

function AnnotatedSource({ source, placements, choices, activate }: { readonly source: string; readonly placements: readonly { mark: Highlight; placement: ReturnType<typeof markdownQuoteResolution.resolve> }[]; readonly choices: Readonly<Record<string, Choice>>; readonly activate: (id: string) => void }) {
  const ranges = placements.flatMap(({ mark, placement }) => {
    if (!['accent', 'primary', 'muted'].includes(mark.colour)) return [];
    const choice = choices[mark.id];
    const range = choice?.source === source && placement.kind === 'ambiguous' && placement.candidates.some(r => r.start === choice.range.start && r.end === choice.range.end) ? choice.range : placement.kind === 'exact' || placement.kind === 'moved' ? placement.range : null;
    return range ? [{ mark, range }] : [];
  });
  const cuts = [...new Set([0, source.length, ...ranges.flatMap(r => [r.range.start, r.range.end])])].sort((a, b) => a - b);
  return <pre className="whitespace-pre-wrap break-words">{cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1]!, covering = ranges.filter(r => r.range.start <= start && r.range.end >= end);
    return covering.length ? <mark key={start} role="button" tabIndex={0} aria-label={covering.map(r => r.mark.anchor.fallback).join('; ')} style={{ backgroundColor: `var(--${covering[0]!.mark.colour})`, color: `var(--${covering[0]!.mark.colour}-foreground)` }}
      onClick={() => activate(covering[0]!.mark.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(covering[0]!.mark.id); } }}>{source.slice(start, end)}</mark> : source.slice(start, end);
  })}</pre>;
}

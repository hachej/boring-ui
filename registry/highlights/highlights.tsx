'use client';

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ResourceLocator } from '@hachej/boring-files';
import { randomUUID } from '@hachej/boring-files/platform';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { captureMarkdownQuote, markdownQuoteResolution, type MarkdownQuoteAnchor, type MarkdownQuoteRange } from '@hachej/boring-ui-kit/markdown-quote';
import { createMarkStore, type MarkStore, type MarkResource, type MarkColour } from '@hachej/boring-ui-kit/mark-store';
import { markdownMarkerBackground, type MarkdownQuoteCapture } from '@hachej/boring-ui-kit/markdown-editor';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Item, ItemContent, ItemDescription, ItemGroup } from '@/components/ui/item';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { MarkdownEditor } from '../markdown-editor/markdown-editor';

export interface HighlightAction { readonly id: string; readonly label: string; readonly run: (id: string) => void }
export interface Highlight { readonly id: string; readonly anchor: MarkdownQuoteAnchor; readonly colour: MarkColour; readonly note?: string; readonly actions?: readonly HighlightAction[] }
export interface HighlightsProps {
  readonly controller: MarkdownController;
  readonly resource?: MarkResource;
  readonly locator?: ResourceLocator;
  readonly store?: MarkStore;
  readonly marks?: readonly Highlight[];
  readonly locale?: 'en' | 'fr';
}
const labels = {
  en: { title: 'Highlights', add: 'Highlight selection', note: 'Comment', save: 'Save comment', remove: 'Remove highlight', actions: 'Highlight actions', tray: (count: number) => `${count} ${count === 1 ? 'highlight could' : 'highlights could'} not be placed`, missing: 'This passage is no longer in the document', ambiguous: 'This passage appears several times — pick the right one', candidate: 'Choose passage', attach: 'Attach to selection', hint: 'Select a passage in the document first.', refused: "This selection can't be highlighted here. Try selecting it in Markdown source.", conflict: 'Highlights changed elsewhere. Reload before editing.', unknown: "We couldn't confirm the save. Check before making another change.", check: 'Check save outcome', reload: 'Reload highlights', failed: "Your highlights couldn't be saved.", unavailable: "Highlights aren't available.", source: 'View marked text', confirmed: 'Your choice is kept for this version.', commented: 'Has a comment' },
  fr: { title: 'Surlignages', add: 'Surligner la sélection', note: 'Commentaire', save: 'Enregistrer le commentaire', remove: 'Supprimer le surlignage', actions: 'Actions du surlignage', tray: (count: number) => count === 1 ? "1 surlignage n'a pas pu être placé" : `${count} surlignages n'ont pas pu être placés`, missing: "Ce passage n'est plus dans le document.", ambiguous: 'Ce passage apparaît plusieurs fois — choisissez le bon.', candidate: 'Choisir ce passage', attach: 'Rattacher à la sélection', hint: "Sélectionnez d'abord un passage dans le document.", refused: 'Ce passage ne peut pas être surligné ici. Essayez de le sélectionner dans la source Markdown.', conflict: 'Les surlignages ont changé ailleurs. Rechargez avant de modifier.', unknown: "L'enregistrement n'a pas été confirmé. Vérifiez avant de continuer.", check: 'Vérifier le résultat', reload: 'Recharger les surlignages', failed: "Les surlignages n'ont pas pu être enregistrés.", unavailable: 'Les surlignages ne sont pas disponibles.', source: 'Voir le texte surligné', confirmed: 'Votre choix est conservé pour cette version.', commented: 'Avec un commentaire' },
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
  const decorations = useMemo(() => marks.map(mark => ({ ...mark, active: mark.id === active, commented: !!mark.note?.trim(), commentLabel: l.commented, ...(choices[mark.id]?.source === state.text ? { confirmed: choices[mark.id] } : {}) })), [marks, active, l.commented, choices, state.text]);
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
  const hintId = `${noteId}-selection-hint`;
  const hint = capture?.controller === controller && capture.text === state.text && capture.value.kind === 'refused' && capture.value.reason.includes('no exact source projection') ? l.refused : l.hint;
  return <section data-boring="highlights" className="flex min-w-0 flex-col gap-4" lang={locale}>
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2>{l.title}</h2>
        {store && <Button variant="secondary" size="sm" disabled={busy || !selection} aria-describedby={!selection ? hintId : undefined} onMouseDown={event => event.preventDefault()} onClick={add}>{l.add}</Button>}
      </div>
      {store && !selection && <ItemDescription id={hintId}>{hint}</ItemDescription>}
    </header>
    {error && <p role="alert">{error}</p>}
    {result && result.kind !== 'saved' && <div role="alert"><p>{result.kind === 'unknown' ? l.unknown : result.kind === 'conflict' ? l.conflict : l.failed}</p>
      {result.kind === 'unknown' ? <Button variant="outline" size="sm" onClick={() => void run(() => store!.reconcile())}>{l.check}</Button> : <Button variant="outline" size="sm" onClick={() => void run(async () => { await store!.reload(); if (currentBinding()) { setActive(null); setChoices({}); } })}>{l.reload}</Button>}
    </div>}
    <MarkdownEditor controller={controller} locale={locale} highlights={decorations} onQuoteSelection={selectQuote} onHighlightActivate={activate} autosave={false} />
    <details><summary>{l.source}</summary><AnnotatedSource source={state.text} placements={placed} choices={choices} active={active} commentLabel={l.commented} activate={activate} /></details>
    {current && <div className="flex flex-col items-start gap-2" data-testid="highlight-context">
      {(store || current.actions?.length) && <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>{l.actions}</DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuGroup>
          {current.actions?.map(action => <DropdownMenuItem key={action.id} onClick={() => { if (currentText()) action.run(current.id); }}>{action.label}</DropdownMenuItem>)}
          {store && <DropdownMenuItem disabled={busy} onClick={() => { if (currentText()) void run(() => store.remove(current.id)); }}>{l.remove}</DropdownMenuItem>}
        </DropdownMenuGroup></DropdownMenuContent>
      </DropdownMenu>}
      {choices[current.id]?.source === state.text && <p role="status">{l.confirmed}</p>}
      {store && <><Label htmlFor={noteId}>{l.note}</Label><Textarea id={noteId} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => { if (currentText()) void run(() => store.edit(current.id, { note })); }}>{l.save}</Button></>}
    </div>}
    {lost.length > 0 && <aside aria-label={l.tray(lost.length)} className="flex flex-col gap-3"><h3>{l.tray(lost.length)}</h3>
      <ItemGroup>{lost.map(({ mark, placement }, lostIndex) => <Item key={mark.id} role="listitem" variant="outline" size="sm" data-testid="lost-mark">
        <ItemContent className="min-w-0 gap-3">
          <div className="flex flex-col gap-1"><p><q>{mark.anchor.exact}</q></p><ItemDescription>{placement.kind === 'missing' ? l.missing : l.ambiguous}</ItemDescription></div>
          {placement.kind === 'ambiguous' && <div className="grid gap-3 sm:grid-cols-2">{placement.candidates.map((range, index) => <div key={range.start} className="flex min-w-0 flex-col items-start gap-2" data-testid="highlight-candidate">
            <CandidateContext source={state.text} range={range} />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => choose(mark, range)}>{l.candidate} {index + 1}</Button>
          </div>)}</div>}
          {store && <div className="flex flex-col items-start gap-2">
            <Button variant="outline" size="sm" disabled={!selection} aria-describedby={!selection ? `${hintId}-${lostIndex}` : undefined} onClick={() => { if (currentText() && selection) void run(() => store.edit(mark.id, { anchor: selection })); }}>{l.attach}</Button>
            {!selection && <ItemDescription id={`${hintId}-${lostIndex}`}>{hint}</ItemDescription>}
          </div>}
        </ItemContent>
      </Item>)}</ItemGroup>
    </aside>}
  </section>;
}

function CandidateContext({ source, range }: { readonly source: string; readonly range: MarkdownQuoteRange }) {
  const before = source.slice(0, range.start), lineStart = before.lastIndexOf('\n') + 1;
  const previousWords = [...before.slice(lineStart).matchAll(/\S+/gu)];
  const from = lineStart + (previousWords.slice(-5)[0]?.index ?? before.length - lineStart);
  const lineEnd = source.indexOf('\n', range.end);
  const after = source.slice(range.end, lineEnd === -1 ? source.length : lineEnd);
  const nextWords = [...after.matchAll(/\S+/gu)].slice(0, 5), last = nextWords.at(-1);
  const to = range.end + (last ? last.index + last[0].length : 0);
  return <p className="break-words" data-testid="candidate-context">
    {source.slice(0, from).trim() ? '… ' : ''}{source.slice(from, range.start).replace(/\s+/gu, ' ')}
    <mark style={{ backgroundColor: markdownMarkerBackground('primary'), color: 'var(--foreground)' }}>{source.slice(range.start, range.end)}</mark>
    {source.slice(range.end, to).replace(/\s+/gu, ' ')}{source.slice(to).trim() ? ' …' : ''}
  </p>;
}

function CommentIndicator({ id, label, activate }: { readonly id: string; readonly label: string; readonly activate: (id: string) => void }) {
  return <span data-mark-comment={id} role="img" aria-label={label} className="inline-flex align-super" style={{ color: 'var(--muted-foreground)', marginInlineStart: '0.15em' }} onClick={() => activate(id)}>
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden="true"><path d="M3 2.5h10v8H7l-4 3v-11Z" fill="none" stroke="currentColor" /></svg>
  </span>;
}

function AnnotatedSource({ source, placements, choices, active, commentLabel, activate }: { readonly source: string; readonly placements: readonly { mark: Highlight; placement: ReturnType<typeof markdownQuoteResolution.resolve> }[]; readonly choices: Readonly<Record<string, Choice>>; readonly active: string | null; readonly commentLabel: string; readonly activate: (id: string) => void }) {
  const ranges = placements.flatMap(({ mark, placement }) => {
    if (!['accent', 'primary', 'muted'].includes(mark.colour)) return [];
    const choice = choices[mark.id];
    const range = choice?.source === source && placement.kind === 'ambiguous' && placement.candidates.some(r => r.start === choice.range.start && r.end === choice.range.end) ? choice.range : placement.kind === 'exact' || placement.kind === 'moved' ? placement.range : null;
    return range ? [{ mark, range }] : [];
  });
  const cuts = [...new Set([0, source.length, ...ranges.flatMap(r => [r.range.start, r.range.end])])].sort((a, b) => a - b);
  return <pre className="whitespace-pre-wrap break-words">{cuts.slice(0, -1).map((start, index) => {
    const end = cuts[index + 1]!, covering = ranges.filter(r => r.range.start <= start && r.range.end >= end);
    return covering.length ? <Fragment key={start}><mark role="button" tabIndex={0} aria-label={covering.map(r => r.mark.anchor.fallback).join('; ')} style={{ backgroundColor: markdownMarkerBackground(covering[0]!.mark.colour), color: 'var(--foreground)', ...(covering.some(r => r.mark.id === active) ? { outline: 'var(--border-width, 1px) solid var(--ring)' } : {}) }}
      onClick={() => activate(covering[0]!.mark.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(covering[0]!.mark.id); } }}>{source.slice(start, end)}</mark>
      {covering.filter(r => r.range.end === end && r.mark.note?.trim()).map(r => <CommentIndicator key={r.mark.id} id={r.mark.id} label={commentLabel} activate={activate} />)}
    </Fragment> : source.slice(start, end);
  })}</pre>;
}

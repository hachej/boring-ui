// AnnotateSheet: the note, Cancel selection (back to a general note, nothing attached), Copy report and, when the host has a save endpoint, Save. The draft, its anchors and the Save operation id are
// the headless `createAnnotation` from `@hachej/boring-feedback/ui`; this file is how the sheet looks and what it says.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { protectionNotice, type Annotation, type CopyState, type FeedbackProtection, type SaveState } from '@hachej/boring-feedback/ui';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';
import { useExternal } from './use-external';
import { withLabels, type FeedbackLabels } from './feedback-labels';

export interface AnnotateSheetProps {
  readonly annotation: Annotation;
  readonly onClose: () => void;
  /** The pinned element the sheet opens beside. Without it the sheet docks at the bottom. */
  readonly near?: Element;
  /** The store's declared protection, when the host saves. An unprotected store is stated. */
  readonly protection?: FeedbackProtection;
  readonly title?: string;
  /** Words of the controls (`feedbackLabelsFr` for French); what is left out keeps the English default. */
  readonly labels?: Partial<FeedbackLabels>;
  /**
   * Called after the selection was cancelled (Esc, the Cancel selection button, or clicking the selected element again). The host
   * returns to the picker or to no zone here, typically by closing the sheet. Without it the sheet stays open as a general note, with
   * what was typed kept.
   */
  readonly onCancelSelection?: () => void;
}

const copyMessage = (copy: CopyState): string => {
  switch (copy.kind) {
    case 'copied': return 'Report copied. Paste it anywhere.';
    case 'manual': return 'The clipboard is not available here: select the report below and copy it.';
    case 'refused': return copy.reason;
    default: return '';
  }
};
const saveMessage = (save: SaveState): string => {
  switch (save.kind) {
    case 'saving': return 'Saving…';
    case 'saved': return 'Saved.';
    case 'unknown': return `${save.reason} Nothing is lost: Save again uses the same operation, so it cannot be stored twice.`;
    case 'denied': return `Not saved: ${save.reason}`;
    case 'unavailable': return `Not saved: ${save.reason}`;
    case 'conflict': return `Not saved: ${save.reason}`;
    case 'invalid': return save.reason;
    default: return '';
  }
};

const SHEET_WIDTH = 360;
function placeNear(element: Element | undefined): CSSProperties | undefined {
  if (!element || !element.isConnected) return undefined;
  const view = element.ownerDocument.defaultView;
  if (!view || view.innerWidth < 640) return undefined;
  const rect = element.getBoundingClientRect();
  const right = rect.right + 12;
  const left = right + SHEET_WIDTH <= view.innerWidth - 12 ? right : Math.max(12, rect.left - SHEET_WIDTH - 12);
  const top = Math.min(Math.max(12, rect.top), Math.max(12, view.innerHeight - 420));
  return { position: 'fixed', top, left, width: SHEET_WIDTH };
}

export function AnnotateSheet({ annotation, onClose, near, protection, title, labels, onCancelSelection }: AnnotateSheetProps) {
  const state = useExternal(annotation);
  const words = withLabels(labels);
  const heading = state.selected ? (title ?? words.title) : words.askGeneral;
  const note = useRef<HTMLTextAreaElement>(null);
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);
  useLayoutEffect(() => { setPlace(placeNear(near)); }, [near]);
  const [cancelled, setCancelled] = useState(false);
  const callbacks = useRef({ onCancelSelection });
  callbacks.current = { onCancelSelection };
  useEffect(() => { note.current?.focus({ preventScroll: true }); }, []);
  // Focus goes back to where it was when the sheet opened (the Point button, after the picker restored it), not to the top of the page.
  useEffect(() => {
    const opener = note.current?.ownerDocument.activeElement;
    const before = opener && opener !== note.current ? opener : undefined;
    return () => { if (before && before.isConnected && typeof (before as HTMLElement).focus === 'function') (before as HTMLElement).focus({ preventScroll: true }); };
  }, []);
  const cancelSelection = (): void => {
    if (!annotation.clearSelection()) return;
    setCancelled(true);
    note.current?.focus({ preventScroll: true });
    callbacks.current.onCancelSelection?.();
  };
  // Clicking the selected element again cancels the selection instead of activating it.
  const selected = state.selected;
  useEffect(() => {
    const view = near?.ownerDocument.defaultView;
    if (!near || !view || !selected) return;
    const onClick = (event: Event): void => {
      const path = event.composedPath();
      if (path.some(item => (item as Element).hasAttribute?.('data-feedback-ignore')) || !path.includes(near)) return;
      event.preventDefault(); event.stopPropagation();
      if (annotation.clearSelection()) { setCancelled(true); note.current?.focus({ preventScroll: true }); callbacks.current.onCancelSelection?.(); }
    };
    view.addEventListener('click', onClick, { capture: true });
    return () => view.removeEventListener('click', onClick, { capture: true });
  }, [near, selected, annotation]);
  const notice = protection ? protectionNotice(protection) : undefined;
  // Esc cancels the selection first (one step back: to no zone); on a general note it closes the sheet.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (state.selected && state.save.kind !== 'saved' && state.save.kind !== 'saving') cancelSelection(); else onClose();
  };
  const copyText = state.copy.kind === 'copied' || state.copy.kind === 'manual' ? state.copy.text : undefined;
  const saved = state.save.kind === 'saved';

  return <section data-boring="feedback" data-feedback-ignore="" role="dialog" aria-label={heading} data-testid="feedback-sheet" data-selected={state.selected ? 'true' : 'false'}
    className="boring-feedback-sheet" data-docked={place ? undefined : 'bottom'} style={place} onKeyDown={onKeyDown}>
    <header className="boring-feedback-sheet-header">
      <h2>{heading}</h2>
      <Button variant="ghost" size="icon" aria-label={words.close} title={words.close} data-testid="feedback-close" onClick={onClose}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
    </header>
    {state.selected && <ul className="boring-feedback-targets" data-testid="feedback-targets">
      {state.targets.map((target, index) => <li key={index}>{target}</li>)}
    </ul>}
    {state.refused.length > 0 && <p role="alert" className="boring-feedback-warning" data-testid="feedback-refused">
      {state.refused.length === 1 ? 'One element could not be pointed at' : `${state.refused.length} elements could not be pointed at`}: {state.refused.map(item => item.reason).join('; ')}.
    </p>}
    <label className="boring-feedback-field">
      <span>{state.selected ? words.changeField : words.generalField}</span>
      <textarea ref={note} data-testid="feedback-note" rows={4} value={state.said} readOnly={saved} onChange={event => annotation.setSaid(event.target.value)} />
    </label>
    <div className="boring-feedback-actions">
      {state.selected && state.save.kind !== 'saved' && <Button variant="ghost" data-testid="feedback-cancel-selection" disabled={state.save.kind === 'saving'}
        onClick={cancelSelection}>{words.cancelSelection}</Button>}
      <Button variant="ghost" data-testid="feedback-copy" onClick={() => { void annotation.copy(); }}>{words.copyReport}</Button>
      {state.canSave && <Button variant="default" data-testid="feedback-save" disabled={state.save.kind === 'saving' || saved}
        onClick={() => { void annotation.save(); }}>{state.save.kind === 'unknown' ? words.saveAgain : saved ? words.saved : words.save}</Button>}
    </div>
    <p role="status" aria-live="polite" className="boring-feedback-status" data-testid="feedback-status" data-copy={state.copy.kind} data-save={state.save.kind}>
      {[copyMessage(state.copy), saveMessage(state.save), cancelled && !state.selected ? words.selectionCancelled : ''].filter(Boolean).join(' ')}
    </p>
    {state.copy.kind === 'manual' && copyText !== undefined && <textarea readOnly className="boring-feedback-manual" data-testid="feedback-manual-copy" value={copyText}
      onFocus={event => event.currentTarget.select()} rows={6} />}
    {state.copy.kind === 'copied' && copyText !== undefined && <details className="boring-feedback-copied"><summary>Copied report</summary>
      <pre data-testid="feedback-copy-text">{copyText}</pre></details>}
    {notice && <p className="boring-feedback-notice" data-testid="feedback-protection">{notice}</p>}
  </section>;
}

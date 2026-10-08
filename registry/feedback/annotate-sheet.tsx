// AnnotateSheet: the note, Copy report and, when the host has a save endpoint, Save. The draft, its anchors and the Save operation id are
// the headless `createAnnotation` from `@hachej/boring-feedback/ui`; this file is how the sheet looks and what it says.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { protectionNotice, type Annotation, type CopyState, type FeedbackProtection, type SaveState } from '@hachej/boring-feedback/ui';
import { useExternal } from './use-external';

export interface AnnotateSheetProps {
  readonly annotation: Annotation;
  readonly onClose: () => void;
  /** The pinned element the sheet opens beside. Without it the sheet docks at the bottom. */
  readonly near?: Element;
  /** The store's declared protection, when the host saves. An unprotected store is stated. */
  readonly protection?: FeedbackProtection;
  readonly title?: string;
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

export function AnnotateSheet({ annotation, onClose, near, protection, title = 'Feedback' }: AnnotateSheetProps) {
  const state = useExternal(annotation);
  const note = useRef<HTMLTextAreaElement>(null);
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);
  useLayoutEffect(() => { setPlace(placeNear(near)); }, [near]);
  useEffect(() => { note.current?.focus({ preventScroll: true }); }, []);
  const notice = protection ? protectionNotice(protection) : undefined;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
  const copyText = state.copy.kind === 'copied' || state.copy.kind === 'manual' ? state.copy.text : undefined;
  const saved = state.save.kind === 'saved';

  return <section data-boring="feedback" data-feedback-ignore="" role="dialog" aria-label={title} data-testid="feedback-sheet"
    className="boring-feedback-sheet" data-docked={place ? undefined : 'bottom'} style={place} onKeyDown={onKeyDown}>
    <header className="boring-feedback-sheet-header">
      <h2>{title}</h2>
      <button type="button" className="boring-feedback-icon" aria-label="Close" data-testid="feedback-close" onClick={onClose}>×</button>
    </header>
    <ul className="boring-feedback-targets" data-testid="feedback-targets">
      {state.targets.map((target, index) => <li key={index}>{target}</li>)}
    </ul>
    {state.refused.length > 0 && <p role="alert" className="boring-feedback-warning" data-testid="feedback-refused">
      {state.refused.length === 1 ? 'One element could not be pointed at' : `${state.refused.length} elements could not be pointed at`}: {state.refused.map(item => item.reason).join('; ')}.
    </p>}
    <label className="boring-feedback-field">
      <span>What should change?</span>
      <textarea ref={note} data-testid="feedback-note" rows={4} value={state.said} readOnly={saved} onChange={event => annotation.setSaid(event.target.value)} />
    </label>
    <div className="boring-feedback-actions">
      <button type="button" className="boring-feedback-button" data-testid="feedback-copy" onClick={() => { void annotation.copy(); }}>Copy report</button>
      {state.canSave && <button type="button" className="boring-feedback-button" data-variant="primary" data-testid="feedback-save" disabled={state.save.kind === 'saving' || saved}
        onClick={() => { void annotation.save(); }}>{state.save.kind === 'unknown' ? 'Save again' : saved ? 'Saved' : 'Save'}</button>}
    </div>
    <p role="status" aria-live="polite" className="boring-feedback-status" data-testid="feedback-status" data-copy={state.copy.kind} data-save={state.save.kind}>
      {[copyMessage(state.copy), saveMessage(state.save)].filter(Boolean).join(' ')}
    </p>
    {state.copy.kind === 'manual' && copyText !== undefined && <textarea readOnly className="boring-feedback-manual" data-testid="feedback-manual-copy" value={copyText}
      onFocus={event => event.currentTarget.select()} rows={6} />}
    {state.copy.kind === 'copied' && copyText !== undefined && <details className="boring-feedback-copied"><summary>Copied report</summary>
      <pre data-testid="feedback-copy-text">{copyText}</pre></details>}
    {notice && <p className="boring-feedback-notice" data-testid="feedback-protection">{notice}</p>}
  </section>;
}

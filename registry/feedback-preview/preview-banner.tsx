// The preview banner (FEEDBACK.md, "Preview"): while the in-page preview subagent changes the live page for the builder's
// `browser_preview` call, a fixed, clearly labelled banner says nothing is saved, lists the changes, lets the person keep talking to
// the subagent ("darker"), and offers Approve and Discard. Everything it shows and does is the headless `createPreviewSession` from
// `@hachej/boring-feedback/preview`; this file is how it looks. It is `data-feedback-ignore`, so the preview tools and every snapshot skip it.
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { readableElement } from '@hachej/boring-feedback/format';
import type { PreviewSession, PreviewSnapshot } from '@hachej/boring-feedback/preview';

const STATUS: Readonly<Record<PreviewSnapshot['status'], string>> = {
  starting: 'Preparing the preview…', working: 'Previewing…', ready: 'Preview ready', failed: 'Preview failed',
  answering: 'Sending…', approved: 'Approved', discarded: 'Discarded',
};

export interface PreviewBannerProps {
  readonly session: PreviewSession;
}

export function PreviewBanner({ session }: PreviewBannerProps) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [text, setText] = useState('');
  const busy = state.status === 'starting' || state.status === 'working' || state.status === 'answering';
  const done = state.status === 'approved' || state.status === 'discarded';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const said = text.trim();
    if (!said || busy) return;
    setText('');
    void session.say(said);
  };
  return <section data-boring="feedback" data-feedback-ignore="" role="region" aria-label="Preview of a change" aria-live="polite"
    data-testid="preview-banner" data-status={state.status} className="boring-feedback-preview">
    <div className="boring-feedback-preview-head">
      <strong className="boring-feedback-preview-title">Preview</strong>
      <span className="boring-feedback-preview-notice">these changes are not saved</span>
      <span className="boring-feedback-preview-status" data-testid="preview-status">{STATUS[state.status]}</span>
    </div>
    {state.summary && <p className="boring-feedback-preview-summary" data-testid="preview-summary">{state.summary}</p>}
    {state.changes.length > 0 && <ul className="boring-feedback-preview-changes" data-testid="preview-changes">
      {state.changes.map((change, index) => {
        const element = readableElement(change.element, change.source);
        return <li key={index} data-testid="preview-change">
          <span title={element.path}>{element.name}{element.file ? ` · ${element.file}` : ''}</span>{' '}
          <code>{change.text ? 'text' : change.property}</code> {change.from || '—'} → <strong>{change.to}</strong>
        </li>;
      })}
    </ul>}
    {state.error && <p className="boring-feedback-preview-error" role="alert" data-testid="preview-error">{state.error}</p>}
    {!done && <form className="boring-feedback-preview-actions" onSubmit={submit}>
      <input className="boring-feedback-preview-input" data-testid="preview-input" value={text} maxLength={300} disabled={busy}
        aria-label="Tell the preview what to change" placeholder="Adjust it… (e.g. darker)" onChange={event => setText(event.currentTarget.value)} />
      <button type="submit" className="boring-feedback-button" data-testid="preview-say" disabled={busy || !text.trim()}>Send</button>
      <button type="button" className="boring-feedback-button" data-variant="primary" data-testid="preview-approve" disabled={busy || state.changes.length === 0}
        onClick={() => { void session.approve(); }}>Approve</button>
      <button type="button" className="boring-feedback-button" data-testid="preview-discard" disabled={state.status === 'answering'}
        onClick={() => { void session.discard(); }}>Discard</button>
    </form>}
  </section>;
}

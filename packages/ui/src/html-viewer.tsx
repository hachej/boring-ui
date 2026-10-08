'use client';

import { TextDraftControls } from './text-draft-controls.js';

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HtmlController } from './html.js';
import type { ReadResult } from '@hachej/boring-files';
import type { SaveResult } from './resources.js';
import { passiveHtml } from './html-preview.js';

export interface HtmlViewerProps {
  readonly controller: HtmlController;
  readonly title?: string;
  readonly className?: string;
  /** `false` omits the built-in header and toolbar (mode, Save, Refresh, reconcile, discard) so a host bar such as the viewer frame supplies them. */
  readonly header?: boolean;
  /** Controlled mode; without it the viewer keeps its own and starts on the preview. */
  readonly mode?: 'source' | 'preview';
  readonly onModeChange?: (mode: 'source' | 'preview') => void;
}

function HtmlPreview({ text }: { readonly text: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'unavailable' | 'ready' | 'failed'>('unavailable');
  useLayoutEffect(() => {
    const host = container.current;
    if (!host) return;
    host.replaceChildren();
    try {
      const source = passiveHtml(text, host.ownerDocument);
      const frame = host.ownerDocument.createElement('iframe');
      frame.setAttribute('sandbox', '');
      frame.referrerPolicy = 'no-referrer';
      frame.title = 'HTML preview';
      frame.className = 'boring-html-viewer__frame';
      frame.srcdoc = source;
      host.replaceChildren(frame);
      setStatus('ready');
    } catch {
      host.replaceChildren();
      setStatus('failed');
    }
    return () => { host.replaceChildren(); };
  }, [text]);
  return <div className="boring-html-viewer__preview">
    <p role={status === 'failed' ? 'alert' : undefined}>{status === 'ready'
      ? 'Preview omits active content, attributes, and external resources.'
      : status === 'failed' ? 'Preview unavailable. Source viewing and saving remain available.'
        : 'Preview unavailable until this viewer is mounted in a browser.'}</p>
    <div ref={container} />
  </div>;
}

function MountedHtmlViewer({ controller, title = 'HTML document', className, header = true, mode: controlledMode, onModeChange }: HtmlViewerProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [ownMode, setOwnMode] = useState<'source' | 'preview'>('preview');
  const mode = controlledMode ?? ownMode;
  const setMode = (next: 'source' | 'preview') => { if (controlledMode === undefined) setOwnMode(next); onModeChange?.(next); };
  const [error, setError] = useState<string>();
  const active = useRef(true);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const pending = snapshot.save.kind === 'pending';
  const unknown = snapshot.save.kind === 'settled' && snapshot.save.result.kind === 'unknown';
  const disposed = snapshot.lifecycle === 'disposed';
  const perform = (action: () => Promise<ReadResult | SaveResult>) => {
    setError(undefined);
    void Promise.resolve().then(action).then(result => {
      if (active.current && (result.kind === 'denied' || result.kind === 'unavailable')) setError(result.reason);
    }).catch(() => { if (active.current) setError('The document operation failed. Your source has been retained.'); });
  };
  const status = disposed ? 'Viewer disposed' : snapshot.readOnly ? 'Read only' : pending ? 'Saving selected source' : unknown ? 'Save unconfirmed. Reconcile before saving again.' : snapshot.save.kind === 'settled' && snapshot.save.result.kind !== 'saved'
    ? snapshot.save.result.kind === 'partial' ? 'Save unconfirmed' : snapshot.save.result.reason
    : snapshot.dirty ? 'Unsaved changes' : 'Saved';
  return <section data-boring="html-viewer" className={['boring-html-viewer', className].filter(Boolean).join(' ')} aria-label={title}>
    {header && <header><strong>{title}</strong><span role="status">{status}</span></header>}
    {header && <div role="toolbar" aria-label="HTML document controls">
      <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>HTML preview</button>
      <button type="button" aria-pressed={mode === 'source'} onClick={() => setMode('source')}>HTML source</button>
      <button type="button" disabled={disposed || snapshot.readOnly || !snapshot.dirty || pending || unknown} onClick={() => { const selection = controller.actions.selection(); perform(() => controller.flush(selection)); }}>Save</button>
      <button type="button" disabled={disposed || pending || unknown} onClick={() => perform(controller.actions.refresh)}>Refresh</button>
      <button type="button" disabled={disposed || !unknown} onClick={() => perform(controller.actions.reconcile)}>Reconcile save</button>
      <button type="button" disabled={disposed || !unknown} onClick={() => perform(controller.actions.abandon)}>Abandon and refresh, keeping my draft</button>
      <button type="button" disabled={disposed || pending || unknown || snapshot.remote === null} onClick={() => perform(controller.actions.discardToRemote)}>Discard local edits</button>
    </div>}
    <TextDraftControls recovery={snapshot.recovery} actions={controller.actions} readOnly={snapshot.readOnly} blocked={snapshot.lifecycle !== 'active' || snapshot.save.kind === 'pending' || (snapshot.save.kind === 'settled' && snapshot.save.result.kind === 'unknown')} />
    {error && <p role="alert">{error}</p>}
    {mode === 'source'
      ? <textarea className="boring-html-viewer__source" aria-label="HTML source" readOnly={snapshot.readOnly || disposed} value={snapshot.text} onChange={event => { if (!snapshot.readOnly && !disposed) controller.actions.edit(event.currentTarget.value); }} />
      : <HtmlPreview text={snapshot.text} />}
  </section>;
}

export function HtmlViewer(props: HtmlViewerProps) {
  const [mount, setMount] = useState({ controller: props.controller, sequence: 0 });
  if (mount.controller !== props.controller) setMount({ controller: props.controller, sequence: mount.sequence + 1 });
  return <MountedHtmlViewer key={mount.sequence} {...props} />;
}

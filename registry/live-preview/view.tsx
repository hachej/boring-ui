'use client';
// The preview view and the share note. The view is the sandboxed frame (preview-frame.html in <iframe sandbox="allow-scripts">:
// without the same-origin permission, so an opaque origin) under a banner. Compact: full screen over the app. Expanded: it covers the main area (the shell
// mounts it there) while the agent panel stays visible. The app's stylesheets are sent to the frame as text; nothing else crosses over.
import { useEffect, useRef, useState } from 'react';
import { FRAME_TAG, acceptFromFrame } from './frame-protocol';
import type { RenderMessage } from './frame-protocol';
import { usePreview } from './provider';
import type { PreviewSource } from './provider';
import { previewText } from './preview-text';

const BUTTON = 'rounded-md px-3 py-1 text-sm hover:bg-background pointer-coarse:min-h-11 pointer-coarse:min-w-11';

/** The app's own stylesheets as text (the tokens and the utilities its build has). Cross-origin sheets cannot be read and are skipped. */
function appCss(): string {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try { css += Array.from(sheet.cssRules, rule => rule.cssText).join('\n') + '\n'; } catch { /* a cross-origin sheet */ }
  }
  return css;
}

function Frame({ view, onIntent }: { readonly view: PreviewSource; readonly onIntent: (text: string) => void }) {
  const preview = usePreview();
  const t = previewText(preview.locale);
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const [ready, setReady] = useState(false);
  const { report } = preview;
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const message = acceptFromFrame(event, ref.current?.contentWindow);
      if (!message) return;
      if (message.type === 'ready') {
        const render: RenderMessage = { boring: FRAME_TAG, type: 'render', source: view.source, props: view.sampleProps ?? {}, css: appCss(), dark: document.documentElement.classList.contains('dark') };
        // The frame has an opaque origin, which cannot be named as a target; what it gets is the PM's source and the app's CSS, nothing private.
        ref.current?.contentWindow?.postMessage(render, '*');
        setReady(true);
      } else if (message.type === 'size') setHeight(message.height);
      else if (message.type === 'error') report(message.message);
      else onIntent(t.intent(message.name, message.args));
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [view, report, onIntent, t]);
  return <div className="relative min-h-0 flex-1 overflow-auto bg-background">
    {!ready && <p className="p-4 text-sm text-muted-foreground">{t.loading}</p>}
    <iframe ref={ref} title={`${t.banner} · ${view.title}`} data-testid="preview-frame" src={preview.frameUrl} sandbox="allow-scripts" referrerPolicy="no-referrer"
      style={{ height: height ? `${height}px` : undefined, minHeight: '100%' }} className="block w-full border-0" />
  </div>;
}

/** Mounted once by the shell inside its main area. Renders nothing until a card is clicked. */
export function PreviewView({ compact }: { readonly compact: boolean }) {
  const preview = usePreview();
  const { view, close } = preview;
  const t = previewText(preview.locale);
  const [toast, setToast] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setToast(null); closeRef.current?.focus(); }, [view]);
  useEffect(() => {
    if (!view) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [view, close]);
  if (!view || !preview.enabled) return null;
  return <section data-testid="preview-view" aria-label={`${t.banner} · ${view.title}`}
    className={`${compact ? 'fixed inset-0 z-[70]' : 'absolute inset-0 z-40'} flex min-h-0 flex-col bg-background text-foreground`}>
    <div data-testid="preview-banner" className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium">{t.banner} · {view.title}</span>
      {preview.onSharePreview && <button type="button" data-testid="preview-share" onClick={() => void preview.share()} className={BUTTON}>{t.share}</button>}
      <button type="button" ref={closeRef} data-testid="preview-close" onClick={close} className={BUTTON}>{t.close}</button>
      {toast && <p data-testid="preview-intent" role="status" className="w-full truncate text-xs text-muted-foreground">{toast}</p>}
      {preview.error && <p data-testid="preview-error" role="alert" className="w-full text-xs text-destructive">{preview.error}</p>}
    </div>
    <Frame view={view} onIntent={setToast} />
  </section>;
}

/** The note after a share: the change is proposed, not applied; with the PR link when there is one. */
export function PreviewNote() {
  const preview = usePreview();
  const t = previewText(preview.locale);
  if (!preview.note) return null;
  return <div data-testid="preview-note" role="status" className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
    <span className="min-w-0 flex-1">{t.proposed}{preview.note.prUrl && <> — <a href={preview.note.prUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">{t.seeProposal}</a></>}</span>
    <button type="button" onClick={preview.dismissNote} className={BUTTON}>{t.close}</button>
  </div>;
}

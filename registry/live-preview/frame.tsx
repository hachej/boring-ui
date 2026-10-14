'use client';
// The sandboxed frame of one active replaceable: preview-frame.html in <iframe sandbox="allow-scripts"> (no same-origin permission, so an opaque
// origin: no cookies, storage or parent access). The app's stylesheets and the props snapshot go in by message; the frame posts its size,
// its errors and its intents back. Only messages from this iframe's own window count.
import { useEffect, useRef, useState } from 'react';
import { FRAME_TAG, acceptFromFrame } from './frame-protocol';
import type { RenderMessage } from './frame-protocol';
import { usePreview } from './provider';
import type { PreviewOverlay } from './provider';
import { previewText } from './preview-text';
import { snapshotProps } from './snapshot';

/** The app's own stylesheets as text (the tokens and the utilities its build has). Cross-origin sheets cannot be read and are skipped. */
function appCss(): string {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try { css += Array.from(sheet.cssRules, rule => rule.cssText).join('\n') + '\n'; } catch { /* a cross-origin sheet */ }
  }
  return css;
}

export function PreviewFrame({ overlay, props }: { readonly overlay: PreviewOverlay; readonly props: Readonly<Record<string, unknown>> | undefined }) {
  const { frameUrl, locale, report, setIntent } = usePreview();
  const t = previewText(locale);
  const ref = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const message = acceptFromFrame(event, ref.current?.contentWindow);
      if (!message) return;
      if (message.type === 'ready') {
        const render: RenderMessage = { boring: FRAME_TAG, type: 'render', source: overlay.source, props: snapshotProps(latest.current), css: appCss(), dark: document.documentElement.classList.contains('dark') };
        // The frame has an opaque origin, which cannot be named as a target; what it gets is the PM's source, the props snapshot and the app's CSS.
        ref.current?.contentWindow?.postMessage(render, '*');
      } else if (message.type === 'size') setHeight(message.height);
      else if (message.type === 'error') report(message.message);
      else setIntent(t.intent(message.name, message.args));
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [overlay, report, setIntent, t]);
  return <iframe ref={ref} title={`${t.banner} · ${overlay.title}`} data-testid="preview-frame" data-boring-preview-slot={overlay.key} src={frameUrl} sandbox="allow-scripts" referrerPolicy="no-referrer"
    style={{ height: `${Math.max(height, 1)}px` }} className="block w-full border-0" />;
}

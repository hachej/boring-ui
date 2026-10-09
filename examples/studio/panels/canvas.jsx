// Panel for the "Canvas" demo: the library CanvasEditor over one revisioned tldraw document that the agent draws on
// through its tools. Like the document panels it follows each newly saved revision while the local canvas is clean and
// never replaces the person's unsaved edits; Save publishes them against the revision they started from.
import 'tldraw/tldraw.css';
import { useEffect, useRef, useState } from 'react';
import { LANGUAGES, atom, createTLStore } from '@tldraw/editor';
import { DEFAULT_EMBED_DEFINITIONS, defaultBindingUtils, defaultEditorAssetUrls, defaultShapeUtils, iconTypes } from 'tldraw';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createCanvasController } from '@hachej/boring-ui-kit/canvas';
import { CanvasEditor } from '@hachej/boring-ui-kit/canvas-editor';
import { ViewerFrame } from '../../../registry/viewers/viewer-frame.tsx';
import { markdownStatus } from '../../../registry/viewers/markdown-pane.tsx';
import { shareStudioLink } from '../share-link.mjs';
import { randomUUID } from '@hachej/boring-files/platform';

const POLL_MS = 1500;
// tldraw must not fetch anything: every asset URL is an inline data URL. The font is a 576-byte TrueType file with no
// glyphs, so canvas text falls back to the browser's sans-serif; the real tldraw fonts, icons and translations are a
// separate asset qualification. With the native UI hidden, icons, translations and embed icons are never displayed.
const BLANK_FONT = 'data:font/ttf;base64,AAEAAAAKAIAAAwAgT1MvMkD2QTgAAAEoAAAAYGNtYXAADABGAAABjAAAACxnbHlmAAAAAAAAAbwAAAABaGVhZCzkcPYAAACsAAAANmhoZWEDIgEuAAAA5AAAACRobXR4AfQAAAAAAYgAAAAEbG9jYQAAAAAAAAG4AAAABG1heHAAAgACAAABCAAAACBuYW1lKx4ttQAAAcAAAABacG9zdAADAAAAAAIcAAAAJAABAAAAAQAAaVjayF8PPPUAAwPoAAAAAObnGAsAAAAA5ucYCwAAAAAAAAAAAAAAAwACAAAAAAAAAAEAAAMg/zgAAAH0AAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAEAAAABAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwH0AZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPz8/PwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAB9AAAAAAAAgAAAAMAAAAUAAMAAQAAABQABAAYAAAAAgACAAAAAP//AAD//wABAAAAAAAAAAAAAAAAAAQANgABAAAAAAABAAUAAAABAAAAAAACAAcABQADAAEECQABAAoADAADAAEECQACAA4AFkJsYW5rUmVndWxhcgBCAGwAYQBuAGsAUgBlAGcAdQBsAGEAcgAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA';
const BLANK_ICON = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E';
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ASSETS = {
  fonts: Object.fromEntries(Object.keys(defaultEditorAssetUrls.fonts).map(key => [key, BLANK_FONT])),
  icons: Object.fromEntries(iconTypes.map(key => [key, BLANK_ICON])),
  translations: Object.fromEntries(LANGUAGES.map(({ locale }) => [locale, 'data:application/json,%7B%7D'])),
  embedIcons: Object.fromEntries(DEFAULT_EMBED_DEFINITIONS.map(({ type }) => [type, BLANK_PNG])),
};
// An anonymous user store: with the default one the editor writes a per-browser `user` record into the document on
// mount, which would mark every freshly loaded canvas as having unsaved changes and stop it following the agent.
const ANONYMOUS = { currentUser: atom('studio canvas user', null) };
// The viewer frame carries the title, status, Refresh and Share, so the editor's own title, status and "Check saved version" are hidden;
// its Save button stays (it is tldraw's own editor, so only the frame wraps it).
const STYLE = `.studio-canvas { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.studio-canvas [data-boring=canvas-editor] { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.studio-canvas [data-boring=canvas-editor] > header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.375rem 0.75rem; border-bottom: 1px solid var(--border); }
.studio-canvas [data-boring=canvas-editor] > header > strong, .studio-canvas [data-boring=canvas-editor] > header > [role=status] { display: none; }
.studio-canvas [data-boring=canvas-editor] > header > button:not(:first-of-type) { display: none; }
.studio-canvas [data-boring=canvas-editor] > header > span { color: var(--muted-foreground); font-size: 0.8125rem; }
.studio-canvas [data-boring=canvas-stage] { flex: 1; min-height: 0; }`;
const fit = editor => { if (editor.getCurrentPageShapeIds().size) editor.zoomToFit({ animation: { duration: 0 } }); };

/**
 * `panel.revision` pins one saved revision, read-only, for an artifact version; without it the canvas follows the latest saved revision.
 * `frame` adjusts the viewer frame around it: `{ testId, titleTestId, controls, onClose, onShare, target }`.
 */
export function Canvas({ panel, authorized, identity, agentId, frame = {} }) {
  const [client] = useState(() => createResourceClient({ identity, endpoint: new URL('/api/resources', location.href), publication: true, reconciliation: true, fetch: authorized }));
  const [canvas, setCanvas] = useState({ kind: 'loading' });
  const current = useRef(canvas);
  current.current = canvas;
  // The controller's own base revision moves when the person saves; mirror it so the panel reports what is shown.
  const [, refresh] = useState(0);
  useEffect(() => canvas.kind === 'open' ? canvas.controller.subscribe(() => refresh(count => count + 1)) : undefined, [canvas]);
  useEffect(() => {
    let cancelled = false;
    const follow = async () => {
      const held = current.current;
      if (held.kind === 'open' && (held.controller.getSnapshot().dirty || held.controller.getSnapshot().save.kind === 'pending')) return;
      const read = await client.read({ target: panel.target, revision: panel.revision ? { kind: 'exact', value: panel.revision } : { kind: 'latest' } }).catch(() => undefined);
      if (cancelled || !read) return;
      if (read.kind !== 'available') { if (held.kind !== 'open') setCanvas({ kind: read.kind }); return; }
      if (held.kind === 'open') {
        const state = held.controller.getSnapshot();
        if (state.dirty || state.save.kind === 'pending' || (state.base.kind === 'revision' && state.base.target.revision === read.snapshot.ref.revision)) return;
      }
      // One borrowed native store per saved revision: the controller refuses to load a saved source over other content.
      const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, users: ANONYMOUS });
      let controller;
      try { controller = createCanvasController({ store, client, identity, instanceId: randomUUID(), epoch: 'studio', source: { kind: 'saved', snapshot: read.snapshot }, ...(panel.revision ? { readOnly: true } : {}) }); }
      catch (error) { store.dispose(); if (held.kind !== 'open') setCanvas({ kind: 'invalid', reason: error?.message ?? String(error) }); return; }
      if (held.kind === 'open') held.controller.dispose();
      setCanvas({ kind: 'open', controller, store });
    };
    follow();
    const timer = panel.revision ? undefined : setInterval(follow, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); if (current.current.kind === 'open') current.current.controller.dispose(); };
  }, [client, panel.target.resource.path, panel.revision]);
  if (canvas.kind !== 'open') return <div className="studio-viewer" data-testid="canvas-viewer">
    <ViewerFrame title={panel.title ?? 'Canvas'} target={frame.target ?? { variant: agentId }} testId={frame.testId ?? 'viewer'} {...(frame.titleTestId ? { titleTestId: frame.titleTestId } : {})}
      {...(frame.onClose ? { onClose: frame.onClose } : {})} {...(frame.controls ? { controls: frame.controls } : {})}>
      <p className="studio-empty" data-testid="no-document">{canvas.kind === 'loading' ? 'Loading…' : canvas.kind === 'invalid' ? `The saved canvas cannot be shown: ${canvas.reason}` : 'Nothing drawn yet. Ask the agent to draw something.'}</p>
    </ViewerFrame>
  </div>;
  const state = canvas.controller.getSnapshot();
  const shapes = Object.values(state.document.store).filter(record => record.typeName === 'shape').length;
  const revision = state.base.kind === 'revision' ? state.base.target.revision : '';
  return <div className="studio-viewer" data-testid="canvas-viewer">
    <ViewerFrame title={panel.title ?? 'Canvas'} subtitle={<span data-testid="canvas-shapes">Canvas · {shapes} {shapes === 1 ? 'shape' : 'shapes'}</span>} status={markdownStatus(state)}
      target={frame.target ?? { variant: agentId }} revision={revision} testId={frame.testId ?? 'viewer'} {...(frame.titleTestId ? { titleTestId: frame.titleTestId } : {})}
      onRefresh={() => canvas.controller.actions.refresh()} onShare={frame.onShare ?? shareStudioLink} {...(frame.onClose ? { onClose: frame.onClose } : {})} {...(frame.controls ? { controls: frame.controls } : {})}>
      <div className="studio-canvas" data-testid="document" data-revision={revision} data-shapes={shapes}>
        <style>{STYLE}</style>
        <CanvasEditor controller={canvas.controller} assetUrls={ASSETS} title={panel.title} height="auto" onMount={fit} />
      </div>
    </ViewerFrame>
  </div>;
}


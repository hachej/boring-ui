'use client';

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useEditor, useValue, GeoShapeGeoStyle, LANGUAGES } from '@tldraw/editor';
import type { Editor, TLOnMountHandler } from '@tldraw/editor';
import { Tldraw, iconTypes, DEFAULT_EMBED_DEFINITIONS } from 'tldraw';
import type { TLDefaultFonts, TLUiAssetUrls } from 'tldraw';
import type { ReadResult } from '@hachej/boring-files';
import type { SaveResult } from './resources.js';
import type { CanvasController } from './canvas.js';
import { createMountedCanvasTools } from './canvas-mounted.js';
import type { CanvasMountedTools } from './canvas-mounted.js';
import { CanvasProposals } from './canvas-proposals.js';

export type CanvasFontUrls = Readonly<Record<`${keyof TLDefaultFonts}${'' | '_italic' | '_bold' | '_italic_bold'}`, string>>;
export type CanvasAssetUrls = Omit<TLUiAssetUrls, 'fonts' | 'embedIcons'> & {
  readonly fonts: CanvasFontUrls;
  readonly embedIcons: Required<TLUiAssetUrls['embedIcons']>;
};
export interface CanvasEditorProps {
  readonly controller: CanvasController;
  readonly assetUrls: CanvasAssetUrls;
  readonly title?: string;
  readonly className?: string;
  readonly height?: CSSProperties['height'];
  readonly licenseKey?: string;
  readonly onMount?: TLOnMountHandler;
  readonly onMountedTools?: (tools: CanvasMountedTools | null) => void;
}

const fontKeys: readonly (keyof CanvasFontUrls)[] = [
  'tldraw_draw', 'tldraw_draw_italic', 'tldraw_draw_bold', 'tldraw_draw_italic_bold',
  'tldraw_sans', 'tldraw_sans_italic', 'tldraw_sans_bold', 'tldraw_sans_italic_bold',
  'tldraw_serif', 'tldraw_serif_italic', 'tldraw_serif_bold', 'tldraw_serif_italic_bold',
  'tldraw_mono', 'tldraw_mono_italic', 'tldraw_mono_bold', 'tldraw_mono_italic_bold',
];
function assetSignature(assets: CanvasAssetUrls): string {
  const requirements: [string, unknown][] = [
    ...fontKeys.map((key): [string, unknown] => [`fonts.${key}`, assets?.fonts?.[key]]),
    ...iconTypes.map((key): [string, unknown] => [`icons.${key}`, assets?.icons?.[key]]),
    ...LANGUAGES.map(({ locale }): [string, unknown] => [`translations.${locale}`, assets?.translations?.[locale]]),
    ...DEFAULT_EMBED_DEFINITIONS.map(({ type }): [string, unknown] => [`embedIcons.${type}`, assets?.embedIcons?.[type]]),
  ];
  for (const [key, value] of requirements) if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Canvas asset URL is required: ${key}`);
  return JSON.stringify(requirements);
}

export default function NativeCanvas({ controller, assetUrls, title = 'Canvas', className, height = 480, licenseKey, onMount, onMountedTools }: CanvasEditorProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nativeEditor, setNativeEditor] = useState<Editor | null>(null);
  const mounted = useRef(true);
  const revokeTools = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const signature = useMemo(() => assetSignature(assetUrls), [assetUrls]);
  const assets = useMemo(() => ({ fonts: { ...assetUrls.fonts }, icons: { ...assetUrls.icons }, translations: { ...assetUrls.translations }, embedIcons: { ...assetUrls.embedIcons } }), [signature]);
  const outcome = state.save.kind === 'settled' ? state.save.result : undefined;
  const pending = state.save.kind === 'pending';
  const uncertain = outcome?.kind === 'unknown';
  const conflict = outcome?.kind === 'conflict' || state.remote !== null;
  const unavailable = state.readOnly || state.lifecycle === 'disposed';
  const run = async (action: () => Promise<ReadResult | SaveResult>) => {
    if (!mounted.current || controller.getSnapshot().lifecycle === 'disposed') return;
    setBusy(true); setError(null);
    try {
      const result = await action();
      if (mounted.current && (result.kind === 'unavailable' || result.kind === 'denied' || result.kind === 'conflict' || result.kind === 'unknown')) setError(result.reason);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Canvas operation failed');
    } finally { if (mounted.current) setBusy(false); }
  };
  const save = () => run(() => controller.flush(controller.actions.selection()));
  const attach = (editor: Editor) => {
    if (controller.getSnapshot().readOnly || controller.getSnapshot().lifecycle === 'disposed') editor.updateInstanceState({ isReadonly: true });
    editor.registerExternalAssetHandler('file', null);
    editor.registerExternalAssetHandler('url', null);
    for (const type of externalContentTypes) editor.registerExternalContentHandler(type, null);
    const cleanup = onMount?.(editor);
    setNativeEditor(editor);
    return () => { revokeTools.current?.(); setNativeEditor(current => current === editor ? null : current); cleanup?.(); };
  };
  return <section className={className} data-boring="canvas-editor" data-dirty={state.dirty || undefined}
    onKeyDownCapture={event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!unavailable && !pending && !uncertain && !busy && !state.problem) void save();
      }
    }}>
    <header><strong>{title}</strong>{state.readOnly && <span>Read only</span>}
      <span role="status">{state.lifecycle === 'disposed' ? 'Closed' : pending ? 'Saving' : uncertain ? 'Save unconfirmed' : conflict ? 'Changed elsewhere' : state.dirty ? 'Unsaved changes' : 'Saved'}</span>
      <button type="button" disabled={unavailable || !state.dirty || pending || uncertain || busy || state.problem !== null} onClick={() => void save()}>Save</button>
      <button type="button" disabled={state.lifecycle === 'disposed' || pending || uncertain || busy} onClick={() => void run(controller.actions.refresh)}>Check saved version</button>
    </header>
    {uncertain && <div role="alert">Save acknowledgement was lost. Your current canvas is retained.
      <button type="button" disabled={busy} onClick={() => void run(controller.actions.reconcile)}>Check save outcome</button>
      <button type="button" disabled={busy || state.lifecycle === 'disposed'} onClick={() => void run(controller.actions.abandon)}>Keep draft and refresh</button>
    </div>}
    {conflict && <div role="alert">The saved canvas changed. Your local edits have been kept.
      <button type="button" disabled={pending || uncertain || busy} onClick={() => void run(controller.actions.discardToRemote)}>Discard local changes and reload</button>
    </div>}
    {state.problem && <p role="alert">{state.problem}</p>}
    {(outcome?.kind === 'denied' || outcome?.kind === 'unavailable') && <p role="alert">{outcome.reason}</p>}
    {error && <p role="alert">{error}</p>}
    <CanvasProposals controller={controller} state={state} editor={nativeEditor} busy={busy} run={run} />
    {state.lifecycle === 'active' && <div data-boring="canvas-stage" style={{ position: 'relative', height }}
      onClickCapture={event => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); }}
      onAuxClickCapture={event => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); }}>
      <Tldraw store={controller.store} hideUi locale="en"
        autoFocus={false} assetUrls={assets} {...(licenseKey === undefined ? {} : { licenseKey })} onMount={attach}>
        <CanvasTools controller={controller} />
        <MountedCommands controller={controller} revokeTools={revokeTools} {...(onMountedTools ? { onMountedTools } : {})} />
      </Tldraw>
    </div>}
  </section>;
}

const externalContentTypes: readonly Parameters<Editor['registerExternalContentHandler']>[0][] = ['text', 'files', 'file-replace', 'embed', 'svg-text', 'url', 'tldraw', 'excalidraw'];

const choices: readonly (readonly [string, string])[] = [
  ['select', 'Select'], ['hand', 'Hand'], ['draw', 'Draw'], ['geo', 'Rectangle'], ['text', 'Text'],
  ['arrow', 'Arrow'], ['line', 'Line'], ['note', 'Note'], ['frame', 'Frame'], ['highlight', 'Highlight'], ['eraser', 'Erase'],
];
function CanvasTools({ controller }: Pick<CanvasEditorProps, 'controller'>) {
  const editor = useEditor();
  const state = useValue('canvas controls', () => ({ tool: editor.getCurrentToolId(), readOnly: controller.getSnapshot().readOnly || editor.getIsReadonly(), undo: editor.getCanUndo(), redo: editor.getCanRedo() }), [editor]);
  const act = (action: () => void, changesDocument = true) => {
    if (!editor.isDisposed && controller.getSnapshot().lifecycle === 'active'
      && (!changesDocument || (!controller.getSnapshot().readOnly && !editor.getIsReadonly()))) action();
  };
  return <div role="toolbar" aria-label="Canvas tools" style={{ position: 'absolute', top: 8, left: 8, zIndex: 300, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
    {choices.map(([id, label]) => <button key={id} type="button" aria-pressed={state.tool === id} disabled={state.readOnly && id !== 'hand' && id !== 'select'}
      onClick={() => act(() => { if (id === 'geo') editor.setStyleForNextShapes(GeoShapeGeoStyle, 'rectangle'); editor.setCurrentTool(id); }, id !== 'hand' && id !== 'select')}>{label}</button>)}
    <button type="button" disabled={state.readOnly || !state.undo} onClick={() => act(() => { editor.undo(); })}>Undo</button>
    <button type="button" disabled={state.readOnly || !state.redo} onClick={() => act(() => { editor.redo(); })}>Redo</button>
    <button type="button" onClick={() => act(() => { editor.zoomToFit(); }, false)}>Fit canvas</button>
  </div>;
}

function MountedCommands({ controller, onMountedTools, revokeTools }: Pick<CanvasEditorProps, 'controller' | 'onMountedTools'> & { readonly revokeTools: RefObject<(() => void) | null> }) {
  const editor = useEditor();
  const binding = useMemo(() => createMountedCanvasTools({ controller, editor }), [controller, editor]);
  useLayoutEffect(() => {
    binding.activate(); revokeTools.current = binding.dispose;
    return () => { binding.dispose(); if (revokeTools.current === binding.dispose) revokeTools.current = null; };
  }, [binding, revokeTools]);
  useLayoutEffect(() => {
    onMountedTools?.(binding.tools);
    return () => { onMountedTools?.(null); };
  }, [binding, onMountedTools]);
  return null;
}

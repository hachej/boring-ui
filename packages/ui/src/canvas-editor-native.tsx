'use client';

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useEditor, useValue, GeoShapeGeoStyle, LANGUAGES } from '@tldraw/editor';
import type { Editor, TLOnMountHandler } from '@tldraw/editor';
import { Tldraw, iconTypes, DEFAULT_EMBED_DEFINITIONS } from 'tldraw';
import type { TLDefaultFonts, TLUiAssetUrls, TldrawProps } from 'tldraw';
import type { ReadResult } from '@hachej/boring-files';
import type { SaveResult } from './resources.js';
import type { CanvasController } from './canvas.js';
import { createMountedCanvasTools } from './canvas-mounted.js';
import type { CanvasMountedTools } from './canvas-mounted.js';
import { CanvasProposals } from './canvas-proposals.js';
import type { ViewerComponents } from './viewer-components.js';

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
  /** Host presentation for the canvas controls; without it the package renders unstyled native buttons. */
  readonly components?: ViewerComponents;
}

/** A borrowed native renderer for a host-owned document projection. It never saves the native store. */
export type CanvasProjectionProps = Pick<TldrawProps, 'store' | 'shapeUtils' | 'hideUi' | 'children' | 'onMount' | 'onUiEvent'> & {
  readonly assetUrls: CanvasAssetUrls;
  readonly licenseKey?: string | undefined;
};

export function NativeCanvasProjection({ assetUrls, licenseKey, onMount, ...props }: CanvasProjectionProps) {
  const signature = useMemo(() => assetSignature(assetUrls), [assetUrls]);
  const assets = useMemo(() => ({ fonts: { ...assetUrls.fonts }, icons: { ...assetUrls.icons }, translations: { ...assetUrls.translations }, embedIcons: { ...assetUrls.embedIcons } }), [signature]);
  return <Tldraw {...props} autoFocus={false} locale="en" assetUrls={assets} {...(licenseKey === undefined ? {} : { licenseKey })} onMount={editor => {
    editor.registerExternalAssetHandler('file', null);
    editor.registerExternalAssetHandler('url', null);
    for (const type of externalContentTypes) editor.registerExternalContentHandler(type, null);
    return onMount?.(editor);
  }} />;
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

export default function NativeCanvas({ controller, assetUrls, title = 'Canvas', className, height = 480, licenseKey, onMount, onMountedTools, components }: CanvasEditorProps) {
  const Control = components?.button ?? 'button';
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nativeEditor, setNativeEditor] = useState<Editor | null>(null);
  const mounted = useRef(true);
  const revokeTools = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
      if (mounted.current && (result.kind === 'unavailable' || result.kind === 'denied' || result.kind === 'conflict' || result.kind === 'unknown' || result.kind === 'file_too_large')) setError(result.reason);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Canvas operation failed');
    } finally { if (mounted.current) setBusy(false); }
  };
  const save = () => run(() => controller.flush(controller.actions.selection()));
  const attach = (editor: Editor) => {
    if (controller.getSnapshot().readOnly || controller.getSnapshot().lifecycle === 'disposed') editor.updateInstanceState({ isReadonly: true });
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
      <Control type="button" disabled={unavailable || !state.dirty || pending || uncertain || busy || state.problem !== null} onClick={() => void save()}>Save</Control>
      <Control type="button" disabled={state.lifecycle === 'disposed' || pending || uncertain || busy} onClick={() => void run(controller.actions.refresh)}>Check saved version</Control>
    </header>
    {uncertain && <div role="alert">Save acknowledgement was lost. Your current canvas is retained.
      <Control type="button" disabled={busy} onClick={() => void run(controller.actions.reconcile)}>Check save outcome</Control>
      <Control type="button" disabled={busy || state.lifecycle === 'disposed'} onClick={() => void run(controller.actions.abandon)}>Keep draft and refresh</Control>
    </div>}
    {conflict && <div role="alert">The saved canvas changed. Your local edits have been kept.
      <Control type="button" disabled={pending || uncertain || busy} onClick={() => void run(controller.actions.discardToRemote)}>Discard local changes and reload</Control>
    </div>}
    {state.problem && <p role="alert">{state.problem}</p>}
    {(outcome?.kind === 'denied' || outcome?.kind === 'unavailable' || outcome?.kind === 'file_too_large') && <p role="alert">{outcome.reason}</p>}
    {error && <p role="alert">{error}</p>}
    <CanvasProposals components={components} controller={controller} state={state} editor={nativeEditor} busy={busy} run={run} />
    {state.lifecycle === 'active' && <div data-boring="canvas-stage" style={{ position: 'relative', height }}
      onClickCapture={event => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); }}
      onAuxClickCapture={event => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); }}>
      <NativeCanvasProjection store={controller.store} hideUi assetUrls={assetUrls} licenseKey={licenseKey} onMount={attach}>
        <CanvasTools components={components} controller={controller} />
        <MountedCommands controller={controller} revokeTools={revokeTools} {...(onMountedTools ? { onMountedTools } : {})} />
      </NativeCanvasProjection>
    </div>}
  </section>;
}

const externalContentTypes: readonly Parameters<Editor['registerExternalContentHandler']>[0][] = ['text', 'files', 'file-replace', 'embed', 'svg-text', 'url', 'tldraw', 'excalidraw'];

const choices: readonly (readonly [string, string])[] = [
  ['select', 'Select'], ['hand', 'Hand'], ['draw', 'Draw'], ['geo', 'Rectangle'], ['text', 'Text'],
  ['arrow', 'Arrow'], ['line', 'Line'], ['note', 'Note'], ['frame', 'Frame'], ['highlight', 'Highlight'], ['eraser', 'Erase'],
];
function CanvasTools({ controller, components }: Pick<CanvasEditorProps, 'controller'> & { readonly components?: ViewerComponents | undefined }) {
  const Control = components?.button ?? 'button';
  const editor = useEditor();
  const state = useValue('canvas controls', () => ({ tool: editor.getCurrentToolId(), readOnly: controller.getSnapshot().readOnly || editor.getIsReadonly(), undo: editor.getCanUndo(), redo: editor.getCanRedo() }), [editor]);
  const act = (action: () => void, changesDocument = true) => {
    if (!editor.isDisposed && controller.getSnapshot().lifecycle === 'active'
      && (!changesDocument || (!controller.getSnapshot().readOnly && !editor.getIsReadonly()))) action();
  };
  return <div role="toolbar" aria-label="Canvas tools" style={{ position: 'absolute', top: 8, left: 8, zIndex: 300, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
    {choices.map(([id, label]) => <Control key={id} type="button" aria-pressed={state.tool === id} disabled={state.readOnly && id !== 'hand' && id !== 'select'}
      onClick={() => act(() => { if (id === 'geo') editor.setStyleForNextShapes(GeoShapeGeoStyle, 'rectangle'); editor.setCurrentTool(id); }, id !== 'hand' && id !== 'select')}>{label}</Control>)}
    <Control type="button" disabled={state.readOnly || !state.undo} onClick={() => act(() => { editor.undo(); })}>Undo</Control>
    <Control type="button" disabled={state.readOnly || !state.redo} onClick={() => act(() => { editor.redo(); })}>Redo</Control>
    <Control type="button" onClick={() => act(() => { editor.zoomToFit(); }, false)}>Fit canvas</Control>
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

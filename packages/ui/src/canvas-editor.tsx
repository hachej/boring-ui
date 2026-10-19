'use client';

import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
export type { CanvasMountedSubject, CanvasMountedInspection, CanvasMountedTools } from './canvas-mounted.js';
import type { CanvasEditorProps, CanvasProjectionProps } from './canvas-editor-native.js';

export type { CanvasAssetUrls, CanvasEditorProps, CanvasFontUrls, CanvasProjectionProps } from './canvas-editor-native.js';

import { TextDraftControls } from './text-draft-controls.js';

const NativeCanvas = lazy(() => import('./canvas-editor-native.js'));
const NativeProjection = lazy(() => import('./canvas-editor-native.js').then(module => ({ default: module.NativeCanvasProjection })));

/** Native tldraw presentation for a host format such as board@1. No document controller or native persistence. */
export function CanvasProjection(props: CanvasProjectionProps) {
  return <Suspense fallback={<p role="status">Loading canvas</p>}><NativeProjection {...props} /></Suspense>;
}

/** Borrows one controller/store. The host supplies native CSS, fonts and any production license. */
export function CanvasEditor(props: CanvasEditorProps) {
  const state = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot);
  const [mount, setMount] = useState({ controller: props.controller, sequence: 0 });
  if (mount.controller !== props.controller) setMount({ controller: props.controller, sequence: mount.sequence + 1 });
  return <>
    <TextDraftControls key={mount.sequence} components={props.components} recovery={state.recovery} actions={props.controller.actions} readOnly={state.readOnly} blocked={state.lifecycle !== 'active' || state.save.kind === 'pending' || (state.save.kind === 'settled' && state.save.result.kind === 'unknown')} />
    <Suspense fallback={<p role="status">Loading canvas</p>}>
    <NativeCanvas key={mount.sequence} {...props} />
  </Suspense>
  </>;
}

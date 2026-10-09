'use client';

import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
export type { CanvasMountedSubject, CanvasMountedInspection, CanvasMountedTools } from './canvas-mounted.js';
import type { CanvasEditorProps } from './canvas-editor-native.js';

export type { CanvasAssetUrls, CanvasEditorProps, CanvasFontUrls } from './canvas-editor-native.js';

import { TextDraftControls } from './text-draft-controls.js';

const NativeCanvas = lazy(() => import('./canvas-editor-native.js'));

/** Borrows one controller/store. The host supplies native CSS, fonts and any production license. */
export function CanvasEditor(props: CanvasEditorProps) {
  const state = useSyncExternalStore(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot);
  const [mount, setMount] = useState({ controller: props.controller, sequence: 0 });
  if (mount.controller !== props.controller) setMount({ controller: props.controller, sequence: mount.sequence + 1 });
  return <>
    <TextDraftControls key={mount.sequence} recovery={state.recovery} actions={props.controller.actions} readOnly={state.readOnly} blocked={state.lifecycle !== 'active' || state.save.kind === 'pending' || (state.save.kind === 'settled' && state.save.result.kind === 'unknown')} />
    <Suspense fallback={<p role="status">Loading canvas</p>}>
    <NativeCanvas key={mount.sequence} {...props} />
  </Suspense>
  </>;
}

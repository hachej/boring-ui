'use client';

import { TextDraftControls } from './text-draft-controls.js';

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ExperienceRenderer } from './experience-renderer.js';
import type { RenderedExperienceCell } from './experience-renderer.js';
import type { ExperienceAccess } from './experience-compose.js';
import type { ExperienceDocumentController, ExperienceRegionRequest } from './experience-document.js';
import type { ReadResult } from '@hachej/boring-files';
import type { SaveResult } from './resources.js';
import { layoutProps } from './experience-catalog.js';
import type { ViewerComponents } from './viewer-components.js';

export interface ExperienceDocumentProps {
  readonly controller: ExperienceDocumentController;
  readonly cells: readonly RenderedExperienceCell[];
  readonly canView: ExperienceAccess['canView'];
  readonly onRegenerate?: (request: ExperienceRegionRequest) => void | Promise<void>;
  readonly title?: string;
  readonly className?: string;
  /** Host presentation for the layout controls; without it the package renders unstyled native buttons. */
  readonly components?: ViewerComponents;
}
function MountedDocument({ controller, cells, canView, onRegenerate, title = 'Experience layout', className, components }: ExperienceDocumentProps) {
  const Control = components?.button ?? 'button';
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [error, setError] = useState<string>();
  const active = useRef(true);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const pending = state.save.kind === 'pending';
  const unknown = state.save.kind === 'settled' && state.save.result.kind === 'unknown';
  const disposed = state.lifecycle === 'disposed';
  const proposal = state.proposal;
  const regions = Object.values(state.descriptor?.elements ?? {}).flatMap(element => element.type === 'boring/generated'
    ? [layoutProps['boring/generated'].parse(element.props)] : []);
  const perform = (action: () => Promise<ReadResult | SaveResult>) => {
    setError(undefined);
    void Promise.resolve().then(action).then(result => {
      if (active.current && (result.kind === 'denied' || result.kind === 'unavailable' || result.kind === 'file_too_large')) setError(result.reason);
    }).catch(() => { if (active.current) setError('The layout operation failed. The draft has been retained.'); });
  };
  const status = disposed ? 'Viewer disposed' : state.readOnly ? 'Read only' : pending ? 'Keeping selected layout' : unknown ? 'Keep unconfirmed. Reconcile before keeping again.'
    : state.save.kind === 'settled' && state.save.result.kind !== 'saved' ? state.save.result.reason
      : state.dirty ? 'Layout not kept' : 'Layout kept';
  return <section data-boring="experience-document" className={className} aria-label={title}>
    <header><strong>{title}</strong><span role="status">{status}</span></header>
    <div role="toolbar" aria-label="Layout document controls">
      <Control type="button" disabled={disposed || state.readOnly || !state.dirty || !state.descriptor || pending || unknown} onClick={() => { const selection = controller.actions.selection(); perform(() => controller.flush(selection)); }}>Keep this layout</Control>
      <Control type="button" disabled={disposed || pending || unknown} onClick={() => perform(controller.actions.refresh)}>Refresh layout</Control>
      <Control type="button" disabled={disposed || !unknown} onClick={() => perform(controller.actions.reconcile)}>Reconcile keep</Control>
      <Control type="button" disabled={disposed || pending || unknown || state.remote === null} onClick={() => perform(controller.actions.discardToRemote)}>Discard local layout</Control>
      {state.pin && <Control type="button" disabled={disposed || state.readOnly || pending || unknown} onClick={() => {
        const pin = state.pin;
        if (pin) perform(() => controller.actions.pin(pin.selection));
      }}>Pin this region</Control>}
      {regions.filter(region => region.regenerate.includes('request')).map(region => <Control key={region.region} type="button" disabled={disposed || state.readOnly || !onRegenerate} onClick={() => {
        const result = controller.actions.beginRegion(controller.actions.selection(), region.region, 'request');
        if (result.kind !== 'applied') { setError('reason' in result ? result.reason : 'Region request was not started'); return; }
        setError(undefined);
        void Promise.resolve().then(() => onRegenerate?.(result.value)).catch(() => {
          if (active.current) setError('The region could not be regenerated. The current layout has been retained.');
        });
      }}>Regenerate {region.region}</Control>)}
    </div>
    <TextDraftControls components={components} recovery={state.recovery} actions={controller.actions} readOnly={state.readOnly} blocked={state.lifecycle !== 'active' || state.save.kind === 'pending' || (state.save.kind === 'settled' && state.save.result.kind === 'unknown')} />
    {proposal && <div role="group" aria-label={proposal.kind === 'region' ? 'Proposed region' : 'Proposed layout'}>
      <Control type="button" disabled={disposed || state.readOnly} onClick={() => {
        const result = controller.actions.adopt(proposal.id);
        setError(result.kind === 'applied' ? undefined : 'reason' in result ? result.reason : 'Layout was not adopted');
      }}>{proposal.kind === 'region' ? 'Use proposed region' : 'Use proposed layout'}</Control>
      <Control type="button" disabled={disposed} onClick={() => { controller.actions.reject(proposal.id); setError(undefined); }}>{proposal.kind === 'region' ? 'Dismiss proposed region' : 'Dismiss proposed layout'}</Control>
    </div>}
    {(error || state.problem) && <p role="alert">{error ?? state.problem}</p>}
    {state.descriptor ? <section data-boring="experience" aria-label={state.descriptor.title ?? state.descriptor.name}><ExperienceRenderer descriptor={state.descriptor} cells={cells} canView={canView} /></section> : <p>No layout selected</p>}
  </section>;
}
export function ExperienceDocument(props: ExperienceDocumentProps) {
  const [mount, setMount] = useState({ controller: props.controller, sequence: 0 });
  if (mount.controller !== props.controller) setMount({ controller: props.controller, sequence: mount.sequence + 1 });
  return <MountedDocument key={mount.sequence} {...props} />;
}

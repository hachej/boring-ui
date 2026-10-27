'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { TextDraftActions, TextDraftRecoveryState } from './text-draft-types.js';
import type { ViewerComponents } from './viewer-components.js';
import { textDraftLabels, type TextDraftLabels } from './text-draft-labels.js';
export type { TextDraftLabels } from './text-draft-labels.js';

export interface TextDraftControlsProps {
  readonly components?: ViewerComponents | undefined;
  readonly recovery: TextDraftRecoveryState;
  readonly actions: TextDraftActions;
  readonly readOnly?: boolean;
  readonly blocked?: boolean;
  /** Words of the panel. Defaults to English; a host passes the French set or its own. */
  readonly labels?: TextDraftLabels;
}

export function TextDraftControls({ components, recovery, actions, readOnly = false, blocked = false, labels = textDraftLabels.en }: TextDraftControlsProps) {
  const Control = components?.button ?? 'button';
  const owner = useRef<{ readonly actions: TextDraftActions; busy: boolean } | undefined>({ actions, busy: false });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string>();
  useLayoutEffect(() => { owner.current = { actions, busy: false }; setPending(false); setNotice(undefined); return () => { if (owner.current?.actions === actions) owner.current = undefined; }; }, [actions]);
  if (recovery.kind === 'disabled') return null;
  const active = recovery.kind === 'active';
  const run = (action: () => Promise<{ readonly kind: string; readonly reason?: string }>) => {
    if (!owner.current || owner.current.busy || owner.current.actions !== actions) return;
    const capturedOwner = owner.current;
    capturedOwner.busy = true;
    setPending(true); setNotice(undefined);
    void Promise.resolve().then(action).then(result => {
      if (owner.current === capturedOwner) setNotice(result.reason ?? (result.kind === 'restored' ? labels.draftRestored : result.kind === 'discarded' ? labels.draftDiscarded : undefined));
    }, () => { if (owner.current === capturedOwner) setNotice(labels.draftStorageFailed); }).finally(() => { if (owner.current === capturedOwner) { capturedOwner.busy = false; setPending(false); }; });
  };
  const discovery = active ? recovery.discovery : undefined;
  const checkpoint = active ? recovery.checkpoint : undefined;
  const status = !active ? labels.draftRecoveryState(recovery.kind) : discovery?.kind === 'checking' ? labels.draftChecking : checkpoint?.kind === 'pending' ? labels.draftStoring : checkpoint?.kind === 'stored' ? labels.draftStored : checkpoint?.kind === 'failed' ? labels.draftStorageUnavailable : labels.draftEnabled;
  return <section data-boring="text-draft-controls" aria-label={labels.draftRecovery}>
    <p role="status">{status}</p>
    <Control type="button" disabled={!active || pending || blocked || discovery?.kind === 'checking'} onClick={() => run(actions.checkDrafts)}>{labels.checkStoredDrafts}</Control>
    <Control type="button" disabled={!active || pending || readOnly} onClick={() => run(actions.checkpointDraft)}>{labels.storeDraft}</Control>
    {discovery?.kind === 'empty' && <p>{labels.noStoredDrafts}</p>}
    {discovery && 'reason' in discovery && <p role="alert">{discovery.reason}</p>}
    {checkpoint?.kind === 'failed' && <p role="alert">{checkpoint.result.reason}</p>}
    {discovery?.kind === 'offered' && <>
      {discovery.truncated && <p>{labels.moreStoredDrafts}</p>}
      {discovery.choices.map(choice => <div key={`${choice.selection.offerId}:${choice.selection.draft.writerId}:${choice.selection.draft.sequence}`} role="group" aria-label={labels.storedDraft}>
        <p>{choice.compatibility === 'conflict' ? labels.draftConflict : labels.draftMatches}</p>
        <details><summary>{labels.reviewStoredDraft}</summary><pre>{choice.text}</pre></details>
        <Control type="button" disabled={pending || blocked || readOnly || choice.compatibility !== 'exact'} onClick={() => run(() => actions.restoreDraft(choice.selection))}>{labels.restoreDraft}</Control>
        <Control type="button" disabled={pending || blocked} onClick={() => run(() => actions.discardDraft(choice.selection))}>{labels.discardStoredDraft}</Control>
      </div>)}
    </>}
    {notice && <p role="alert">{notice}</p>}
  </section>;
}

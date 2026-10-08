'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { TextDraftActions, TextDraftRecoveryState } from './text-draft-types.js';

export interface TextDraftControlsProps {
  readonly recovery: TextDraftRecoveryState;
  readonly actions: TextDraftActions;
  readonly readOnly?: boolean;
  readonly blocked?: boolean;
}

export function TextDraftControls({ recovery, actions, readOnly = false, blocked = false }: TextDraftControlsProps) {
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
      if (owner.current === capturedOwner) setNotice(result.reason ?? (result.kind === 'restored' ? 'Draft restored locally. Save to publish it.' : result.kind === 'discarded' ? 'Stored draft discarded. Current edits are unchanged.' : undefined));
    }, () => { if (owner.current === capturedOwner) setNotice('Draft storage unavailable. Current edits are unchanged.'); }).finally(() => { if (owner.current === capturedOwner) { capturedOwner.busy = false; setPending(false); }; });
  };
  const discovery = active ? recovery.discovery : undefined;
  const checkpoint = active ? recovery.checkpoint : undefined;
  const status = !active ? `Draft recovery ${recovery.kind}` : discovery?.kind === 'checking' ? 'Checking stored drafts' : checkpoint?.kind === 'pending' ? 'Storing draft' : checkpoint?.kind === 'stored' ? 'Draft stored for recovery. Storage is not a save receipt.' : checkpoint?.kind === 'failed' ? 'Draft recovery storage unavailable' : 'Draft recovery enabled';
  return <section data-boring="text-draft-controls" aria-label="Draft recovery">
    <p role="status">{status}</p>
    <button type="button" disabled={!active || pending || blocked || discovery?.kind === 'checking'} onClick={() => run(actions.checkDrafts)}>Check stored drafts</button>
    <button type="button" disabled={!active || pending || readOnly} onClick={() => run(actions.checkpointDraft)}>Store draft for recovery</button>
    {discovery?.kind === 'empty' && <p>No stored drafts</p>}
    {discovery && 'reason' in discovery && <p role="alert">{discovery.reason}</p>}
    {checkpoint?.kind === 'failed' && <p role="alert">{checkpoint.result.reason}</p>}
    {discovery?.kind === 'offered' && <>
      {discovery.truncated && <p>More stored drafts exist than this listing shows.</p>}
      {discovery.choices.map(choice => <div key={`${choice.selection.offerId}:${choice.selection.draft.writerId}:${choice.selection.draft.sequence}`} role="group" aria-label="Stored draft">
        <p>{choice.compatibility === 'conflict' ? 'Saved revision changed. Review this draft separately.' : 'Stored draft matches the checked saved revision.'}</p>
        <details><summary>Review stored draft</summary><pre>{choice.text}</pre></details>
        <button type="button" disabled={pending || blocked || readOnly || choice.compatibility !== 'exact'} onClick={() => run(() => actions.restoreDraft(choice.selection))}>Restore draft</button>
        <button type="button" disabled={pending || blocked} onClick={() => run(() => actions.discardDraft(choice.selection))}>Discard stored draft</button>
      </div>)}
    </>}
    {notice && <p role="alert">{notice}</p>}
  </section>;
}

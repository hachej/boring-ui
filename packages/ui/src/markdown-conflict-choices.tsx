import { useRef, useState } from 'react';
import type { MarkdownController, MarkdownState } from './markdown.js';
import type { MarkdownEditorLabels } from './markdown-editor-labels.js';
import { MarkdownProposalDiff } from './markdown-proposal-diff.js';
import type { SaveResult } from './resources.js';
import type { ViewerComponents } from './viewer-components.js';

type Review = { readonly remote: string; readonly revision: string | null };

/** The three ways out of a conflict. Each goes through the controller; nothing here writes or compares revisions itself. */
export function MarkdownConflictChoices({ controller, state, labels, components, disabled, readOnly, setError, run, onSaveResult }: {
  readonly controller: MarkdownController;
  readonly state: MarkdownState;
  readonly labels: MarkdownEditorLabels;
  readonly components?: ViewerComponents | undefined;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly setError: (message: string | null) => void;
  readonly run: (operation: () => Promise<unknown>) => void;
  readonly onSaveResult: (result: SaveResult) => void;
}) {
  const Control = components?.button ?? 'button';
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const reviewing = useRef(0);
  const deleted = state.remote?.kind === 'absent';
  const remoteRevision = state.remote?.kind === 'revision' ? state.remote.target.revision : null;
  // A diff against a revision that is no longer the known remote would mislead: it closes, and Review diff reads again.
  const shown = review && (deleted ? review.revision === null : remoteRevision === null || review.revision === remoteRevision) ? review : null;

  const keepMine = () => {
    setBusy(true);
    setError(null);
    setReview(null);
    reviewing.current++;
    void controller.actions.keepLocal().then(result => {
      // A conflict here always means the remote moved past what the person chose over; a provider's reason would not say so, or say it in their language.
      if (result.kind === 'conflict') setError(labels.conflictMovedAgain);
      onSaveResult(result);
    }, () => setError(labels.operationFailed)).finally(() => setBusy(false));
  };
  const toggleReview = () => {
    const sequence = ++reviewing.current;
    if (shown) { setReview(null); return; }
    setBusy(true);
    setError(null);
    void controller.actions.readRemote().then(remote => {
      if (sequence !== reviewing.current) return;
      if (remote.kind === 'available') setReview({ remote: remote.text, revision: remote.revision });
      else if (remote.kind === 'missing') setReview({ remote: '', revision: null });
      else setError(remote.reason);
    }, () => { if (sequence === reviewing.current) setError(labels.operationFailed); }).finally(() => setBusy(false));
  };

  return <div role="alert" className="boring-markdown-alert" data-boring="conflict-choices">
    {deleted ? labels.conflictRemoteDeleted : labels.conflictNotice}
    <Control type="button" disabled={disabled || busy || readOnly} onClick={keepMine}>{labels.keepMine}</Control>
    <Control type="button" disabled={disabled || busy || deleted} onClick={() => run(controller.actions.discardToRemote)}>{labels.takeTheirs}</Control>
    <Control type="button" disabled={disabled || busy} aria-expanded={shown !== null} onClick={toggleReview}>{labels.reviewDiff}</Control>
    {shown && <div style={{ flex: '1 1 100%', minWidth: 0 }}>
      <p>{labels.conflictDiffLegend}</p>
      <MarkdownProposalDiff components={components} proposal={{ before: shown.remote, after: state.text }} name={labels.conflictDiffName} labels={labels} />
    </div>}
  </div>;
}

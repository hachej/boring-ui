// FeedbackReport: one stored report and Show. Show resolves each anchor against the live page now (`showAnchor` from
// `@hachej/boring-feedback/ui`): exact and moved placements are revealed on the overlay, ambiguous ones are numbered for the person to choose,
// and missing, stale or unsupported results are said as they are. Nothing uncertain is revealed without that choice.
import { useEffect, useState } from 'react';
import type { FeedbackReport as Report } from '@hachej/boring-feedback/format';
import type { PickerOverlay, PrivacyPolicy } from '@hachej/boring-feedback/page';
import { reportView, showAnchor, type ShowOutcome } from '@hachej/boring-feedback/ui';

export interface FeedbackReportProps {
  readonly report: Report;
  /** Show works only in the application page itself: pass its root, policy and overlay. Without them Show is not offered. */
  readonly page?: { readonly root: () => Element | null; readonly policy: PrivacyPolicy; readonly overlay: PickerOverlay | undefined };
  readonly onClose?: () => void;
}

type Shown = { readonly anchor: number; readonly outcome: ShowOutcome | 'working' };

const outcomeText = (outcome: ShowOutcome): string => {
  switch (outcome.kind) {
    case 'revealed': return outcome.placement === 'chosen' ? 'Shown: the element you chose.' : outcome.placement === 'moved' ? 'Shown. It has moved since the feedback was left.' : 'Shown.';
    case 'choose': return `${outcome.candidates.length} elements could be the one meant. Choose the right one:`;
    case 'stale': return `Not shown: ${outcome.reason}`;
    case 'missing': return `Not shown: ${outcome.reason}`;
    default: return `Not shown: ${outcome.reason}`;
  }
};

export function FeedbackReport({ report, page, onClose }: FeedbackReportProps) {
  const view = reportView(report);
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => () => { page?.overlay?.clear(); }, [page?.overlay]);
  useEffect(() => { setShown(null); page?.overlay?.clear(); }, [report.id]);

  const show = async (index: number): Promise<void> => {
    const root = page?.root();
    if (!page || !root) { setShown({ anchor: index, outcome: { kind: 'unsupported', reason: 'Open the application page to see it.' } }); return; }
    setShown({ anchor: index, outcome: 'working' });
    const outcome = await showAnchor({ anchor: report.anchors[index], root, policy: page.policy, ...(page.overlay ? { overlay: page.overlay } : {}), note: view.title });
    setShown({ anchor: index, outcome });
  };
  const choose = (outcome: Extract<ShowOutcome, { kind: 'choose' }>, number: number, index: number): void => setShown({ anchor: index, outcome: outcome.choose(number) });

  return <article data-boring="feedback" data-feedback-ignore="" className="boring-feedback-report" data-testid="feedback-report" data-id={view.id}>
    <header className="boring-feedback-sheet-header">
      <h2>{view.title}</h2>
      {onClose && <button type="button" className="boring-feedback-icon" aria-label="Close" onClick={onClose}>×</button>}
    </header>
    <p className="boring-feedback-meta">
      <span data-status={view.status}>{view.status}</span>
      {view.author !== undefined && <> · {view.author}</>}
      {view.app !== undefined && <> · {view.app} {view.route}</>}
      {view.build !== undefined && <> · build {view.build}</>}
    </p>
    <p className="boring-feedback-said" data-testid="feedback-said">{view.said}</p>
    <ol className="boring-feedback-anchors">
      {view.anchors.map(anchor => {
        const current = shown?.anchor === anchor.index ? shown.outcome : undefined;
        return <li key={anchor.index} data-testid="feedback-anchor">
          <span>{anchor.fallback}</span>
          {anchor.source !== undefined && <code>{anchor.source}</code>}
          {page && anchor.placeable && <button type="button" className="boring-feedback-button" data-testid="feedback-show" disabled={current === 'working'} onClick={() => { void show(anchor.index); }}>Show</button>}
          {!anchor.placeable && <span className="boring-feedback-meta">This page cannot place {anchor.kind}.</span>}
          {current !== undefined && current !== 'working' && <div role="status" className="boring-feedback-status" data-testid="feedback-show-result" data-kind={current.kind}>
            {outcomeText(current)}
            {current.kind === 'choose' && <ol className="boring-feedback-candidates">
              {current.candidates.map(candidate => <li key={candidate.number}>
                <button type="button" className="boring-feedback-button" data-testid="feedback-candidate" data-number={candidate.number}
                  onClick={() => choose(current, candidate.number, anchor.index)}>{candidate.number} · {candidate.label}</button>
              </li>)}
            </ol>}
          </div>}
        </li>;
      })}
    </ol>
    {view.widened.length > 0 && <p className="boring-feedback-meta" data-testid="feedback-widened">Privacy policy widened by the app: {view.widened.join(', ')}</p>}
    {view.resolutions.length > 0 && <section className="boring-feedback-resolutions"><h3>Resolution</h3>
      {view.resolutions.map((entry, index) => <p key={index}><strong>{entry.by}</strong> · {entry.note}</p>)}</section>}
  </article>;
}

// Point mode for phones (FEEDBACK.md, "Point mode"). On a phone the assistant's panel covers the app, so the person cannot point at it.
// « Show in app » in the composer (`useComposerFeedback(session, { entry: 'point' })`) starts the session in point mode. The host binds
// `usePointing(session)` to hide its own panel (a Sheet's `open`, AmbientChat's `state`), and this bar takes its place at the bottom of
// the screen. Each tap picks an element with the same picker, pins, NoteBubble and draft as feedback mode. Done leaves the draft as the
// composer's chip, the panel comes back, and Send attaches the report as it always does. Cancel discards everything.
//
// The kit never owns the host's panel. The host keeps its own open state; while `usePointing` is true it shows the panel as closed or
// minimised, and the panel returns as it was when pointing ends. Mount PointBar (and the one NoteBubble) outside the panel, because the
// panel may unmount while it is hidden.
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { isPointing, type FeedbackSession, type FeedbackSessionSnapshot } from '@hachej/boring-feedback/ui';
import { useExternal } from './use-external';
import { withLabels, type FeedbackLabels } from './feedback-labels';

const NO_STATE = { getSnapshot: () => undefined, subscribe: () => () => {} };

/** True while the session is in point mode: the host hides its panel then, and shows it again when this turns false. */
export function usePointing(session: FeedbackSession | undefined): boolean {
  const state = useExternal<FeedbackSessionSnapshot | undefined>(session ?? NO_STATE);
  return state !== undefined && isPointing(state);
}

export interface PointBarProps {
  readonly session: FeedbackSession;
  /** The height of the app's own bottom chrome (a tab bar) as a CSS length; the bar sits above it and above the safe area. */
  readonly bottomOffset?: string;
  /** Words of the bar (`feedbackLabelsFr` for French); what is left out keeps the English default. */
  readonly labels?: Partial<FeedbackLabels>;
  readonly className?: string;
}

/**
 * Point mode's compact bottom bar: « Tap an element to comment », the number of picks, « Use the app » (taps reach the page, for menus
 * and links), Cancel and Done. 44px targets, the host's shadcn tokens, the safe area and the app's tab bar (`bottomOffset`) respected.
 * It is `data-feedback-ignore`, so it is never picked, and the note bubble keeps clear of it.
 */
export function PointBar({ session, bottomOffset = '0px', labels, className }: PointBarProps) {
  const state = useExternal(session);
  const words = withLabels(labels);
  if (!isPointing(state) || typeof document === 'undefined') return null;
  const processing = state.phase === 'processing';
  const hint = state.problem ?? (state.using ? words.pointUsing : words.pointHint);
  return createPortal(<div data-boring="feedback" data-feedback-ignore="" data-feedback-point-bar="" role="toolbar" aria-label={words.pointBar} data-testid="feedback-point-bar"
    data-using={state.using ? 'true' : 'false'} className={['boring-feedback-pointbar', className].filter(Boolean).join(' ')}
    style={{ bottom: `calc(${bottomOffset} + env(safe-area-inset-bottom, 0px) + 8px)` }}>
    <span className="boring-feedback-point-line">
      <span className="boring-feedback-dot" aria-hidden="true" />
      <span className="boring-feedback-point-hint" role="status" aria-live="polite" data-testid="feedback-point-hint">{hint}</span>
      <span className="boring-feedback-point-count" data-testid="feedback-point-count">{words.pointCount(state.notes.length)}</span>
    </span>
    <span className="boring-feedback-point-actions">
      <Toggle data-testid="feedback-point-use-app" pressed={state.useToggle} disabled={processing}
        onPressedChange={pressed => session.setUseToggle(pressed)}>{words.pointUseApp}</Toggle>
      <span className="boring-feedback-point-spacer" />
      <Button variant="ghost" data-testid="feedback-point-cancel" disabled={processing} onClick={() => session.discard()}>{words.pointCancel}</Button>
      <Button variant="default" data-testid="feedback-point-done" disabled={processing}
        onClick={() => { void session.done(); }}>{words.pointDone}</Button>
    </span>
  </div>, document.body);
}

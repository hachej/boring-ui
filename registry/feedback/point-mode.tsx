// Comment mode's banner (FEEDBACK.md, "Point mode"). While a session annotates, CommentBanner says so: « Comment mode · 2 notes », what to
// do now, an on/off switch (off, the app works as usual and the notes stay) and Done. On a phone the assistant's panel covers the app, so
// « Show in app » in the composer (`useComposerFeedback(session)`) starts the session in point mode: the host binds `usePointing(session)`
// to hide its own panel (a Sheet's `open`, AmbientChat's `state`) and the banner sits at the bottom of the screen; each tap picks an
// element with the same picker, pins, NoteBubble and draft as feedback mode. With a mouse the banner sits at the top (`useCommenting`).
// Done leaves the draft as the composer's chip (or, with `useSendEachNote`, each note already went to the chat) and the panel comes back.
//
// The kit never owns the host's panel. The host keeps its own open state; while `usePointing` is true it shows the panel as closed or
// minimised, and the panel returns as it was when pointing ends. Mount CommentBanner (and the one NoteBubble) outside the panel, because the
// panel may unmount while it is hidden.
import { createPortal } from 'react-dom';
import { CircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { isPointing, type FeedbackSession, type FeedbackSessionSnapshot } from '@hachej/boring-feedback/ui';
import { cn } from '../utils/utils';
import { useExternal } from './use-external';
import { withLabels, type FeedbackLabels } from './feedback-labels';
import { noteCount, notesSent } from './feedback-session';

const NO_STATE = { getSnapshot: () => undefined, subscribe: () => () => {} };

/** True while the session is in point mode: the host hides its panel then, and shows it again when this turns false. */
export function usePointing(session: FeedbackSession | undefined): boolean {
  const state = useExternal<FeedbackSessionSnapshot | undefined>(session ?? NO_STATE);
  return state !== undefined && isPointing(state);
}

/** True while the session is in comment mode, either way (point mode on a phone, the hover targeting with a mouse). */
export function useCommenting(session: FeedbackSession | undefined): boolean {
  const state = useExternal<FeedbackSessionSnapshot | undefined>(session ?? NO_STATE);
  return state !== undefined && (state.phase === 'active' || state.phase === 'processing');
}

export interface CommentBannerProps {
  readonly session: FeedbackSession;
  /** The height of the app's own bottom chrome (a tab bar) as a CSS length; on a phone the banner sits above it and above the safe area. */
  readonly bottomOffset?: string;
  /** Words of the banner (`feedbackLabelsFr` for French); what is left out keeps the English default. */
  readonly labels?: Partial<FeedbackLabels>;
  readonly className?: string;
}

/**
 * Comment mode's banner, while the session annotates: « Comment mode · 2 notes », what to do now, an on/off switch and Done.
 * On, a tap (point mode, at the bottom of a phone above its tab bar) or a click (the hover targeting, at the top of a wide screen) picks
 * an element and opens its note. Off, the app works as usual (menus, links, another screen) and the notes stay; on again, the person
 * comments further. Done ends comment mode: with `useSendEachNote` each note already went to the agent (the hint says so, and Done shows the
 * conversation with its reply); otherwise the notes wait for the next message. There is no Cancel here: a note is removed on its own.
 * It is `data-feedback-ignore`, so it is never picked, and the note bubble keeps clear of it (`data-feedback-point-bar`).
 */
export function CommentBanner({ session, bottomOffset = '0px', labels, className }: CommentBannerProps) {
  const state = useExternal(session);
  const words = withLabels(labels);
  if ((state.phase !== 'active' && state.phase !== 'processing') || typeof document === 'undefined') return null;
  const processing = state.phase === 'processing';
  const on = !state.useToggle;
  const phone = isPointing(state);
  const sent = notesSent(session);
  const hint = state.problem ?? (!on ? words.commentPaused : sent > 0 && !state.bubble ? words.commentSent(sent) : phone ? words.commentTap : words.commentClick);
  // Notes that say something: a pin still being typed is not one yet.
  const notes = noteCount(state);
  return createPortal(<Card size="sm" data-boring="feedback" data-feedback-ignore="" data-feedback-point-bar={phone ? 'bottom' : 'top'} role="region" aria-label={words.commentMode}
    data-testid="feedback-point-bar" data-commenting={on ? 'true' : 'false'} className={cn('boring-feedback-banner', className)}
    style={phone ? { bottom: `calc(${bottomOffset} + env(safe-area-inset-bottom, 0px) + 8px)` } : { top: '8px' }}>
    <CircleIcon className={cn('size-2 shrink-0 fill-current', on ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-semibold">{words.commentMode}{notes > 0 && <span className="font-normal text-muted-foreground tabular-nums" data-testid="feedback-point-count"> · {words.pointCount(notes)}</span>}</span>
      <span className="text-xs text-pretty text-muted-foreground" role="status" aria-live="polite" data-testid="feedback-point-hint">{hint}</span>
    </span>
    <span className="flex min-h-11 shrink-0 items-center px-2">
      <Switch data-testid="feedback-comment-switch" checked={on} disabled={processing} aria-label={words.commentSwitch}
        onCheckedChange={checked => session.setUseToggle(!checked)} />
    </span>
    <Button className="min-h-11 shrink-0 sm:min-h-9" data-testid="feedback-point-done" disabled={processing} onClick={() => { void session.done(); }}>{words.pointDone}</Button>
  </Card>, document.body);
}

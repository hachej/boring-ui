'use client';

// The parts every launcher shares, so a config option does the same thing wherever it is given: Open in full (`handoff`), the status `note` on a folded launcher, the pointing tool's control
// in a title row or a field (the built-in toggle, or the app's own render slot `AgentSpec.feedbackSlot`), and the Esc rule between feedback, the pane and menus, and the panel.
// Host concern: Pi has no layout.
import { useEffect, useSyncExternalStore } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ExternalLinkIcon, MessageSquarePlusIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { clearUnread } from '../agent-bar/use-agent-bar-chat';
import { useComposerFeedback } from '../feedback/feedback-session';
import { cn } from '../utils/utils';
import { CIRCLE_ACTIONS, configOf } from './composer-config';
import { composerLabels, shellWords, useInternal } from './layer-context';
import type { FeedbackSlotContext } from './layer-context';

const NEVER = () => () => {};
const NOOP = () => {};

/** The conversation has no message yet (nothing to continue on a full page). */
export function useEmpty(): boolean {
  const { agent } = useInternal();
  const controller = agent?.controller;
  const read = () => { const snapshot = controller?.getSnapshot(); return !snapshot || ((snapshot.view?.entries?.length ?? 0) === 0 && (snapshot.echo?.length ?? 0) === 0 && (snapshot.outbox?.length ?? 0) === 0); };
  return useSyncExternalStore(controller?.subscribe ?? NEVER, read, read);
}

/** Open in full (`handoff`): what it does, and whether it can now. `run` is undefined when the config gives no hand-off. The person goes where the whole conversation is: what was unread is read, and the panel closes unless the app says it stays. */
export function useOpenFull(): { readonly run: (() => void) | undefined; readonly disabled: boolean } {
  const layer = useInternal();
  const config = configOf(layer);
  const empty = useEmpty();
  const controller = layer.agent?.controller;
  const full = config?.handoff?.openFull ?? config?.on?.openFull;
  if (!full || !controller) return { run: undefined, disabled: false };
  const run = () => {
    const id = String(layer.agent?.chatProps?.conversations?.activeId ?? controller.getSnapshot().conversationId);
    (full as (id: string, context: { readonly empty: boolean }) => void)(id, { empty });
    clearUnread(controller);
    if ((config?.handoff?.then ?? 'close') === 'close') layer.close();
  };
  return { run, disabled: empty && config?.handoff?.allowEmpty !== true };
}

/** The Open in full button of a title row (a circle's panel, a tab's panel, the docked header). Absent without a `handoff`. */
export function OpenFullButton(): ReactElement | null {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const { run, disabled } = useOpenFull();
  if (!run) return null;
  return <Button variant="ghost" size="icon" data-testid={CIRCLE_ACTIONS.openFull.testId} data-action={CIRCLE_ACTIONS.openFull.id} aria-label={text.openFull} title={text.openFull} disabled={disabled} onClick={run}><ExternalLinkIcon data-icon="inline-start" aria-hidden="true" /></Button>;
}

/** What the app's feedback slot is given: the level and a way to set it, the session's phase and the notes taken, and where the slot is drawn (`field`: the composer's row; `title`: the panel's title row). */
export function useFeedbackSlotContext(where: 'field' | 'title'): FeedbackSlotContext {
  const layer = useInternal();
  const session = layer.agent?.feedback;
  const phase = useSyncExternalStore(session?.subscribe ?? NEVER, () => session?.getSnapshot().phase ?? 'idle', () => 'idle');
  const feedback = useComposerFeedback(session);
  return { level: layer.level, setLevel: layer.setLevel, phase, count: feedback?.count ?? 0, annotate: feedback?.annotate ?? NOOP, where };
}

function SlotContent({ slot, where }: { readonly slot: ReactNode | ((context: FeedbackSlotContext) => ReactNode); readonly where: 'field' | 'title' }): ReactElement {
  const context = useFeedbackSlotContext(where);
  return <span data-testid="composer-feedback-slot" data-where={where} className="contents">{typeof slot === 'function' ? slot(context) : slot}</span>;
}

/** Where the slot is drawn for a launcher: the circle's panel draws the pointing tool in its title row (its field's toggle is hidden); every other launcher draws it in the composer's row. */
export const feedbackWhere = (launcher: 'bar' | 'circle' | 'tab' | 'header'): 'field' | 'title' => launcher === 'circle' ? 'title' : 'field';

/** The pointing tool's control in a circle's title row: the app's render slot when it gives one (`AgentSpec.feedbackSlot`), else the annotate toggle. */
export function AnnotateControl(): ReactElement | null {
  const layer = useInternal();
  const labels = composerLabels(layer.locale, layer.agent);
  const feedback = useComposerFeedback(layer.agent?.feedback);
  const slot = layer.agent?.feedbackSlot;
  if (slot !== undefined && slot !== null && slot !== false) return <SlotContent slot={slot} where="title" />;
  if (!feedback) return null;
  return <Toggle className="min-h-11 min-w-11" data-testid={CIRCLE_ACTIONS.annotate.testId} data-action={CIRCLE_ACTIONS.annotate.id} pressed={feedback.active} aria-label={labels.annotate} title={labels.annotateHint}
    onPressedChange={() => feedback.annotate()}><MessageSquarePlusIcon data-icon="inline-start" aria-hidden="true" /></Toggle>;
}

/** The slot in the composer's row (a launcher with a resting field). The chat's own toggle is hidden when it is there; its notes chip stays (it clears the draft's notes). */
export function FieldFeedbackSlot({ slot }: { readonly slot: ReactNode | ((context: FeedbackSlotContext) => ReactNode) }): ReactElement {
  return <SlotContent slot={slot} where="field" />;
}

/** The app's status text beside a folded launcher (`note`), or null. */
export function useNote(): string | null {
  return useInternal().note;
}

/** The note as a pill. `beside`: to the inline start of a round or tall launcher; `above`: over a bar's field. */
export function LauncherNote({ note, placement = 'beside', className, testId = 'composer-launcher-note' }: { readonly note: string; readonly placement?: 'beside' | 'above'; readonly className?: string | undefined; readonly testId?: string }): ReactElement {
  return <span role="status" data-testid={testId} data-placement={placement}
    className={cn('pointer-events-none absolute rounded-pm-round bg-card px-3 py-1.5 text-xs whitespace-nowrap text-card-foreground shadow-pm-popover ring-1 ring-border', placement === 'beside' ? 'top-1/2 -translate-y-1/2 [inset-inline-end:calc(100%+0.5rem)]' : 'bottom-full mb-2 [inset-inline-end:0]', className)}>{note}</span>;
}

const bubbleOpen = new WeakSet<Event>();
/** Feedback's turn of the Escape, the first of the order: a handled key (annotating ended on it), or one that closed a note bubble. Every launcher's panel asks it before anything else. */
export const escapeInFeedback = (event: KeyboardEvent): boolean => event.defaultPrevented || bubbleOpen.has(event);
/**
 * Records, before anything else sees an Escape (window capture), whether a note bubble was open: the session closes the bubble on that same key, and by the time a panel's own handler runs it
 * would otherwise find the bubble gone and close the panel too. One guard per layer (`AgentLayerProvider`).
 */
export function useEscapeGuard(): void {
  const { agent } = useInternal();
  const session = agent?.feedback;
  useEffect(() => {
    if (!session) return;
    const record = (event: KeyboardEvent) => { if (event.key === 'Escape' && session.getSnapshot().bubble) bubbleOpen.add(event); };
    window.addEventListener('keydown', record, { capture: true });
    return () => window.removeEventListener('keydown', record, { capture: true });
  }, [session]);
}

/**
 * Whether an Escape is owned by something nearer the person than the panel. The order, once, for every launcher: feedback first (its own Escape ends annotating when no note bubble is open,
 * and closes the bubble when one is: either way the key is spent), then the pane, a list, a menu or a dialog opened over the panel, and the panel closes last.
 */
export function escapeOwnedElsewhere(event: KeyboardEvent): boolean {
  if (escapeInFeedback(event)) return true;
  if (document.querySelector('[data-testid=conversations], [data-testid=agent-preview], [role=menu], [role=listbox], [role=alertdialog], [data-boring-overlay]')) return true;
  return event.target instanceof Element && event.target.closest('[aria-haspopup][aria-expanded=true]') !== null;
}

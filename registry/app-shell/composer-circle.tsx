'use client';

// `launcher: 'circle'`: a round button in a corner that opens ONE conversation window (the panel) in place, with no folded bar in between. The title row has only what the config allows:
// the annotate toggle (an agent with a pointing tool), Open in full (a `handoff`: the app's full page for the conversation) and Close. The circle carries the unread mark, the needs-you ring,
// a run's pulse and a count of the notes taken; several launchers stack on one corner and step around the page's `avoid` rectangles (`composer-stack`). On a phone the panel is the bottom sheet
// (`CompactSheet`). Host concern: Pi has no layout; the conversation is the layer's one chat, moved into the panel.
import { useContext, useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { SparklesIcon, XIcon } from '../_shared/icons';
import { UnreadMark } from '../_shared/controller-strip';
import { Button } from '@/components/ui/button';
import { AnnotateControl, LauncherNote, OpenFullButton, escapeOwnedElsewhere, useNote } from './composer-actions';
import { cn } from '../utils/utils';
import { ChatSlot, HeaderExtras, HistoryButton, useCircleCollapsed, useTitle } from './agent-chats';
import { VoiceProblem } from './agent-bar-parts';
import { CIRCLE_ACTIONS, configOf } from './composer-config';
import { ComposerClassContext, NoticeSlot } from './float-composer';
import type { Corner } from './composer-config';
import { DEFAULT_OFFSET, css, useAvoidShift, useLauncherSlot } from './composer-stack';
import { composerLabels, shellWords, useInternal } from './layer-context';

const MARGIN = `max(${DEFAULT_OFFSET}px, env(safe-area-inset-bottom, 0px))`;

/** What the circle's geometry reads from the config: its corner and the two distances, the phone's tab bar added when the app gives no block offset. */
function useGeometry() {
  const layer = useInternal();
  const config = configOf(layer);
  const corner: Corner = (config?.at?.place as Corner | undefined) ?? 'bottom-end';
  const given = config?.at?.offset;
  const inline = given?.inline ?? DEFAULT_OFFSET;
  const block = given?.block ?? (layer.expanded ? MARGIN : `calc(${layer.tabbar}px + ${MARGIN})`);
  return { layer, config, corner, inline, block, bottom: corner.startsWith('bottom'), end: corner.endsWith('end'), z: config?.layer ?? 40 };
}

/** The title row's actions in the order the strip's plan gives them. `withClose`: the phone's header draws its own Close. */
export function CircleControls({ withClose = true }: { readonly withClose?: boolean }): ReactElement | null {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  return <span data-testid="composer-controller" className="flex shrink-0 items-center gap-0.5">
    <AnnotateControl />
    <OpenFullButton />
    {withClose && <Button variant="ghost" size="icon" data-testid={CIRCLE_ACTIONS.close.testId} data-action={CIRCLE_ACTIONS.close.id} aria-label={text.close} title={text.close} onClick={layer.close}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>}
  </span>;
}

/** The round launcher: a tap opens the panel. Unread mark, needs-you ring, the run's pulse, the notes taken and the app's status note. */
function Launcher({ hidden, slot, lift }: { readonly hidden: boolean; readonly slot: number; readonly lift: number }): ReactElement {
  const { layer, config, corner, inline, block, bottom, end, z } = useGeometry();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const labels = composerLabels(layer.locale, layer.agent);
  const { signals } = layer;
  const box = useRef<HTMLSpanElement>(null);
  const hostClass = useContext(ComposerClassContext);
  const shift = useAvoidShift(box, corner, config?.avoid, !hidden);
  const Icon = layer.agent?.icon ?? SparklesIcon;
  const note = useNote();
  const label = signals.unread ? `${text.restore} (${signals.unread.label}${signals.unread.count && signals.unread.count > 1 ? `, ${signals.unread.count}` : ''})` : text.restore;
  const working = signals.working === true && !signals.needsYou;
  const style: CSSProperties = { zIndex: z, [end ? 'insetInlineEnd' : 'insetInlineStart']: `calc(${css(inline)} + ${shift}px)`, [bottom ? 'insetBlockEnd' : 'insetBlockStart']: `calc(${css(block)} + ${lift}px)` };
  // Hidden (the panel is open, or the full page is on show) the box keeps its slot in the stack and out of the way: the others do not shift.
  return <span ref={box} hidden={hidden} style={style} data-composer={config?.id} data-testid="composer-circle-box" data-slot-index={slot}
    className={cn('fixed size-13 rounded-pm-round shadow-pm-popover', signals.needsYou && 'ring-2 ring-warning outline-3 outline-warning/25', hostClass)}>
    <Button type="button" size="icon" data-testid="composer-circle" data-needs-you={signals.needsYou || undefined} data-working={working || undefined} aria-busy={working || undefined} aria-label={label} title={text.restore} onClick={() => layer.open('agent')}>
      <Icon aria-hidden="true" />
      {signals.unread && <UnreadMark unread={signals.unread} dot="top-0 right-0" pill="-top-1 -right-2" />}
    </Button>
    {working && <span data-testid="composer-circle-working" aria-hidden="true" className="pointer-events-none absolute -inset-0.5 rounded-pm-round ring-2 ring-primary animate-pulse motion-reduce:animate-none" />}
    {(signals.notes ?? 0) > 0 && <span role="img" aria-label={labels.annotateNotes(signals.notes ?? 0)} data-testid="composer-circle-notes" data-count={signals.notes}
      className="pointer-events-none absolute -bottom-1 -left-1 flex h-5 min-w-5 items-center justify-center rounded-pm-round bg-foreground px-1 text-xs leading-none font-semibold tabular-nums text-background ring-2 ring-background">{signals.notes}</span>}
    <NoticeSlot below={!bottom} className={cn('w-[min(22rem,calc(100vw-2rem))]', end ? 'right-0 left-auto' : 'left-0 right-auto')} />
    {note && <LauncherNote note={note} testId="composer-circle-note" />}
  </span>;
}

/** The wide panel: the layer's one conversation in a window at the launcher's corner, title row, thread and field. */
function Panel({ lift }: { readonly lift: number }): ReactElement {
  const { config, corner, inline, block, bottom, end, z } = useGeometry();
  const { text, title } = useTitle();
  const box = useRef<HTMLDivElement>(null);
  const shift = useAvoidShift(box, corner, config?.avoid, true);
  const style: CSSProperties = { zIndex: z + 1, [end ? 'insetInlineEnd' : 'insetInlineStart']: `calc(${css(inline)} + ${shift}px)`, [bottom ? 'insetBlockEnd' : 'insetBlockStart']: `calc(${css(block)} + ${lift}px)`,
    maxBlockSize: `calc(100dvh - ${css(block)} - ${lift}px - ${DEFAULT_OFFSET}px)` };
  return <div ref={box} data-testid="composer-circle-panel" data-composer={config?.id} data-state="open" role="dialog" aria-label={title} style={style}
    className="app-shell fixed isolate flex h-[36rem] w-[min(24rem,calc(100vw-2rem))] flex-col text-card-foreground [&_[data-boring=pi-chat]>header]:hidden [&_[data-testid=composer-annotate]]:hidden">
    <div aria-hidden="true" data-boring="chrome" className="pointer-events-none absolute inset-0 z-behind rounded-(--radius-3xl) bg-card shadow-pm-popover ring-1 ring-border" />
    <div data-testid="agent-layer-header" className="flex h-13 shrink-0 items-center gap-1.5 px-2 md:px-3">
      <h2 data-testid="agent-layer-title" className="m-0 min-w-0 flex-1 truncate text-sm leading-5 font-semibold tracking-tight">{title}</h2>
      <HistoryButton />
      <HeaderExtras text={text} compact={false} />
      <CircleControls />
    </div>
    <VoiceProblem />
    <ChatSlot />
  </div>;
}

/** Ctrl or Cmd + J (the first launcher answers), Esc (a handled key, a menu or a note bubble keeps its own), and focus: into the field on open, back to the circle on close. */
function CircleController({ open, first }: { readonly open: boolean; readonly first: boolean }): null {
  const layer = useInternal();
  const now = useRef({ open, first, layer });
  useLayoutEffect(() => { now.current = { open, first, layer }; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const { open: isOpen, first: answers, layer: api } = now.current;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j') {
        if (!answers || api.suspended) return;
        event.preventDefault();
        if (isOpen) api.close(); else api.open('agent');
        return;
      }
      if (event.key !== 'Escape' || !isOpen || !api.expanded) return;
      // Feedback, then a list, menu or file opened over the panel, take their own Escape first; the panel closes last.
      if (escapeOwnedElsewhere(event)) return;
      event.preventDefault();
      api.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const was = useRef(open);
  const { host } = layer;
  useEffect(() => {
    if (was.current === open) return;
    was.current = open;
    let frame = 0, tries = 0;
    const land = () => {
      const held = document.activeElement;
      if (open) {
        // A phone's sheet keeps the keyboard down until the person taps the field.
        if (!now.current.layer.expanded) return;
        const field = host?.querySelector<HTMLElement>('[data-spec=agent] [data-testid=composer-input]');
        field?.focus({ preventScroll: true });
        if (field && document.activeElement === field) return;
      } else {
        if (held && held !== document.body && !held.closest('[data-testid=composer-circle-panel]')) return;
        const circle = document.querySelector<HTMLElement>('[data-testid=composer-circle]');
        circle?.focus({ preventScroll: true });
        if (circle && document.activeElement === circle) return;
      }
      if (++tries < 12) frame = requestAnimationFrame(land);
    };
    land();
    return () => cancelAnimationFrame(frame);
  }, [open, host]);
  return null;
}

/** What `AgentLayer` draws for `launcher: 'circle'`: the launcher, and on a wide screen the panel (the phone's panel is the layer's bottom sheet). */
export function CircleHost(): ReactElement | null {
  const layer = useInternal();
  const collapsed = useCircleCollapsed();
  const { config, corner, inline, block } = useGeometry();
  // One place in the stack for the launcher and its panel: they are the same launcher at two levels.
  const { slot, lift, first } = useLauncherSlot({ id: config?.id, corner, stack: config?.at?.stack ?? 'auto', reserve: config?.reserve !== 'none', inline, block }, layer.agent !== undefined && !layer.suspended, layer.launcherOwner);
  if (!layer.agent) return null;
  const open = layer.snap !== 'closed' && layer.showing === 'agent';
  const shown = open && !collapsed && !layer.suspended;
  return <>
    <CircleController open={shown} first={first} />
    {layer.expanded && shown && <Panel lift={lift} />}
    {!layer.suspended && <Launcher hidden={shown} slot={slot} lift={lift} />}
  </>;
}

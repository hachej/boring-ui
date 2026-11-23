'use client';

// One unit of agent work as a card: an agent run, a task, a job. It works in the background and folds: collapsed it is a header (the agent's colour dot, the title,
// a status chip, one line of what the agent does) and nothing else; a decision the agent waits for shows on the folded card. The same levels as the bottom
// composer, driven by the same strip on the card's lower border: 0 folded, 1 a small tray (the conversation and its field), 2 the whole chat, or docked
// into a place the host provides. Sending from the folded composer opens the tray, so the message and its reply are seen. It has no input of its own: the chat is the kit's. The controller is the host's and keeps running while the card is folded.
// A host that draws its own card passes `header` and `children`, a `slot` for the tray, and may leave the controller out until the first tap (`onChatRequest`).
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquareIcon, PanelRightIcon } from '../_shared/icons';
import { ControllerStrip, stripIcons } from '../_shared/controller-strip';
import type { ControllerAction } from '../_shared/controller-strip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { AgentChat, agentColor, agentTint, statusVariant } from '../agent-chat/agent-chat';
import type { AgentChatProps } from '../agent-chat/agent-chat';
import { useAgentBarChat } from '../agent-bar/use-agent-bar-chat';
import type { AgentBarChat } from '../agent-bar/use-agent-bar-chat';
import { ApprovalCard } from '../pi-chat-approval/approval-card';
import { chatTextFor } from '../pi-chat/locale';
import { cn } from '../utils/utils';

/** 0 folded, 1 the small tray, 2 the whole chat. */
export type AgentCardLevel = 0 | 1 | 2;
export interface AgentCardLabels { readonly expand: string; readonly expandMore: string; readonly collapse: string; readonly dock: string; readonly undock: string; readonly docked: string; readonly unread: string; readonly chat: string }
const WORDS: AgentCardLabels = { expand: 'Expand', expandMore: 'Expand more', collapse: 'Collapse', dock: 'Dock', undock: 'Undock', docked: 'Docked', unread: 'New reply', chat: 'Open the chat' };

export interface AgentCardProps extends Pick<AgentChatProps, 'agent' | 'status' | 'chatProps'> {
  /** The conversation. Optional: without it the strip offers only « Open the chat » and no chat runs (see `onChatRequest`). */
  readonly controller?: AgentChatProps['controller'] | undefined;
  /** Without a `controller`: called once when the person taps « Open the chat ». The host makes the conversation and passes the controller; the card then opens the composer. */
  readonly onChatRequest?: (() => void) | undefined;
  /** The card's accessible name, and the title of the whole chat. */
  readonly title: string;
  /** The host's own header, drawn in place of the built-in one (dot, title, status chip, activity line). It is not a tap target of the card: the tray opens only from the strip. */
  readonly header?: ReactNode;
  /** The host's own body, drawn under the header and `meta`, unstyled. Not drawn while the whole chat (level 2) is open. */
  readonly children?: ReactNode;
  /** An element inside the host's body: the folded card's composer and the tray (level 1) are drawn there. When it goes (null), they return under the header with their state kept. */
  readonly slot?: HTMLElement | null | undefined;
  /** A reply came while the person was away: a quiet dot on the folded card, even before any controller exists. The host clears it once the person has looked. */
  readonly unread?: boolean | undefined;
  /** `false`: the unread mark is always a dot, never the number pill the controller draws from two unread replies. Default: the pill from two. */
  readonly unreadCount?: false | undefined;
  /** `false`: the controller strip (the notch under the card: Open the chat, Expand, Dock and the unread mark) is not drawn, for a host whose chat is the page's one composer. Default `true`: the strip, as before. Without it the card's own chat cannot be opened by the person. */
  readonly notch?: boolean | undefined;
  /** The host's cite affordance, usually the kit's `<CiteButton reference={…} />` (it reads the AppShell's layer and adds the card to the page's composer through `talkAbout`). Shown as a small control at the card's top right, on hover or focus with a fine pointer, always on touch and while the card is cited. */
  readonly cite?: ReactNode;
  /** One line of what the agent does now. Default: what the running tool says, while it works. */
  readonly activity?: string | undefined;
  /** The task's own fields (assignee, due date, …), under the header: a task card is this card with a `meta`. */
  readonly meta?: ReactNode;
  /** Controlled level; without it the card keeps its own, starting at `defaultLevel` (0). */
  readonly level?: AgentCardLevel | undefined;
  readonly defaultLevel?: AgentCardLevel | undefined;
  readonly onLevelChange?: ((level: AgentCardLevel) => void) | undefined;
  /** The place a docked chat goes (a side column the host provides). Without it the card has no Dock. */
  readonly dock?: HTMLElement | null | undefined;
  readonly docked?: boolean | undefined;
  readonly onDockedChange?: ((docked: boolean) => void) | undefined;
  readonly labels?: Partial<AgentCardLabels> | undefined;
  /** The height of the tray (level 1) and of the open chat (level 2), as CSS lengths. */
  readonly heights?: { readonly tray?: string; readonly open?: string; readonly composer?: string } | undefined;
  readonly className?: string | undefined;
}

/** The chat's own state (unread reply, decision, running tool). A hook cannot be skipped, so it lives here and the card mounts this only while it has a controller. */
const BarProbe = memo(function BarProbe({ controller, actions, locale, unread, onBar }: { readonly controller: NonNullable<AgentCardProps['controller']>; readonly actions: unknown; readonly locale: string | undefined; readonly unread: string; readonly onBar: (bar: AgentBarChat) => void }) {
  const bar = useAgentBarChat(controller, { actions: actions as never, toolLabels: chatTextFor(locale as never).labels,
    labels: locale === 'fr' ? { unread } : { unread, working: 'Working', done: 'Done' } });
  useLayoutEffect(() => { onBar(bar); });
  return null;
});

export function AgentCard({ controller, onChatRequest, agent, title, header, children, slot, unread: hostUnread, unreadCount, notch = true, cite, status, activity, meta, level: controlled, defaultLevel = 0, onLevelChange, dock, docked: dockedControlled, onDockedChange, labels, heights, chatProps, className }: AgentCardProps) {
  const words = { ...WORDS, ...labels };
  const [own, setOwn] = useState<AgentCardLevel>(defaultLevel);
  const [ownDocked, setOwnDocked] = useState(false);
  const [ownComposer, setOwnComposer] = useState(false);
  const [probed, setBar] = useState<AgentBarChat | undefined>();
  const wanted = useRef(false);
  const asked = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const live = Boolean(controller);
  const bar = live ? probed : undefined;
  const level = live ? controlled ?? own : 0, docked = live && Boolean(dockedControlled ?? ownDocked) && Boolean(dock);
  const composer = live && ownComposer;
  const locale = chatProps?.locale;
  const hosted = header !== undefined && header !== null && header !== false;
  const setComposer = setOwnComposer;
  const header$ = useRef<HTMLButtonElement>(null);
  // Focus goes back to the card's header, or, when the host drew the header, to the first cell of the strip.
  const focusAnchor = () => (header$.current ?? root.current?.querySelector<HTMLElement>('[data-testid=composer-controller] [data-action]'))?.focus({ preventScroll: true });
  const setLevel = useCallback((next: AgentCardLevel, focus = false) => {
    setOwn(next); onLevelChange?.(next);
    if (next > 0) setComposer(false);
    if (next > 0) bar?.markRead();
    if (focus) requestAnimationFrame(focusAnchor);
  }, [onLevelChange, bar, setComposer]);
  // Sending from the folded composer opens the tray: its conversation is hidden at level 0, so the message and the reply would not be seen. The host's own `onSent` runs first.
  const hostSent = chatProps?.onSent;
  const openOnSent = useCallback(() => { hostSent?.(); setOwn(1); onLevelChange?.(1); setComposer(false); bar?.markRead(); }, [hostSent, onLevelChange, bar, setComposer]);
  const setDocked = (next: boolean) => { setOwnDocked(next); onDockedChange?.(next); if (next) bar?.markRead(); };
  useEffect(() => { if (level > 0 && bar?.reply) bar.markRead(); }, [level, bar]);

  // A chat made on the first tap: the request goes out once, and the composer opens when the controller arrives.
  useEffect(() => {
    if (!controller) return;
    asked.current = false;
    if (wanted.current) { wanted.current = false; setComposer(true); }
  }, [controller, setComposer]);
  const request = () => { wanted.current = true; if (asked.current) return; asked.current = true; onChatRequest?.(); };

  // The composer and the tray live in one element the card owns, so a slot that comes and goes moves them without remounting the chat (the draft stays).
  const inline = useRef<HTMLDivElement>(null);
  const [tray] = useState<HTMLDivElement | null>(() => typeof document === 'undefined' ? null : document.createElement('div'));
  useLayoutEffect(() => { const target = slot ?? inline.current; if (tray && target && tray.parentNode !== target) target.appendChild(tray); });

  const arrows = stripIcons('bottom');
  // The ladder, one step at a time (the card grows downward from its strip): chat bubble, composer, tray, full chat; Dock at every step.
  const collapse = { id: 'chevron', testId: 'agent-card-collapse', label: words.collapse, icon: arrows.collapse, expanded: true, primary: true } as const;
  const bubble: ControllerAction = { id: 'chat', testId: 'agent-card-chat', label: words.chat, icon: <MessageSquareIcon aria-hidden="true" />, primary: true, onSelect: live ? () => setComposer(true) : request };
  const ladder: ControllerAction[] = !live ? [bubble] : level === 2 ? [{ ...collapse, onSelect: () => setLevel(1, true) }]
    : level === 1 ? [{ ...collapse, onSelect: () => { setLevel(0, true); setComposer(true); } }, { id: 'more', testId: 'agent-card-expand-more', label: words.expandMore, icon: arrows.more, onSelect: () => setLevel(2) }]
    : composer ? [{ ...collapse, onSelect: () => setComposer(false) }, { id: 'expand', testId: 'agent-card-expand', label: words.expand, icon: arrows.expand, expanded: false, onSelect: () => setLevel(1) }]
    : [bubble];
  const actions: ControllerAction[] = docked ? [{ id: 'undock', testId: 'agent-card-undock', label: words.undock, icon: <PanelRightIcon aria-hidden="true" />, primary: true, on: true, onSelect: () => setDocked(false) }]
    : [...ladder, ...(live && dock ? [{ id: 'dock', testId: 'agent-card-dock', label: words.dock, icon: <PanelRightIcon aria-hidden="true" />, onSelect: () => setDocked(true) }] : [])];

  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && level > 0 && !docked) { event.preventDefault(); setLevel(0, true); } };
  const line = activity ?? bar?.status?.text;
  const waiting = !docked && level === 0 && (bar?.approval || bar?.question);
  const chat = (props: Partial<AgentChatProps>) => controller ? <AgentChat controller={controller} agent={agent} title={title} status={status} chatProps={chatProps} {...props} /> : null;
  const approval = bar?.approval;
  const badge = bar?.historyBadge && unreadCount === false ? { label: bar.historyBadge.label } : bar?.historyBadge;
  const dot = level > 0 || docked ? undefined : badge ?? (hostUnread ? { label: words.unread } : undefined);
  const open = level === 2 && !docked;

  return <div ref={root} data-testid="agent-card" data-level={docked ? 'docked' : level} data-needs-you={waiting ? '' : undefined} onKeyDown={onKeyDown} role={hosted ? 'group' : undefined} aria-label={hosted ? title : undefined}
    style={waiting ? { ['--tw-ring-color' as string]: 'var(--warning)' } : agentTint(agent, 0)} className={cn('group/agent-card relative mb-3 flex min-w-0 flex-col rounded-(--radius-3xl) bg-card pb-3 text-card-foreground ring-1', waiting && 'ring-2', className)}>
    {cite && <div data-testid="agent-card-cite" className="absolute top-2 right-2 z-10 opacity-0 transition-opacity duration-(--duration-fast) group-hover/agent-card:opacity-100 group-focus-within/agent-card:opacity-100 has-[[data-cited]]:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none">{cite}</div>}
    {controller && <BarProbe controller={controller} actions={chatProps?.actions} locale={locale} unread={words.unread} onBar={setBar} />}
    {hosted && <div data-testid="agent-card-host-header">{header}</div>}
    {open && <div style={{ height: heights?.open ?? '32rem' }} className={cn('min-h-0 overflow-hidden', !hosted && 'rounded-t-(--radius-3xl)')}>{chat({})}</div>}
    {!open && <>
      {!hosted && <Button ref={header$} type="button" variant="ghost" data-testid="agent-card-header" aria-expanded={level > 0 && !docked} aria-label={`${title}, ${words.expand}`} onClick={() => { if (!docked) setLevel(level === 0 ? 1 : level); }}
        className={cn('h-auto min-w-0 flex-col items-stretch gap-1 px-3 pt-3 pb-1 text-left whitespace-normal', cite && 'pr-12')}>
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" data-testid="agent-card-dot" style={{ backgroundColor: agentColor(agent) }} className="size-2 shrink-0 rounded-(--radius-3xl)" />
          <span data-testid="agent-card-title" className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
          {docked && <Badge variant="outline">{words.docked}</Badge>}
          {status && <Badge data-testid="agent-card-status" variant={statusVariant(status)}>{status.label}</Badge>}
        </span>
        <span data-testid="agent-card-activity" className="flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground">
          <span style={{ color: agentColor(agent) }} className="shrink-0 font-semibold">{agent.name}</span>{line && <span className="min-w-0 truncate">· {line}</span>}
        </span>
      </Button>}
      {hosted && docked && <div className="px-3 pt-1"><Badge data-testid="agent-card-docked" variant="outline">{words.docked}</Badge></div>}
      {meta && <div data-testid="agent-card-meta" className="px-3 pb-1 text-xs text-muted-foreground">{meta}</div>}
      {waiting && <div data-testid="agent-card-decision" className="px-3 pt-1">
        {approval && <ApprovalCard call={{ type: 'toolCall', id: 'card', name: approval.tool, arguments: Object.fromEntries(approval.args.map(item => [item.name, item.value])) }} result={undefined}
          summary={approval.summary} questionId="card" answer={async (_id, value) => { approval.decide(value === 'Deny' ? 'Deny' : 'Approve'); return { kind: 'answered' } as never; }} />}
        {bar?.question && <div data-testid="agent-card-question" className="flex flex-col gap-2 py-1">
          <p className="m-0 text-sm font-semibold">{bar.question.title}</p>
          <div className="flex flex-wrap gap-2">{bar.question.choices.map(choice => <Button key={choice} type="button" variant="outline" onClick={() => bar.question?.onAnswer({ text: choice, source: 'choice' })}>{choice}</Button>)}</div>
        </div>}
      </div>}
      {children}
    </>}
    <div ref={inline} />
    {tray && createPortal(<>
      {live && level === 0 && composer && !docked && <Fragment key="composer"><Separator className="mt-1" /><div data-testid="agent-card-composer" style={{ height: heights?.composer ?? '10.5rem' }} className="min-h-0 [&_[data-testid=conversation-content]]:invisible">{chat({ header: false, chatProps: { ...chatProps, hideLine: () => true, emptyState: <span />, onSent: openOnSent } })}</div></Fragment>}
      {live && level === 1 && !docked && <Fragment key="tray"><Separator className="mt-1" /><div style={{ height: heights?.tray ?? '16rem' }} className="min-h-0">{chat({ header: false })}</div></Fragment>}
    </>, tray)}
    {notch && <ControllerStrip edge="bottom" actions={actions} unread={dot} />}
    {docked && dock && createPortal(<div data-testid="agent-card-docked-chat" className="h-full min-h-0">{chat({})}</div>, dock)}
  </div>;
}

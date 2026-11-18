'use client';

// One unit of agent work as a card: an agent run, a task, a job. It works in the background and folds: collapsed it is a header (the agent's colour dot, the title,
// a status chip, one line of what the agent does) and nothing else; a decision the agent waits for shows on the folded card. The same levels as the bottom
// composer, driven by the same strip on the card's lower border: 0 folded, 1 a small tray (the conversation and its field), 2 the whole chat, or docked
// into a place the host provides. It has no input of its own: the chat is the kit's. The controller is the host's and keeps running while the card is folded.
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ApprovalCard } from '../pi-chat-approval/approval-card';
import { chatTextFor } from '../pi-chat/locale';
import { cn } from '../utils/utils';

/** 0 folded, 1 the small tray, 2 the whole chat. */
export type AgentCardLevel = 0 | 1 | 2;
export interface AgentCardLabels { readonly expand: string; readonly expandMore: string; readonly collapse: string; readonly dock: string; readonly undock: string; readonly docked: string; readonly unread: string; readonly chat: string }
const WORDS: AgentCardLabels = { expand: 'Expand', expandMore: 'Expand more', collapse: 'Collapse', dock: 'Dock', undock: 'Undock', docked: 'Docked', unread: 'New reply', chat: 'Open the chat' };

export interface AgentCardProps extends Pick<AgentChatProps, 'controller' | 'agent' | 'status' | 'chatProps'> {
  readonly title: string;
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

export function AgentCard({ controller, agent, title, status, activity, meta, level: controlled, defaultLevel = 0, onLevelChange, dock, docked: dockedControlled, onDockedChange, labels, heights, chatProps, className }: AgentCardProps) {
  const words = { ...WORDS, ...labels };
  const [own, setOwn] = useState<AgentCardLevel>(defaultLevel);
  const [ownDocked, setOwnDocked] = useState(false);
  const [composer, setComposer] = useState(false);
  const level = controlled ?? own, docked = Boolean(dockedControlled ?? ownDocked) && Boolean(dock);
  const locale = chatProps?.locale;
  const bar = useAgentBarChat(controller, { actions: chatProps?.actions as never, toolLabels: chatTextFor(locale).labels,
    labels: locale === 'fr' ? { unread: words.unread } : { unread: words.unread, working: 'Working', done: 'Done' } });
  const header = useRef<HTMLButtonElement>(null);
  const setLevel = useCallback((next: AgentCardLevel, focus = false) => {
    setOwn(next); onLevelChange?.(next);
    if (next > 0) setComposer(false);
    if (next > 0) bar.markRead();
    if (focus) requestAnimationFrame(() => header.current?.focus({ preventScroll: true }));
  }, [onLevelChange, bar]);
  const setDocked = (next: boolean) => { setOwnDocked(next); onDockedChange?.(next); if (next) bar.markRead(); };
  useEffect(() => { if (level > 0 && bar.reply) bar.markRead(); }, [level, bar]);

  const arrows = stripIcons('bottom');
  // The ladder, one step at a time (the card grows downward from its strip): chat bubble, composer, tray, full chat; Dock at every step.
  const collapse = { id: 'chevron', testId: 'agent-card-collapse', label: words.collapse, icon: arrows.collapse, expanded: true, primary: true } as const;
  const ladder: ControllerAction[] = level === 2 ? [{ ...collapse, onSelect: () => setLevel(1, true) }]
    : level === 1 ? [{ ...collapse, onSelect: () => { setLevel(0, true); setComposer(true); } }, { id: 'more', testId: 'agent-card-expand-more', label: words.expandMore, icon: arrows.more, onSelect: () => setLevel(2) }]
    : composer ? [{ ...collapse, onSelect: () => setComposer(false) }, { id: 'expand', testId: 'agent-card-expand', label: words.expand, icon: arrows.expand, expanded: false, onSelect: () => setLevel(1) }]
    : [{ id: 'chat', testId: 'agent-card-chat', label: words.chat, icon: <MessageSquareIcon aria-hidden="true" />, primary: true, onSelect: () => setComposer(true) }];
  const actions: ControllerAction[] = docked ? [{ id: 'undock', testId: 'agent-card-undock', label: words.undock, icon: <PanelRightIcon aria-hidden="true" />, primary: true, on: true, onSelect: () => setDocked(false) }]
    : [...ladder, ...(dock ? [{ id: 'dock', testId: 'agent-card-dock', label: words.dock, icon: <PanelRightIcon aria-hidden="true" />, onSelect: () => setDocked(true) }] : [])];

  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && level > 0 && !docked) { event.preventDefault(); setLevel(0, true); } };
  const line = activity ?? bar.status?.text;
  const waiting = !docked && level === 0 && (bar.approval || bar.question);
  const chat = (props: Partial<AgentChatProps>) => <AgentChat controller={controller} agent={agent} title={title} status={status} chatProps={chatProps} {...props} />;
  const approval = bar.approval;

  return <div data-testid="agent-card" data-level={docked ? 'docked' : level} data-needs-you={waiting ? '' : undefined} onKeyDown={onKeyDown}
    style={waiting ? { ['--tw-ring-color' as string]: 'var(--warning)' } : agentTint(agent, 0)} className={cn('relative mb-3 flex min-w-0 flex-col rounded-(--radius-3xl) bg-card pb-3 text-card-foreground ring-1', waiting && 'ring-2', className)}>
    {level === 2 && !docked
      ? <div style={{ height: heights?.open ?? '32rem' }} className="min-h-0 overflow-hidden rounded-t-(--radius-3xl)">{chat({})}</div>
      : <>
        <Button ref={header} type="button" variant="ghost" data-testid="agent-card-header" aria-expanded={level > 0 && !docked} aria-label={`${title}, ${words.expand}`} onClick={() => { if (!docked) setLevel(level === 0 ? 1 : level); }}
          className="h-auto min-w-0 flex-col items-stretch gap-1 px-3 pt-3 pb-1 text-left whitespace-normal">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" data-testid="agent-card-dot" style={{ backgroundColor: agentColor(agent) }} className="size-2 shrink-0 rounded-(--radius-3xl)" />
            <span data-testid="agent-card-title" className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
            {docked && <Badge variant="outline">{words.docked}</Badge>}
            {status && <Badge data-testid="agent-card-status" variant={statusVariant(status)}>{status.label}</Badge>}
          </span>
          <span data-testid="agent-card-activity" className="flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground">
            <span style={{ color: agentColor(agent) }} className="shrink-0 font-semibold">{agent.name}</span>{line && <span className="min-w-0 truncate">· {line}</span>}
          </span>
        </Button>
        {meta && <div data-testid="agent-card-meta" className="px-3 pb-1 text-xs text-muted-foreground">{meta}</div>}
        {waiting && <div data-testid="agent-card-decision" className="px-3 pt-1">
          {approval && <ApprovalCard call={{ type: 'toolCall', id: 'card', name: approval.tool, arguments: Object.fromEntries(approval.args.map(item => [item.name, item.value])) }} result={undefined}
            summary={approval.summary} questionId="card" answer={async (_id, value) => { approval.decide(value === 'Deny' ? 'Deny' : 'Approve'); return { kind: 'answered' } as never; }} />}
          {bar.question && <div data-testid="agent-card-question" className="flex flex-col gap-2 py-1">
            <p className="m-0 text-sm font-semibold">{bar.question.title}</p>
            <div className="flex flex-wrap gap-2">{bar.question.choices.map(choice => <Button key={choice} type="button" variant="outline" onClick={() => bar.question?.onAnswer({ text: choice, source: 'choice' })}>{choice}</Button>)}</div>
          </div>}
        </div>}
        {level === 0 && composer && !docked && <><Separator className="mt-1" /><div data-testid="agent-card-composer" style={{ height: heights?.composer ?? '10.5rem' }} className="min-h-0 [&_[data-testid=conversation-content]]:invisible">{chat({ header: false, chatProps: { ...chatProps, hideLine: () => true, emptyState: <span /> } })}</div></>}
        {level === 1 && !docked && <><Separator className="mt-1" /><div style={{ height: heights?.tray ?? '16rem' }} className="min-h-0">{chat({ header: false })}</div></>}
      </>}
    <ControllerStrip edge="bottom" actions={actions} unread={bar.historyBadge} />
    {docked && dock && createPortal(<div data-testid="agent-card-docked-chat" className="h-full min-h-0">{chat({})}</div>, dock)}
  </div>;
}

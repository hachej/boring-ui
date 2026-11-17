'use client';

// The default chat as a piece that goes anywhere: a right pane, a card in the middle of a screen, a page, a dialog. It fills its container (a flex column that
// shrinks); the only thing that changes with the place is the header, tinted with the agent's colour. The conversation and the composer are the kit's own.
import type { CSSProperties, ReactNode } from 'react';
import { ArrowLeftIcon, XIcon } from '../_shared/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { PiChat } from '../pi-chat/pi-chat';
import type { PiChatProps } from '../pi-chat/pi-chat';
import { ApprovalCard } from '../pi-chat-approval/approval-card';
import { cn } from '../utils/utils';

/** The agent's colour: one of the theme's five chart tokens, so an app keeps to its palette and no colour is written by hand. */
export type AgentColor = 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5';
export interface AgentIdentity { readonly name: string; readonly color?: AgentColor | undefined }
/** The state of a unit of work as a chip: the words are the host's, the tone picks the kit's badge. */
export interface AgentStatus { readonly label: string; readonly tone?: 'neutral' | 'running' | 'attention' | 'success' | 'danger' | undefined }

const BADGE = { neutral: 'secondary', running: 'info', attention: 'warning', success: 'success', danger: 'destructive' } as const;
export const statusVariant = (status: AgentStatus) => BADGE[status.tone ?? 'neutral'];
/** The agent's colour as a CSS value (the primary colour when it has none). */
export const agentColor = (agent: AgentIdentity) => `var(--${agent.color ?? 'primary'})`;
/** A fill and a border mixed from the agent's colour and the card, for a header. */
export const agentTint = (agent: AgentIdentity, fill = 13): CSSProperties => ({
  backgroundColor: `color-mix(in srgb, ${agentColor(agent)} ${fill}%, var(--card))`,
  ['--tw-ring-color' as string]: `color-mix(in srgb, ${agentColor(agent)} 40%, var(--border))`,
});

export interface AgentChatProps {
  readonly controller: PiChatProps['controller'];
  readonly agent: AgentIdentity;
  /** The header's title (the task, the run). Without a title or a status the header shows only the agent. */
  readonly title?: string | undefined;
  readonly status?: AgentStatus | undefined;
  /** Beside the close and back controls, for the host's own header actions. */
  readonly headerEnd?: ReactNode;
  readonly onBack?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly backLabel?: string | undefined;
  readonly closeLabel?: string | undefined;
  /** No header at all: the card that holds the chat draws its own. */
  readonly header?: boolean | undefined;
  /** Passed to the chat (the approval card is plugged in by default; `actions.answer` is the host's). */
  readonly chatProps?: Omit<PiChatProps, 'controller'> | undefined;
  readonly className?: string | undefined;
}

export function AgentChat({ controller, agent, title, status, headerEnd, onBack, onClose, backLabel = 'Back', closeLabel = 'Close', header = true, chatProps, className }: AgentChatProps) {
  return <section data-testid="agent-chat" aria-label={title ?? agent.name} className={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card text-card-foreground', className)}>
    {header && <header data-testid="agent-chat-header" style={agentTint(agent)} className="flex min-w-0 shrink-0 items-center gap-2 px-3 py-2">
      {onBack && <Button type="button" variant="ghost" size="icon" data-testid="agent-chat-back" aria-label={backLabel} onClick={onBack}><ArrowLeftIcon aria-hidden="true" /></Button>}
      <span className="flex min-w-0 flex-1 flex-col">
        {title && <span data-testid="agent-chat-title" className="truncate text-sm font-medium">{title}</span>}
        <span data-testid="agent-chat-agent" style={{ color: agentColor(agent) }} className="truncate text-xs font-semibold">{agent.name}</span>
      </span>
      {status && <Badge data-testid="agent-chat-status" variant={statusVariant(status)}>{status.label}</Badge>}
      {headerEnd}
      {onClose && <Button type="button" variant="ghost" size="icon" data-testid="agent-chat-close" aria-label={closeLabel} onClick={onClose}><XIcon aria-hidden="true" /></Button>}
    </header>}
    {header && <Separator />}
    <div className="min-h-0 flex-1">
      <PiChat header={false} showHistory={false} {...chatProps} controller={controller} cards={{ approval: ApprovalCard, ...chatProps?.cards }} />
    </div>
  </section>;
}

'use client';

import type { ReactNode } from 'react';
import type { ImageContent, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import { AlertCircleIcon, CircleSlashIcon } from 'lucide-react';
import { CopyButton } from './code-block';
import { Markdown } from './markdown';
import type { CommandMentions } from './markdown';
import { ArtifactCard } from './artifact-card';
import type { ArtifactsConfig } from './artifact';
import { ApprovalCard } from './approval-card';
import { QuestionCard } from './question-card';
import { FeedbackMention, feedbackMentionId } from './feedback-card';
import type { AnswerOutcome } from './question-card';
import { ActivityBlock } from './activity';
import type { ActivityState } from './activity';
import { Shimmer } from './shimmer';
import { ToolCard } from './tool';
import { thumbnail } from './composer';
import { pieces } from './config';
import { isFileBlock, segments } from './rows';
import type { DeriveOptions, Row } from './rows';
import { Button } from '../button/button';
import { BlockActions } from '../button/actions';
import type { BlockAction } from '../button/actions';
import { useChatText } from './labels';
import type { ReplyRef } from './config';
import { cn } from '../utils/utils';

export interface RowContext {
  readonly developer: boolean;
  readonly groupTool: DeriveOptions['groupTool'];
  readonly commandMentions: CommandMentions | undefined;
  readonly onOpenImage: ((image: ImageContent) => void) | undefined;
  readonly onCopy: ((text: string) => Promise<void>) | undefined;
  /** Which tokens of a sent message get a styled treatment (`@path` mentions, a leading `/skill`). */
  readonly pieces: { readonly mentions: boolean; readonly skills: readonly string[]; readonly openMention?: ((path: string) => void) | undefined } | undefined;
  readonly answer: ((questionId: string, answer: string) => Promise<AnswerOutcome>) | undefined;
  readonly artifacts: { readonly open: ArtifactsConfig['open']; readonly isOpen?: ArtifactsConfig['isOpen'] | undefined } | undefined;
  /** Replaces the default copy button under a settled reply (the ambient window adds feedback and the time); `host` holds the host's message actions. */
  readonly replyActions?: ((reply: { readonly key: string; readonly text: string; readonly timestamp?: number | undefined }, host: ReactNode) => ReactNode) | undefined;
  /** The host's actions for a settled reply (`messageActions`). */
  readonly messageActions?: ((reply: ReplyRef) => readonly BlockAction[]) | undefined;
  /** Fork the conversation after a settled reply (its last native entry): adds a Fork button next to Copy. */
  readonly onFork?: ((entryId: string) => void) | undefined;
}

function Image({ image, onOpenImage }: { readonly image: ImageContent; readonly onOpenImage: RowContext['onOpenImage'] }) {
  const { labels } = useChatText();
  const src = thumbnail(image.mimeType, image.data);
  return <button type="button" data-testid="message-image" disabled={!onOpenImage} aria-label={labels.openImage} onClick={() => onOpenImage?.(image)}
    className="block cursor-pointer overflow-hidden rounded-xl border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default">
    {src ? <img src={src} alt={labels.imageAttachment} className="max-h-48 max-w-full object-cover" /> : <span className="block px-3 py-2 text-xs text-muted-foreground">{labels.imageAttachment}</span>}
  </button>;
}

function UserText({ text, context }: { readonly text: string; readonly context: RowContext }) {
  const open = context.pieces?.openMention;
  const mention = 'rounded-md bg-background px-1.5 py-0.5 font-mono text-[0.8125rem] font-medium text-foreground ring-1 ring-border';
  return <div data-testid="user-text" className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[0.9375rem] leading-6 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{context.pieces ? pieces(text, context.pieces).map((piece, at) => piece.kind === 'mention'
    ? feedbackMentionId(piece.value!) ? <FeedbackMention key={at} path={piece.value!} id={feedbackMentionId(piece.value!)!} onOpen={open} />
    : open ? <button key={at} type="button" data-testid="message-mention" data-path={piece.value} aria-label={`Open ${piece.value}`} onClick={() => open(piece.value!)} className={cn(mention, 'cursor-pointer outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:inline-flex pointer-coarse:min-h-10 pointer-coarse:items-center')}>{piece.text}</button>
      : <span key={at} data-testid="message-mention" data-path={piece.value} className={mention}>{piece.text}</span>
    : piece.kind === 'skill' ? <span key={at} data-testid="message-skill" data-skill={piece.value} className="rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-foreground">{piece.text}</span>
    : piece.text) : text}</div>;
}

function UserBubble({ message, context }: { readonly message: UserMessage; readonly context: RowContext }) {
  const parts = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
  return <div className="flex flex-col items-end gap-2">
    {parts.map((part, index) => part.type === 'text' ? (isFileBlock(part.text) ? null : <UserText key={index} text={part.text} context={context} />)
      : <Image key={index} image={part} onOpenImage={context.onOpenImage} />)}
  </div>;
}

function Notice({ tone, icon, children, testid }: { readonly tone: 'error' | 'muted'; readonly icon: ReactNode; readonly children: ReactNode; readonly testid: string }) {
  return <p role={tone === 'error' ? 'alert' : 'status'} data-testid={testid}
    className={cn('my-2 mb-0 flex items-start gap-2 rounded-lg px-3 py-2 text-sm', tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted/60 text-muted-foreground')}>{icon}<span className="min-w-0 [overflow-wrap:anywhere]">{children}</span></p>;
}

function resultText(message: ToolResultMessage): string { return message.content.map(part => part.type === 'text' ? part.text : '').join('\n'); }

export function RowView({ row, context }: { readonly row: Row; readonly context: RowContext }) {
  const { labels, icons } = useChatText();
  switch (row.type) {
    case 'user': return <article data-row-id={row.key} data-role="user"><UserBubble message={row.message} context={context} /></article>;
    case 'card': return <article data-row-id={row.key} data-role="event">{row.card.content}</article>;
    case 'event': return <article data-row-id={row.key} data-role="event" className="text-center text-xs text-muted-foreground">{labels.event(row.label)}</article>;
    case 'system': return <article data-row-id={row.key} data-role="system"><details className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer max-sm:py-3 pointer-coarse:py-3">{labels.systemContext}</summary>
      <pre className="mt-2 mb-0 whitespace-pre-wrap">{row.text}</pre></details></article>;
    case 'orphan-result': return <article data-row-id={row.key} data-role="toolResult"><Notice tone="error" testid="tool-error" icon={<AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>
      <strong className="font-semibold">{labels.toolFailed(row.message.toolName)}</strong><span className="mt-1 block font-mono text-xs whitespace-pre-wrap">{resultText(row.message)}</span></Notice></article>;
    case 'assistant': {
      const settled = !row.streaming;
      const chunks = segments(row.parts, context.groupTool);
      const active = row.active === true || row.streaming;
      const lastText = [...row.parts].reverse().find(part => part.kind === 'text');
      const host = settled && row.text && context.messageActions
        ? <BlockActions actions={context.messageActions({ key: row.key, text: row.text, entryId: row.entryId })} testId="reply-action" menuLabel={labels.moreActions} className="text-muted-foreground" />
        : null;
      return <article data-row-id={row.key} data-role="assistant" data-streaming={row.streaming ? 'true' : undefined} className="group/message">
        <div className="space-y-3">
          {chunks.map((chunk, at) => {
            if (chunk.kind === 'activity') {
              const failed = chunk.steps.some(step => step.kind === 'tool' && step.entry.status === 'failed');
              const unfinished = chunk.steps.some(step => step.kind === 'tool' && step.entry.status === 'unfinished');
              const state: ActivityState = failed || row.stopReason === 'error' ? 'failed' : row.stopReason === 'aborted' || (!active && unfinished) ? 'stopped' : active && at === chunks.length - 1 ? 'running' : 'done';
              return <ActivityBlock key={chunk.key} steps={chunk.steps} state={state} streaming={row.streaming} developer={context.developer} {...(context.onOpenImage ? { onOpenImage: context.onOpenImage } : {})} />;
            }
            const part = chunk.part;
            if (part.kind === 'text') return <Markdown key={part.key} text={part.text} streaming={row.streaming && part === lastText && row.parts[row.parts.length - 1] === part}
              {...(settled && context.commandMentions ? { commandMentions: context.commandMentions } : {})} {...(context.onCopy ? { onCopy: context.onCopy } : {})} />;
            if (part.kind === 'thinking') return null; // reasoning is a step of an activity block
            if (part.kind === 'approval') return <ApprovalCard key={part.key} call={part.call} result={part.result} questionId={part.questionId} answer={context.answer} summary={part.summary} decision={part.decision} live={part.live} />;
            if (part.kind === 'question') return <QuestionCard key={part.key} call={part.call} result={part.result} questionId={part.questionId} answer={context.answer} live={part.live} />;
            if (part.kind === 'artifact') return <ArtifactCard key={part.key} artifact={part.artifact} title={part.title} {...(part.state === 'ready' ? {} : { pending: part.state })}
              open={part.artifact !== undefined && (context.artifacts?.isOpen?.(part.artifact) ?? false)} onOpen={context.artifacts?.open} />;
            return part.entry.custom ? <div key={part.key}>{part.entry.custom}</div> : <ToolCard key={part.key} entry={part.entry} {...(context.onOpenImage ? { onOpenImage: context.onOpenImage } : {})} />;
          })}
          {row.streaming && row.parts.length === 0 && <p data-testid="working" className="m-0 text-sm"><Shimmer>{labels.thinking}</Shimmer></p>}
        </div>
        {row.stopReason === 'error' && <Notice tone="error" testid="response-error" icon={<AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>{row.errorMessage ?? labels.responseFailed}</Notice>}
        {row.stopReason === 'aborted' && <Notice tone="muted" testid="interrupted" icon={<CircleSlashIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>{labels.interrupted}</Notice>}
        {settled && row.text && context.replyActions?.({ key: row.key, text: row.text, timestamp: row.timestamp }, host)}
        {settled && row.text && !context.replyActions && <div className="mt-1 -ml-2 flex opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100 max-sm:opacity-100 motion-reduce:transition-none">
          <CopyButton text={row.text} label={labels.copyResponse} {...(context.onCopy ? { onCopy: context.onCopy } : {})} className="text-muted-foreground" />
          {context.onFork && row.entryId && <Button size="icon-sm" variant="ghost" aria-label={labels.fork} title={labels.forkHint} data-testid="fork-reply"
            className="text-muted-foreground" onClick={() => context.onFork!(row.entryId!)}><icons.fork className="size-3.5" aria-hidden="true" /></Button>}
          {host}</div>}
      </article>;
    }
  }
}

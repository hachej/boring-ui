'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ImageContent, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import { AlertCircleIcon, CircleSlashIcon, FileIcon, FileSpreadsheetIcon, FileTextIcon, ImageIcon, PresentationIcon } from 'lucide-react';
import { CopyButton } from './code-block';
import { Markdown } from './markdown';
import type { CommandMentions } from './markdown';
import { ArtifactCard } from './artifact-card';
import type { ArtifactsConfig } from './artifact';
import { ApprovalCard } from './approval-card';
import { QuestionCard } from './question-card';
import type { AnswerOutcome } from './question-card';
import { ActivityBlock } from './activity';
import type { ActivityState } from './activity';
import { Shimmer } from './shimmer';
import { ToolCard } from './tool';
import { thumbnail } from './composer';
import { displayName, fileKind, isUploadPath, pieces, visibleParts } from './config';
import type { FileKind, Piece, PreviewRead } from './config';
import { isFileBlock, segments } from './rows';
import type { DeriveOptions, Row } from './rows';
import { Button } from '@/components/ui/button';
import { BlockActions } from '../button/actions';
import type { BlockAction } from '../button/actions';
import { useChatText } from './labels';
import type { ReplyRef } from './config';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from '@/components/ui/attachment';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export interface RowContext {
  readonly developer: boolean;
  readonly groupTool: DeriveOptions['groupTool'];
  readonly commandMentions: CommandMentions | undefined;
  readonly onOpenImage: ((image: ImageContent) => void) | undefined;
  readonly onCopy: ((text: string) => Promise<void>) | undefined;
  /** Which tokens of a sent message get a styled treatment (`@path` mentions, a leading `/skill`). */
  readonly pieces: { readonly mentions: boolean; readonly uploads?: boolean; readonly skills: readonly string[]; readonly openMention?: ((path: string) => void) | undefined; readonly renderMention?: ((path: string) => ReactNode | undefined) | undefined;
    readonly preview?: PreviewRead | undefined } | undefined;
  readonly fileChanges?: boolean | undefined;
  /** Opens a file card through the host's workspace opener. */
  readonly openFile?: ((path: string) => void) | undefined;
  readonly answer: ((questionId: string, answer: string) => Promise<AnswerOutcome>) | undefined;
  readonly artifacts: { readonly open: ArtifactsConfig['open']; readonly isOpen?: ArtifactsConfig['isOpen'] | undefined; readonly kinds?: ArtifactsConfig['kinds'] } | undefined;
  /** Replaces the default copy button under a settled reply (the ambient window adds feedback and the time); `host` holds the host's message actions. */
  readonly replyActions?: ((reply: { readonly key: string; readonly text: string; readonly timestamp?: number | undefined }, host: ReactNode) => ReactNode) | undefined;
  /** The host's actions for a settled reply (`messageActions`). */
  readonly messageActions?: ((reply: ReplyRef) => readonly BlockAction[]) | undefined;
  /** A line under a finished reply (not while it streams, runs a tool or waits to retry), after its actions (a host shows which model answered and how long it took). */
  readonly replyFooter?: ((reply: ReplyRef) => ReactNode) | undefined;
  /** Fork the conversation after a settled reply (its last native entry): adds a Fork button next to Copy. */
  readonly onFork?: ((entryId: string) => void) | undefined;
}

const replyRef = (row: Extract<Row, { type: 'assistant' }>): ReplyRef => ({ key: row.key, text: row.text, entryId: row.entryId, timestamp: row.timestamp, model: row.model, durationMs: row.durationMs });

function Image({ image, onOpenImage }: { readonly image: ImageContent; readonly onOpenImage: RowContext['onOpenImage'] }) {
  const { labels } = useChatText();
  const src = thumbnail(image.mimeType, image.data);
  return <Attachment orientation="vertical">
    <AttachmentMedia variant={src ? 'image' : 'icon'}>{src ? <img src={src} alt={labels.imageAttachment} /> : <ImageIcon aria-hidden="true" />}</AttachmentMedia>
    <AttachmentContent><AttachmentTitle>{labels.imageAttachment}</AttachmentTitle></AttachmentContent>
    <AttachmentTrigger data-testid="message-image" disabled={!onOpenImage} aria-label={labels.openImage} onClick={() => onOpenImage?.(image)} />
  </Attachment>;
}

/** Inline sent mention; workspace openers and host renderers keep their existing authority. */
function UserMention({ path, text, open, render }: { readonly path: string; readonly text: string; readonly open: ((path: string) => void) | undefined; readonly render: ((path: string) => ReactNode | undefined) | undefined }) {
  const custom = render?.(path);
  if (custom !== undefined) return <>{custom}</>;
  return open
    ? <span role="link" tabIndex={0} className="font-medium text-primary" data-testid="message-mention" data-path={path} aria-label={`Open ${path}`} onClick={() => open(path)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); open(path); } }}>{text}</span>
    : <span className="font-medium text-primary" data-testid="message-mention" data-path={path}>{text}</span>;
}

/** The icon a file card shows for its kind. */
function FileGlyph({ kind }: { readonly kind: FileKind }) {
  switch (kind) {
    case 'image': return <ImageIcon aria-hidden="true" />;
    case 'sheet': return <FileSpreadsheetIcon aria-hidden="true" />;
    case 'slides': return <PresentationIcon aria-hidden="true" />;
    case 'document': return <FileTextIcon aria-hidden="true" />;
    default: return <FileIcon aria-hidden="true" />;
  }
}

/** A file a person sent (an `uploads/` mention): its icon or thumbnail, name and type. A button when it can be opened. */
function FileCard({ path, open, preview, change }: { readonly path: string; readonly open: ((path: string) => void) | undefined; readonly preview: PreviewRead | undefined; readonly change?: 'created' | 'edited' }) {
  const { labels } = useChatText();
  const kind = fileKind(path), name = change ? path.split('/').pop() || path : displayName(path);
  const [src, setSrc] = useState<string | undefined>();
  // A thumbnail belongs to the provider that read it: a new provider, or a read that is refused or unavailable, shows the icon.
  useEffect(() => {
    setSrc(undefined);
    if (kind !== 'image' || !preview) return;
    const abort = new AbortController();
    preview(path, abort.signal).then(
      read => { if (!abort.signal.aborted) setSrc(read ? thumbnail(read.mimeType, read.data) : undefined); },
      () => { if (!abort.signal.aborted) setSrc(undefined); });
    return () => abort.abort();
  }, [kind, path, preview]);
  return <Attachment className="max-w-64" {...(!open ? { 'data-testid': 'message-mention', 'data-path': path } : {})}>
    <AttachmentMedia variant={src ? 'image' : 'icon'}>{src ? <img src={src} alt="" /> : <FileGlyph kind={kind} />}</AttachmentMedia>
    <AttachmentContent>
      <AttachmentTitle>{name}</AttachmentTitle>
      <AttachmentDescription>{change ? labels.fileChange[change] : labels.fileKind[kind]}</AttachmentDescription>
    </AttachmentContent>
    {open && <AttachmentTrigger data-testid="message-mention" data-path={path} aria-label={labels.openFile(name)} onClick={() => open(path)} />}
  </Attachment>;
}

/** The file cards of a message, above its text bubble. */
function FileCards({ paths, open, preview }: { readonly paths: readonly string[]; readonly open: ((path: string) => void) | undefined; readonly preview: PreviewRead | undefined }) {
  return <ul data-testid="message-files" className="m-0 flex max-w-[85%] list-none flex-wrap justify-end gap-2 p-0">
    {paths.map(path => <li key={path} data-testid="message-file"><FileCard path={path} open={open} preview={preview} /></li>)}
  </ul>;
}

/**
 * A text part of a sent message. Its `uploads/` mentions become file cards above the bubble and leave the text; the message content keeps
 * them (only what is drawn changes).
 */
export function MessageText({ text, context, align = 'end' }: { readonly text: string; readonly context: Pick<RowContext, 'pieces' | 'openFile'>; readonly align?: 'start' | 'end' }) {
  const open = context.pieces?.openMention;
  const render = context.pieces?.renderMention;
  if (!context.pieces) return <Bubble variant="muted" align={align}><BubbleContent data-testid="user-text"><span className="whitespace-pre-wrap">{text}</span></BubbleContent></Bubble>;
  const all = pieces(text, context.pieces);
  const isFile = (piece: Piece) => piece.kind === 'mention' && isUploadPath(piece.value!);
  const files = all.filter(isFile).map(piece => piece.value!);
  const shown = files.length ? visibleParts(all, isFile) : all;
  const empty = shown.every(piece => piece.kind === undefined && piece.text === '');
  return <>
    {files.length > 0 && <FileCards paths={files} open={context.openFile ?? open} preview={context.pieces.preview} />}
    {!(files.length > 0 && empty) && <Bubble variant="muted" align={align}><BubbleContent data-testid="user-text"><span className="whitespace-pre-wrap">{shown.map((piece, at) => piece.kind === 'mention'
      ? <UserMention key={at} path={piece.value!} text={piece.text} open={open} render={render} />
      : piece.kind === 'skill' ? <Badge key={at} variant="secondary" data-testid="message-skill" data-skill={piece.value}>{piece.text}</Badge>
      : piece.text)}</span></BubbleContent></Bubble>}
  </>;
}

function UserBubble({ message, context, align = 'end' }: { readonly message: UserMessage; readonly context: RowContext; readonly align?: 'start' | 'end' }) {
  const parts = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
  return <Message align={align}><MessageContent>
    {parts.map((part, index) => part.type === 'text' ? (isFileBlock(part.text) ? null : <MessageText key={index} text={part.text} context={context} align={align} />)
      : <Image key={index} image={part} onOpenImage={context.onOpenImage} />)}
  </MessageContent></Message>;
}

function Notice({ tone, icon, children, testid }: { readonly tone: 'error' | 'muted'; readonly icon: ReactNode; readonly children: ReactNode; readonly testid: string }) {
  return <Alert variant={tone === 'error' ? 'destructive' : 'default'} role={tone === 'error' ? 'alert' : 'status'} data-testid={testid}>
    {icon}<AlertDescription>{children}</AlertDescription>
  </Alert>;
}

function resultText(message: ToolResultMessage): string { return message.content.map(part => part.type === 'text' ? part.text : '').join('\n'); }

export function RowView({ row, context }: { readonly row: Row; readonly context: RowContext }) {
  return <RowBody row={row} context={context} />;
}

function RowBody({ row, context: liveContext }: { readonly row: Row; readonly context: RowContext }) {
  const context: RowContext = row.historical ? { ...liveContext, answer: undefined, onFork: undefined, messageActions: undefined, replyActions: undefined, commandMentions: undefined } : liveContext;
  const { labels, icons } = useChatText();
  const renderMention = useMemo(() => context.pieces?.mentions ? (path: string, text: string) => <UserMention path={path} text={text} open={context.pieces?.openMention} render={context.pieces?.renderMention} /> : undefined, [context.pieces]);
  switch (row.type) {
    case 'user': return <article data-row-id={row.key} data-role="user" aria-live={row.historical ? 'off' : undefined}><UserBubble message={row.message} context={context} /></article>;
    case 'card': return <article data-row-id={row.key} data-role="event">{row.card.content}</article>;
    case 'event': return <article data-row-id={row.key} data-role="event" className="text-center text-xs text-muted-foreground">{labels.event(row.label)}</article>;
    case 'system': return <article data-row-id={row.key} data-role="system"><Collapsible>
      <CollapsibleTrigger render={<Button variant="ghost" />}>{labels.systemContext}</CollapsibleTrigger>
      <CollapsibleContent><pre className="whitespace-pre-wrap">{row.text}</pre></CollapsibleContent>
    </Collapsible></article>;
    case 'orphan-result': return <article data-row-id={row.key} data-role="toolResult"><Notice tone="error" testid="tool-error" icon={<AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>
      <strong className="font-semibold">{labels.toolFailed(row.message.toolName)}</strong><span className="mt-1 block font-mono text-xs whitespace-pre-wrap">{resultText(row.message)}</span></Notice></article>;
    case 'assistant': {
      const settled = !row.streaming;
      const nativeActions = settled;
      const files = new Map<string, 'created' | 'edited'>();
      if (context.fileChanges) for (const part of row.parts) {
        if (part.kind !== 'tool' || part.entry.status !== 'completed') continue;
        const { call, result } = part.entry;
        const path = call.arguments['path'];
        if (!result || result.isError || result.toolName !== call.name || (call.name !== 'write' && call.name !== 'edit') || typeof path !== 'string' || !path.trim()) continue;
        const normalized = path.replace(/^(\.\/)+/, '');
        if (normalized) files.set(normalized, files.get(normalized) === 'created' || call.name === 'write' ? 'created' : 'edited');
      }
      const chunks = segments(row.parts, context.groupTool);
      const active = row.active === true || row.streaming;
      const lastText = [...row.parts].reverse().find(part => part.kind === 'text');
      const host = nativeActions && row.text && context.messageActions
        ? <BlockActions iconOnly actions={context.messageActions(replyRef(row))} testId="reply-action" menuLabel={labels.moreActions} />
        : null;
      return <article data-row-id={row.key} data-role="assistant" aria-live={row.historical ? 'off' : undefined} data-streaming={row.streaming ? 'true' : undefined} className="group/message">
        <Message><MessageContent>
        <div className="flex flex-col gap-3">
          {chunks.map((chunk, at) => {
            if (chunk.kind === 'activity') {
              const failed = chunk.steps.some(step => step.kind === 'tool' && step.entry.status === 'failed');
              const unfinished = chunk.steps.some(step => step.kind === 'tool' && step.entry.status === 'unfinished');
              const state: ActivityState = failed || row.stopReason === 'error' ? 'failed' : row.stopReason === 'aborted' || (!active && unfinished) ? 'stopped' : active && at === chunks.length - 1 ? 'running' : 'done';
              return <ActivityBlock key={chunk.key} steps={chunk.steps} state={state} streaming={row.streaming} developer={context.developer} {...(context.onOpenImage ? { onOpenImage: context.onOpenImage } : {})} />;
            }
            const part = chunk.part;
            if (part.kind === 'text') return <Bubble key={part.key} variant="ghost"><BubbleContent><Markdown text={part.text} renderMention={renderMention} streaming={row.streaming && part === lastText && row.parts[row.parts.length - 1] === part}
              {...(settled && context.commandMentions ? { commandMentions: context.commandMentions } : {})} {...(context.onCopy ? { onCopy: context.onCopy } : {})} /></BubbleContent></Bubble>;
            if (part.kind === 'thinking') return null; // reasoning is a step of an activity block
            if (part.kind === 'approval') return <ApprovalCard key={part.key} call={part.call} result={part.result} questionId={part.questionId} answer={context.answer} summary={part.summary} decision={part.decision} live={part.live} />;
            if (part.kind === 'question') return <QuestionCard key={part.key} call={part.call} result={part.result} questionId={part.questionId} answer={context.answer} live={part.live} />;
            if (part.kind === 'artifact' && part.artifact && files.has(part.artifact.target.resource.path.replace(/^(\.\/)+/, ''))) return null;
            if (part.kind === 'artifact') return <ArtifactCard key={part.key} artifact={part.artifact} title={part.title} {...(part.state === 'ready' ? {} : { pending: part.state })}
              open={part.artifact !== undefined && (context.artifacts?.isOpen?.(part.artifact) ?? false)} onOpen={context.artifacts?.open} kinds={context.artifacts?.kinds} />;
            return part.entry.custom ? <div key={part.key}>{part.entry.custom}</div> : <ToolCard key={part.key} entry={part.entry} {...(context.onOpenImage ? { onOpenImage: context.onOpenImage } : {})} />;
          })}
          {files.size > 0 && <ul data-testid="reply-files" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {[...files].map(([path, change]) => <li key={path} data-testid="message-file"><FileCard path={path} change={change} open={context.openFile} preview={context.pieces?.preview} /></li>)}
          </ul>}
          {row.streaming && row.parts.length === 0 && <p data-testid="working" className="m-0 text-sm"><Shimmer>{labels.thinking}</Shimmer></p>}
        </div>
        {row.stopReason === 'error' && <Notice tone="error" testid="response-error" icon={<AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>{row.errorMessage ?? labels.responseFailed}</Notice>}
        {row.stopReason === 'aborted' && <Notice tone="muted" testid="interrupted" icon={<CircleSlashIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>{labels.interrupted}</Notice>}
        {nativeActions && row.text && context.replyActions?.({ key: row.key, text: row.text, timestamp: row.timestamp }, host)}
        {nativeActions && row.text && !context.replyActions && <div className="mt-1 -ml-2 flex opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100 max-sm:opacity-100 motion-reduce:transition-none">
          <CopyButton iconOnly text={row.text} label={labels.copyResponse} {...(context.onCopy ? { onCopy: context.onCopy } : {})} />
          {context.onFork && row.entryId && <Button size="icon-sm" variant="ghost" aria-label={labels.fork} title={labels.forkHint} data-testid="fork-reply"
            onClick={() => context.onFork!(row.entryId!)}><icons.fork data-icon="inline-start" aria-hidden="true" /></Button>}
          {host}</div>}
        {nativeActions && !row.active && row.text && context.replyFooter && <MessageFooter>{context.replyFooter(replyRef(row))}</MessageFooter>}
        </MessageContent></Message>
      </article>;
    }
  }
}

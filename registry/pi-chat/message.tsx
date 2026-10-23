'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ImageContent, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import { AlertCircleIcon, CircleSlashIcon, FileAudioIcon, FileIcon, FileSpreadsheetIcon, FileTextIcon, ImageIcon, PauseIcon, PlayIcon, PresentationIcon } from 'lucide-react';
import { CopyButton } from './code-block';
import type { AnswerOutcome, ChatArtifactsConfig, ChatCards, CommandMentions } from './config';
import { feedbackContent } from './feedback-content';
import { SentFeedback } from './sent-feedback';
import { ActivityBlock } from './activity';
import type { ActivityState } from './activity';
import { Shimmer } from './shimmer';
import { ToolCard } from './tool';
import { thumbnail } from './composer';
import { ImageViewer } from './image-viewer';
import { displayName, fileKind, isUploadPath, isVoicePath, pieces, visibleParts } from './config';
import type { AudioUrlRead, FileKind, Piece, PreviewRead } from './config';
import { voiceClock } from './config';
import { Spinner } from '@/components/ui/spinner';
import { isFileBlock, segments, targetContent } from './rows';
import type { DeriveOptions, Row } from './rows';
import { Button } from '@/components/ui/button';
import { BlockActions } from '../button/actions';
import type { BlockAction } from '../button/actions';
import { useChatText } from './labels';
import { cn } from '../utils/utils';
import type { ReplyRef } from './config';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from '@/components/ui/attachment';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/** One assistant text part, as `renderText` receives it. `streaming` is true while the model still writes it. */
export interface ChatTextPart {
  readonly text: string;
  readonly streaming: boolean;
  /** Draws an `@path` mention (when mentions are on). */
  readonly renderMention?: ((path: string, text: string) => ReactNode) | undefined;
  /** The `/` commands a settled reply may turn into buttons. */
  readonly commandMentions?: CommandMentions | undefined;
  readonly onCopy?: ((text: string) => Promise<void>) | undefined;
}
/** The default text renderer: the reply as plain text. `markdownText` of `pi-chat-markdown` draws it as Markdown. */
const plainText = ({ text, streaming }: ChatTextPart): ReactNode =>
  <div data-testid="message-text" data-streaming={streaming ? 'true' : undefined} className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</div>;

export type { ChatCards } from './config';

export interface RowContext {
  readonly developer: boolean;
  /** Draws an assistant text part. Default: plain text (`markdownText` of `pi-chat-markdown` draws Markdown). */
  readonly renderText?: ((part: ChatTextPart) => ReactNode) | undefined;
  readonly cards?: ChatCards | undefined;
  /** `presentation="natural"`: no "working" shimmer in a reply (the chat shows one status instead). */
  readonly natural?: boolean | undefined;
  readonly groupTool: DeriveOptions['groupTool'];
  readonly commandMentions: CommandMentions | undefined;
  /** Host openers keep their single image argument; the workspace's default also accepts the message gallery. */
  readonly onOpenImage: ((image: ImageContent, gallery?: readonly ImageContent[]) => void) | undefined;
  readonly onCopy: ((text: string) => Promise<void>) | undefined;
  /** Which tokens of a sent message get a styled treatment (`@path` mentions, a leading `/skill`). */
  readonly pieces: { readonly mentions: boolean; readonly uploads?: boolean; readonly skills: readonly string[]; readonly openMention?: ((path: string) => void) | undefined; readonly renderMention?: ((path: string) => ReactNode | undefined) | undefined;
    readonly preview?: PreviewRead | undefined; readonly audioUrl?: AudioUrlRead | undefined } | undefined;
  readonly fileChanges?: boolean | undefined;
  /** Opens a file card through the host's workspace opener. */
  readonly openFile?: ((path: string) => void) | undefined;
  readonly answer: ((questionId: string, answer: string) => Promise<AnswerOutcome>) | undefined;
  readonly artifacts: { readonly open: ChatArtifactsConfig['open']; readonly isOpen?: ChatArtifactsConfig['isOpen'] | undefined; readonly kinds?: ChatArtifactsConfig['kinds']; readonly Card: NonNullable<ChatArtifactsConfig['Card']> } | undefined;
  /** Replaces the default copy button under a settled reply (the ambient window adds feedback and the time); `host` holds the host's message actions. */
  readonly replyActions?: ((reply: { readonly key: string; readonly text: string; readonly timestamp?: number | undefined }, host: ReactNode) => ReactNode) | undefined;
  /** The host's actions for a settled reply (`messageActions`). */
  readonly messageActions?: ((reply: ReplyRef) => readonly BlockAction[]) | undefined;
  readonly historicalMessageActions?: boolean | undefined;
  /** Host-owned per-answer unread indicator; rendering never marks an answer seen. */
  readonly unread?: ((reply: ReplyRef) => ReactNode) | undefined;
  readonly replyError?: ((reply: ReplyRef) => ReactNode) | undefined;
  /** A line under a finished reply (not while it streams, runs a tool or waits to retry), after its actions (a host shows which model answered and how long it took). */
  readonly replyFooter?: ((reply: ReplyRef) => ReactNode) | undefined;
  /** Fork the conversation after a settled reply (its last native entry): adds a Fork button next to Copy. */
  readonly onFork?: ((entryId: string) => void) | undefined;
}

const replyRef = (row: Extract<Row, { type: 'assistant' }>): ReplyRef => ({ key: row.key, text: row.text, entryId: row.entryId, timestamp: row.timestamp, model: row.model, durationMs: row.durationMs });

function ImageThumbnails({ images, onOpenImage }: { readonly images: readonly ImageContent[]; readonly onOpenImage: RowContext['onOpenImage'] }) {
  const { labels } = useChatText();
  if (!images.length) return null;
  return <div data-testid="message-images" data-slot="message-images" className={cn('grid max-w-full gap-2', images.length === 1 ? 'w-60' : 'w-120 grid-cols-2')}>
    {images.map((image, at) => <div key={at} className="relative min-h-12 min-w-12 self-start">
      <img src={thumbnail(image.mimeType, image.data)} alt={labels.imageAttachment} className="block h-auto w-full rounded-(--radius-xl)" />
      <Button variant="link" className="absolute inset-0 h-auto min-h-12 min-w-12 w-full" data-testid="message-image" aria-label={images.length > 1 ? `${labels.openImage}, ${labels.imagePosition(at + 1, images.length)}` : labels.openImage} onClick={() => onOpenImage?.(image, images)} />
    </div>)}
  </div>;
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
    case 'audio': return <FileAudioIcon aria-hidden="true" />;
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

/** Retained audio is read only on Play, through the same authorized workspace preview as file cards. */
export function VoiceBubble({ path, transcript, preview, audioUrl, align = 'end' }: { readonly path: string; readonly transcript: ReactNode; readonly preview: PreviewRead | undefined; readonly audioUrl: AudioUrlRead | undefined; readonly align?: 'start' | 'end' }) {
  const { labels } = useChatText();
  const audio = useRef<HTMLAudioElement>(null), work = useRef<AbortController | null>(null), loadingRequest = useRef(false);
  const [playing, setPlaying] = useState(false), [loading, setLoading] = useState(false), [failed, setFailed] = useState(false), [duration, setDuration] = useState<number>();
  const source = useRef<string | undefined>(undefined), loader = useRef<() => Promise<boolean>>(async () => false);
  useEffect(() => {
    const element = audio.current;
    let objectUrl: string | undefined;
    source.current = undefined; loadingRequest.current = false; setPlaying(false); setLoading(false); setFailed(false); setDuration(undefined);
    const release = () => { if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = undefined; } };
    const abort = new AbortController(); work.current = abort;
    const load = async () => {
      release();
      const signed = await audioUrl?.(path, abort.signal);
      if (abort.signal.aborted) return;
      if (signed) {
        const url = new URL(signed, window.location.href);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported audio URL');
        source.current = url.href;
      } else {
        const read = await preview?.(path, abort.signal);
        if (abort.signal.aborted) return;
        if (!read || !/^audio\/(?:webm|ogg|mp4|m4a|x-m4a|mpeg|mp3|wav|x-wav)(?:;|$)/i.test(read.mimeType)) throw new Error('Audio unavailable');
        const bytes = Uint8Array.from(atob(read.data), character => character.charCodeAt(0));
        // MediaRecorder WebM often has no finite metadata duration; decode only these already-requested bytes.
        try {
          if (typeof OfflineAudioContext === 'function') void new OfflineAudioContext(1, 1, 48_000).decodeAudioData(bytes.slice().buffer).then(buffer => {
            if (!abort.signal.aborted && Number.isFinite(buffer.duration)) setDuration(Math.round(buffer.duration));
          }).catch(() => {});
        } catch { /* Optional duration decoding must not prevent native playback. */ }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: read.mimeType })); source.current = objectUrl;
      }
      if (element && source.current) element.src = source.current;
    };
    // A loader belongs to this path/provider epoch, not to a later row with the same DOM node.
    loader.current = async () => { await load(); return !abort.signal.aborted; };
    return () => { abort.abort(); if (work.current === abort) work.current = null; element?.pause(); element?.removeAttribute('src'); element?.load(); source.current = undefined; release(); };
  }, [path, preview, audioUrl]);
  const toggle = async () => {
    const element = audio.current, abort = work.current;
    if (!element || !abort || loadingRequest.current) return;
    if (!element.paused) { element.pause(); return; }
    loadingRequest.current = true; setFailed(false); setLoading(true);
    try {
      if (!source.current && !await loader.current()) return;
      if (!abort.signal.aborted) await element.play();
    } catch { if (!abort.signal.aborted) setFailed(true); }
    finally { if (work.current === abort && !abort.signal.aborted) { loadingRequest.current = false; setLoading(false); } }
  };
  return <Bubble variant="muted" align={align} data-testid="voice-bubble"><BubbleContent>
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" data-testid="voice-play" aria-label={playing ? labels.voicePause : labels.voicePlay} disabled={loading || (!preview && !audioUrl)} onClick={() => { void toggle(); }}>
        {loading ? <Spinner data-icon="inline-start" aria-hidden="true" /> : playing ? <PauseIcon data-icon="inline-start" aria-hidden="true" /> : <PlayIcon data-icon="inline-start" aria-hidden="true" />}
      </Button>
      <span data-testid="voice-duration">{duration === undefined ? '--:--' : voiceClock(duration)}</span>
      <audio ref={audio} preload="none" onPlay={() => { setPlaying(true); setFailed(false); }} onPause={() => setPlaying(false)} onEnded={() => {
        setPlaying(false); const element = audio.current;
        if (element && !Number.isFinite(element.duration) && Number.isFinite(element.currentTime)) setDuration(Math.round(element.currentTime));
      }} onError={() => { setFailed(true); setPlaying(false); source.current = undefined; }} onDurationChange={() => {
        const element = audio.current; if (element && Number.isFinite(element.duration)) setDuration(Math.round(element.duration));
      }} onLoadedMetadata={() => {
        const element = audio.current; if (element && Number.isFinite(element.duration)) setDuration(Math.round(element.duration));
      }} />
    </div>
    {failed && <p role="alert">{labels.voicePlayFailed}</p>}
    {transcript && <div data-testid="user-text" className="whitespace-pre-wrap">{transcript}</div>}
  </BubbleContent></Bubble>;
}

/**
 * A text part of a sent message. Its `uploads/` mentions become file cards above the bubble and leave the text; the message content keeps
 * them (only what is drawn changes).
 */
export function MessageText({ text, context, align = 'end' }: { readonly text: string; readonly context: Pick<RowContext, 'pieces' | 'openFile'>; readonly align?: 'start' | 'end' }) {
  const target = targetContent(text);
  if (target) return <>
    <Badge variant="secondary" data-testid="message-target" title={JSON.stringify(target.target)} className="max-w-full truncate">{target.label}</Badge>
    <MessageText text={target.speech} context={context} align={align} />
  </>;
  const feedback = feedbackContent(text);
  if (feedback) return <>
    {feedback.before && <MessageText text={feedback.before} context={context} align={align} />}
    <SentFeedback report={feedback.report} align={align} />
    {feedback.after && <MessageText text={feedback.after} context={context} align={align} />}
  </>;
  const open = context.pieces?.openMention;
  const render = context.pieces?.renderMention;
  const styledUploads = Boolean(context.pieces?.mentions || context.pieces?.uploads);
  const all = pieces(text, { mentions: context.pieces?.mentions ?? false, uploads: true, skills: context.pieces?.skills ?? [] }).map((piece): Piece =>
    !styledUploads && piece.kind === 'mention' && isUploadPath(piece.value!) && !isVoicePath(piece.value!) ? { text: piece.text } : piece);
  const isFile = (piece: Piece) => piece.kind === 'mention' && isUploadPath(piece.value!);
  const files = all.filter(isFile).map(piece => piece.value!);
  const voice = files.find(isVoicePath), cards = files.filter(path => path !== voice);
  if (!context.pieces && !voice) return <Bubble variant="muted" align={align}><BubbleContent data-testid="user-text"><span className="whitespace-pre-wrap">{text}</span></BubbleContent></Bubble>;
  const shown = files.length ? visibleParts(all, isFile) : all;
  const empty = shown.every(piece => piece.kind === undefined && piece.text === '');
  const content = shown.map((piece, at) => piece.kind === 'mention'
    ? <UserMention key={at} path={piece.value!} text={piece.text} open={open} render={render} />
    : piece.kind === 'skill' ? <Badge key={at} variant="secondary" data-testid="message-skill" data-skill={piece.value}>{piece.text}</Badge>
    : piece.text);
  return <>
    {cards.length > 0 && <FileCards paths={cards} open={context.openFile ?? open} preview={context.pieces?.preview} />}
    {voice ? <VoiceBubble path={voice} transcript={empty ? null : content} preview={context.pieces?.preview} audioUrl={context.pieces?.audioUrl} align={align} />
      : !(files.length > 0 && empty) && <Bubble variant="muted" align={align}><BubbleContent data-testid="user-text"><span className="whitespace-pre-wrap">{content}</span></BubbleContent></Bubble>}
  </>;
}

function UserBubble({ message, images, context, align = 'end' }: { readonly message: UserMessage; readonly images: readonly ImageContent[]; readonly context: RowContext; readonly align?: 'start' | 'end' }) {
  const parts = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
  return <Message align={align}><MessageContent>
    <ImageThumbnails images={images} onOpenImage={context.onOpenImage} />
    {parts.map((part, index) => part.type === 'text' ? (isFileBlock(part.text) ? null : <MessageText key={index} text={part.text} context={context} align={align} />)
      : null)}
  </MessageContent></Message>;
}

function Notice({ tone, icon, children, testid }: { readonly tone: 'error' | 'muted'; readonly icon: ReactNode; readonly children: ReactNode; readonly testid: string }) {
  return <Alert variant={tone === 'error' ? 'destructive' : 'default'} role={tone === 'error' ? 'alert' : 'status'} data-testid={testid}>
    {icon}<AlertDescription>{children}</AlertDescription>
  </Alert>;
}

/**
 * A question or an approval waits for the person but this chat has no card for it (no `pi-chat-question` or `pi-chat-approval`): say so,
 * so the run is never silently blocked. It offers no answer UI.
 */
function AnswerWaiting({ kind }: { readonly kind: 'question' | 'approval' }) {
  const { labels } = useChatText();
  return <Alert role="status" data-testid="answer-waiting" data-kind={kind}>
    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><AlertDescription>{labels.waitingForAnswer}</AlertDescription>
  </Alert>;
}

function resultText(message: ToolResultMessage): string { return message.content.map(part => part.type === 'text' ? part.text : '').join('\n'); }

function messageImages(row: Row): readonly ImageContent[] {
  const images = (content: ToolResultMessage['content']) => content.flatMap(part => part.type === 'image' && thumbnail(part.mimeType, part.data) ? [part] : []);
  if (row.type === 'user') return typeof row.message.content === 'string' ? [] : images(row.message.content);
  if (row.type === 'orphan-result') return images(row.message.content);
  return row.type === 'assistant' ? row.images?.filter(image => thumbnail(image.mimeType, image.data)) ?? row.parts.flatMap(part => part.kind === 'tool' && part.entry.result ? images(part.entry.result.content) : []) : [];
}

export function RowView({ row, context }: { readonly row: Row; readonly context: RowContext }) {
  const images = messageImages(row);
  const [selection, setSelection] = useState<{ readonly index: number; readonly images: readonly ImageContent[]; readonly key: string; readonly opener: RowContext['onOpenImage'] }>();
  const current = selection && selection.key === row.key && selection.opener === context.onOpenImage && selection.images.length === images.length
    && selection.images.every((image, at) => image.mimeType === images[at]?.mimeType && image.data === images[at]?.data) ? selection : undefined;
  useEffect(() => { if (selection && !current) setSelection(undefined); }, [selection, current]);
  const openImage: NonNullable<RowContext['onOpenImage']> = image => {
    if (!thumbnail(image.mimeType, image.data)) return;
    if (context.onOpenImage) { context.onOpenImage(image, images); return; }
    const index = images.indexOf(image);
    if (index >= 0) setSelection({ index, images, key: row.key, opener: context.onOpenImage });
  };
  return <><RowBody row={row} images={images} context={{ ...context, onOpenImage: openImage }} />
    {current && <ImageViewer images={images} index={current.index} onIndexChange={index => setSelection({ ...current, index })} onClose={() => setSelection(undefined)} />}
  </>;
}

function RowBody({ row, images, context: liveContext }: { readonly row: Row; readonly images: readonly ImageContent[]; readonly context: RowContext }) {
  const context: RowContext = row.historical ? { ...liveContext, answer: undefined, onFork: undefined, messageActions: liveContext.historicalMessageActions ? liveContext.messageActions : undefined, replyActions: undefined, commandMentions: undefined } : liveContext;
  const { labels, icons } = useChatText();
  const renderMention = useMemo(() => context.pieces?.mentions ? (path: string, text: string) => <UserMention path={path} text={text} open={context.pieces?.openMention} render={context.pieces?.renderMention} /> : undefined, [context.pieces]);
  switch (row.type) {
    case 'user': return <article data-row-id={row.key} data-role="user" aria-live={row.historical ? 'off' : undefined}><UserBubble message={row.message} images={images} context={context} /></article>;
    case 'card': return <article data-row-id={row.key} data-role="event">{row.card.content}</article>;
    case 'event': return <article data-row-id={row.key} data-role="event" className="text-center text-xs text-muted-foreground">{labels.event(row.label)}</article>;
    case 'system': return <article data-row-id={row.key} data-role="system"><Collapsible>
      <CollapsibleTrigger render={<Button variant="ghost" />}>{labels.systemContext}</CollapsibleTrigger>
      <CollapsibleContent><pre className="whitespace-pre-wrap">{row.text}</pre></CollapsibleContent>
    </Collapsible></article>;
    case 'orphan-result': return <article data-row-id={row.key} data-role="toolResult"><Notice tone="error" testid="tool-error" icon={<AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>
      <strong className="font-semibold">{labels.toolFailed(row.message.toolName)}</strong><span className="mt-1 block font-mono text-xs whitespace-pre-wrap">{resultText(row.message)}</span></Notice><ImageThumbnails images={images} onOpenImage={context.onOpenImage} /></article>;
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
      const { question: Question, approval: Approval } = context.cards ?? {};
      const active = row.active === true || row.streaming;
      const lastText = [...row.parts].reverse().find(part => part.kind === 'text');
      const host = nativeActions && row.text && context.messageActions
        ? <BlockActions iconOnly actions={context.messageActions(replyRef(row))} testId="reply-action" menuLabel={labels.moreActions} />
        : null;
      const unread = nativeActions && row.text ? context.unread?.(replyRef(row)) : null;
      const footer = nativeActions && !row.active && row.text ? context.replyFooter?.(replyRef(row)) : null;
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
            if (part.kind === 'card') return <div key={part.key}>{part.content}</div>;
            if (part.kind === 'text') return <Bubble key={part.key} variant="ghost"><BubbleContent>{(context.renderText ?? plainText)({ text: part.text, renderMention, streaming: row.streaming && part === lastText && row.parts[row.parts.length - 1] === part,
              ...(settled && context.commandMentions ? { commandMentions: context.commandMentions } : {}), ...(context.onCopy ? { onCopy: context.onCopy } : {}) })}</BubbleContent></Bubble>;
            if (part.kind === 'thinking') return null; // reasoning is a step of an activity block
            if (part.kind === 'approval') return Approval ? <Approval key={part.key} call={part.call} result={part.result} questionId={part.questionId} answer={context.answer} summary={part.summary} decision={part.decision} live={part.live} />
              : !part.live && !part.result && !part.decision ? <AnswerWaiting key={part.key} kind="approval" /> : null;
            if (part.kind === 'subagent') return <Fragment key={part.key}>{part.content}</Fragment>;
            if (part.kind === 'question') return Question ? <Question key={part.key} call={part.call} result={part.result} questionId={part.questionId} answer={context.answer} live={part.live} />
              : !part.live && !part.result ? <AnswerWaiting key={part.key} kind="question" /> : null;
            if (part.kind === 'artifact') {
              const { artifact } = part, artifacts = context.artifacts;
              if (!artifacts || (artifact.path !== undefined && files.has(artifact.path.replace(/^(\.\/)+/, '')))) return null;
              const descriptor = artifact.descriptor as never;
              return <artifacts.Card key={part.key} artifact={artifact} open={artifact.state === 'ready' && (artifacts.isOpen?.(descriptor) ?? false)}
                onOpen={artifact.state === 'ready' ? () => artifacts.open(descriptor) : undefined} kinds={artifacts.kinds} />;
            }
            return part.entry.custom ? <div key={part.key}>{part.entry.custom}</div> : <ToolCard key={part.key} entry={part.entry} {...(context.onOpenImage ? { onOpenImage: context.onOpenImage } : {})} />;
          })}
          <ImageThumbnails images={images} onOpenImage={context.onOpenImage} />
          {files.size > 0 && <ul data-testid="reply-files" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {[...files].map(([path, change]) => <li key={path} data-testid="message-file"><FileCard path={path} change={change} open={context.openFile} preview={context.pieces?.preview} /></li>)}
          </ul>}
          {row.streaming && row.parts.length === 0 && !context.natural && <p data-testid="working" className="m-0 text-sm"><Shimmer>{labels.thinking}</Shimmer></p>}
        </div>
        {row.stopReason === 'error' && <Notice tone="error" testid="response-error" icon={<AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>{context.replyError?.(replyRef(row)) ?? row.errorMessage ?? labels.responseFailed}</Notice>}
        {row.stopReason === 'aborted' && <Notice tone="muted" testid="interrupted" icon={<CircleSlashIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>{labels.interrupted}</Notice>}
        {unread != null && unread !== false && <div data-testid="reply-unread" className="flex flex-col items-start">{unread}</div>}
        {nativeActions && row.text && context.replyActions?.({ key: row.key, text: row.text, timestamp: row.timestamp }, host)}
        {nativeActions && row.text && !context.replyActions && <div className="mt-1 -ml-2 flex opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100 max-sm:opacity-100 motion-reduce:transition-none">
          <CopyButton iconOnly text={row.text} label={labels.copyResponse} {...(context.onCopy ? { onCopy: context.onCopy } : {})} />
          {context.onFork && row.entryId && <Button size="icon-sm" variant="ghost" aria-label={labels.fork} title={labels.forkHint} data-testid="fork-reply"
            onClick={() => context.onFork!(row.entryId!)}><icons.fork data-icon="inline-start" aria-hidden="true" /></Button>}
          {host}</div>}
        {footer != null && footer !== false && <MessageFooter>{footer}</MessageFooter>}
        </MessageContent></Message>
      </article>;
    }
  }
}

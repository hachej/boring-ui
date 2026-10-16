'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent, ReactNode, Ref } from 'react';
import { AlertCircleIcon, FileTextIcon, Loader2Icon, MessageSquarePlusIcon, SlashIcon, XIcon } from 'lucide-react';
import { Button } from '../button/button';
import { hasMention, isLongPaste, mentionToken, mentionTrigger, removeMention, slashItems, slashQuery } from './config';
import type { MentionsConfig, PastedText, PasteToFile, SlashConfig, SlashItem } from './config';
import { MentionMenu } from './mention-menu';
import { SlashMenu } from './slash-menu';
import { useChatText } from './labels';
import { cn } from '../utils/utils';

export interface ComposerAttachment { readonly id: string; readonly name: string; readonly mimeType: string; readonly data: string }

const SAFE_IMAGE = /^image\/(png|jpe?g|gif|webp)$/;
const BASE64 = /^[A-Za-z0-9+/=\s]+$/;
/** A data URL for a thumbnail, only for common image types and well-formed base64. */
export function thumbnail(mimeType: string, data: string): string | undefined {
  return SAFE_IMAGE.test(mimeType) && BASE64.test(data) ? `data:${mimeType};base64,${data}` : undefined;
}

/**
 * The optional annotate toggle (FEEDBACK.md, "UX"): one button in the composer's row that arms element targeting on the host's page,
 * and one count chip for the notes taken. Send attaches them. The host owns everything else (the registry `feedback` item's
 * `useComposerFeedback` returns this shape). Absent: the composer is unchanged.
 */
export interface ComposerFeedback {
  /** The annotate toggle: arms targeting on the page (point mode on touch and compact screens), or stops it when it is on. */
  readonly annotate: () => void;
  /** Annotating is on: the toggle shows pressed. */
  readonly active: boolean;
  /** Notes taken and waiting to be sent with the next message; above zero, Send is allowed with no text. */
  readonly count: number;
  /** Removes the notes (the count chip's remove button). */
  readonly clear: () => void;
  /** Send: the text to send instead, with the notes attached, or why they cannot be sent yet. */
  readonly attach: (text: string) => Promise<{ readonly kind: 'ok'; readonly text: string } | { readonly kind: 'refused'; readonly reason: string }>;
  /** The message carrying the notes was accepted. */
  readonly sent: () => void;
}

/** One file being uploaded (or that failed to upload), shown as a chip until it settles or is dismissed. */
export interface PendingUpload {
  readonly id: string; readonly name: string; readonly state: 'uploading' | 'failed'; readonly error?: string;
  /** A pasted text file: abandons the upload and puts the text back in the message (its restore button, or Ctrl+Z). */
  readonly cancel?: (() => void) | undefined;
  /** The message text right after the paste was accepted: Ctrl+Z restores only while the text is still this (any later edit leaves it alone). */
  readonly restoreWhile?: string | undefined;
}

export interface ComposerProps {
  /** `/` menu of commands and skills. Absent: no menu and no keyboard trigger. */
  readonly slash?: SlashConfig | undefined;
  /** Reports a failing command. */
  readonly onSlashError?: ((cause: unknown) => void) | undefined;
  /** `@` file picker. Absent: no picker. */
  readonly mentions?: MentionsConfig | undefined;
  /** Paths picked or uploaded as mentions; each shows as a chip while its `@path` is still in the text. */
  readonly mentionPaths?: readonly string[];
  readonly onMentionPicked?: ((path: string) => void) | undefined;
  readonly uploads?: readonly PendingUpload[];
  readonly onDismissUpload?: ((id: string) => void) | undefined;
  /** A paste above `pasteToFile`'s limits, taken by the composer: the host uploads it as a file. Absent: pastes stay inline. */
  readonly onPasteText?: ((paste: PastedText) => void) | undefined;
  readonly pasteToFile?: PasteToFile | undefined;
  /** Extra controls in the bar (the model and effort pill) and a short note beside them. */
  readonly barStart?: ReactNode;
  readonly barNote?: ReactNode;
  /** Optional host mode/model chips beside the attach control. */
  readonly chips?: ReactNode;
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly attachments: readonly ComposerAttachment[];
  readonly onRemoveAttachment: (id: string) => void;
  /** The agent is working: the primary button stops it and Enter queues the message (steering is chosen on the queued message). */
  readonly working: boolean;
  /** A send would be refused right now (not connected, a submission in flight, uploading). */
  readonly sendBlocked: boolean;
  readonly disabled: boolean;
  readonly stopRequested: boolean;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly uploading: boolean;
  readonly canAttach: boolean;
  readonly fileAccept: string;
  readonly onPickFiles: (files: readonly File[]) => void;
  readonly onKeyDown?: ((event: KeyboardEvent<HTMLTextAreaElement>) => void) | undefined;
  readonly textareaRef: Ref<HTMLTextAreaElement>;
  readonly placeholder?: string;
  /** `card` (default): full-width text above a row of round controls. The former `pill`, `stacked` and `inline` layouts are explicit compatibility choices. */
  readonly layout?: 'card' | 'pill' | 'stacked' | 'inline';
  /** Host controls (for example a voice button) as round buttons between the model pill and the send button. */
  readonly barEnd?: ReactNode;
  /** The optional Feedback button and chip. */
  readonly feedback?: ComposerFeedback | undefined;
}

/** Compact bar buttons expand to 44px for touch. */
const ROUND = 'inline-flex size-10 max-sm:size-11 pointer-coarse:size-11 shrink-0 cursor-pointer items-center justify-center rounded-(--chat-send-radius) bg-muted text-muted-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none';

/** The annotate toggle (a round bar button beside the "+" menu in both layouts). */
function AnnotateButton({ feedback, disabled }: { readonly feedback: ComposerFeedback; readonly disabled: boolean }) {
  const { labels } = useChatText();
  return <button type="button" data-testid="composer-annotate" aria-pressed={feedback.active} disabled={disabled}
    title={labels.annotateHint} onClick={() => feedback.annotate()}
    className={cn(ROUND, feedback.active && 'bg-accent')}>
    <MessageSquarePlusIcon className="size-4" aria-hidden="true" /><span className="sr-only">{labels.annotate}</span>
  </button>;
}

/** The count chip: how many notes go with the next message, and a way to drop them. */
function NotesChip({ feedback }: { readonly feedback: ComposerFeedback }) {
  const { labels } = useChatText();
  return <span data-testid="feedback-count" data-count={feedback.count} className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pr-1 pl-2.5">
    <MessageSquarePlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="text-xs font-medium">{labels.annotateNotes(feedback.count)}</span>
    <button type="button" data-testid="feedback-count-clear" aria-label={labels.annotateClear} title={labels.annotateClear} onClick={() => feedback.clear()}
      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground relative after:absolute after:-inset-3 after:content-[''] transition-colors outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><XIcon className="size-3" aria-hidden="true" /></button>
  </span>;
}

/** The "+" button and its small menu (Attach files, Commands). Arrow keys move, Enter picks, Escape and outside clicks close. */
function PlusMenu({ disabled, onAttach, onCommands }: { readonly disabled: boolean; readonly onAttach?: (() => void) | undefined; readonly onCommands?: (() => void) | undefined }) {
  const { labels, icons } = useChatText();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const entries = [onAttach && { testid: 'composer-attach', label: labels.attachFiles, icon: <icons.attach className="size-4 text-muted-foreground" aria-hidden="true" />, run: onAttach },
    onCommands && { testid: 'composer-commands', label: labels.commands, icon: <SlashIcon className="size-4 text-muted-foreground" aria-hidden="true" />, run: onCommands }].filter(entry => entry);
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  };
  return <div ref={root} className="relative shrink-0" onKeyDown={onKeyDown}>
    <button ref={trigger} type="button" data-testid="composer-plus" aria-label={labels.add} title={labels.add} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)} className={ROUND}>
      <icons.add className="size-5" aria-hidden="true" /></button>
    {open && <div role="menu" aria-label={labels.add} data-testid="composer-plus-menu" className="absolute bottom-full left-0 z-30 mb-2 w-52 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
      {entries.map((entry, index) => entry && <button key={entry.testid} type="button" role="menuitem" data-testid={entry.testid} autoFocus={index === 0}
        onClick={() => { setOpen(false); entry.run(); }}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground outline-none hover:bg-accent focus-visible:bg-accent">{entry.icon}{entry.label}</button>)}
    </div>}
  </div>;
}

const MAX_HEIGHT = 208;

/** Prompt composer: auto-growing textarea, Enter to send, one primary Send/Stop button. While the agent works a message is queued. */
export function Composer(props: ComposerProps) {
  const { text, attachments, working, sendBlocked, disabled, stopRequested, uploading, canAttach, layout = 'card' } = props;
  const { labels, icons } = useChatText();
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [caret, setCaret] = useState(0);
  // A menu closed with Escape stays closed until the text changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => { setDismissed(value => value === null || value === text ? value : null); }, [text]);
  const pendingCaret = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { slash, mentions } = props;
  const items = useMemo<SlashItem[]>(() => slash ? slashItems(slash) : [], [slash]);
  const setRef = (element: HTMLTextAreaElement | null) => {
    inner.current = element;
    if (typeof props.textareaRef === 'function') props.textareaRef(element); else if (props.textareaRef) (props.textareaRef as { current: HTMLTextAreaElement | null }).current = element;
  };
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
      element.style.overflowY = element.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
    };
    resize();
    if (pendingCaret.current !== null) { element.setSelectionRange(pendingCaret.current, pendingCaret.current); element.focus(); pendingCaret.current = null; }
    if (typeof ResizeObserver === 'undefined') return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = element.clientWidth;
      if (next === width) return;
      width = next; resize();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  const query = slash && items.length ? slashQuery(text, caret) : null;
  const trigger = query === null && mentions ? mentionTrigger(text, caret) : null;
  const slashOpen = query !== null && dismissed !== text, mentionOpen = trigger !== null && dismissed !== text;
  const menuOpen = slashOpen || mentionOpen;
  const edit = (next: string, position: number) => { pendingCaret.current = position; setCaret(position); props.onText(next); };
  const trackCaret = (element: HTMLTextAreaElement) => setCaret(element.selectionStart ?? element.value.length);
  const dismiss = () => setDismissed(text);
  const pickSlash = (item: SlashItem) => {
    const rest = text.slice(caret).replace(/^\s+/, '');
    if (item.source === 'skill') return edit(`/${item.name} ${rest}`, item.name.length + 2);
    const command = slash?.commands?.find(candidate => candidate.name === item.name);
    props.onText(rest); setCaret(0);
    inner.current?.focus();
    if (!command) return;
    try { void Promise.resolve(command.run({ text: rest, setText: value => props.onText(value) })).catch(cause => props.onSlashError?.(cause)); }
    catch (cause) { props.onSlashError?.(cause); }
  };
  const pickMention = (path: string) => {
    if (!trigger) return;
    const token = `${mentionToken(path)} `;
    edit(`${text.slice(0, trigger.start)}${token}${text.slice(trigger.end)}`, trigger.start + token.length);
    props.onMentionPicked?.(path);
  };
  const openCommands = () => edit(`${text}${text && !/\s$/.test(text) ? ' ' : ''}/`, text.length + (text && !/\s$/.test(text) ? 2 : 1));
  const chips = (props.mentionPaths ?? []).filter(path => hasMention(text, path));
  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => { trackCaret(event.currentTarget); props.onText(event.currentTarget.value); };

  const { feedback } = props;
  const hasContent = text.trim().length > 0 || attachments.length > 0 || (feedback?.count ?? 0) > 0;
  const canSubmit = hasContent && !sendBlocked && !disabled;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    // Ctrl+Z right after a paste that is still uploading puts the pasted text back, instead of undoing the paste in the textarea.
    const undo = (props.uploads ?? []).filter(item => item.state === 'uploading' && item.cancel && item.restoreWhile === props.text).pop();
    if (undo && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo.cancel!(); return; }
    // Never send while an input method editor is composing (Enter confirms the candidate).
    // A phone keyboard has no Shift+Enter: on a touch device Enter inserts a newline and the Send button sends.
    const touch = globalThis.matchMedia?.('(pointer: coarse)').matches === true;
    if (event.key === 'Enter' && !touch && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (canSubmit) props.onSend();
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (canAttach && event.clipboardData.files.length) { event.preventDefault(); props.onPickFiles(Array.from(event.clipboardData.files)); return; }
    if (!props.onPasteText) return;
    const pasted = event.clipboardData.getData('text/plain');
    if (!isLongPaste(pasted, props.pasteToFile)) return;
    event.preventDefault();
    props.onPasteText({ text: pasted, start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
  };
  const drag = (event: DragEvent) => { if (canAttach) { event.preventDefault(); setDragging(event.type === 'dragover'); } };
  const drop = (event: DragEvent) => { if (!canAttach) return; event.preventDefault(); setDragging(false); props.onPickFiles(Array.from(event.dataTransfer.files)); };

  const chipRows = <>
    {(chips.length > 0 || (props.uploads?.length ?? 0) > 0 || (feedback?.count ?? 0) > 0) && <div className="flex flex-wrap gap-2 px-3 pt-3">
      {feedback && feedback.count > 0 && <NotesChip feedback={feedback} />}
      {chips.length > 0 && <ul data-testid="mention-chips" aria-label={labels.mentionedFiles} className="m-0 contents list-none p-0">
        {chips.map(path => <li key={path} data-testid="mention-chip" data-path={path} title={path} className="flex h-9 max-w-full sm:max-w-[16rem] items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pr-1 pl-2.5">
          <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{path}</span>
          <button type="button" aria-label={labels.remove(path)} onClick={() => props.onText(removeMention(text, path))}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground relative after:absolute after:-inset-3 after:content-[''] transition-colors outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><XIcon className="size-3" aria-hidden="true" /></button>
        </li>)}
      </ul>}
      {(props.uploads?.length ?? 0) > 0 && <ul data-testid="uploads" aria-label={labels.uploads} className="m-0 contents list-none p-0">
        {props.uploads!.map(item => <li key={item.id} data-testid="upload-chip" data-state={item.state} title={item.error ?? item.name}
          className={cn('flex h-9 max-w-full sm:max-w-[20rem] items-center gap-1.5 rounded-full border py-1 pr-1 pl-2.5', item.state === 'failed' ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-muted/50')}>
          {item.state === 'failed' ? <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
            : <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.state === 'failed' ? labels.uploadFailed(item.name, item.error) : labels.uploading(item.name)}</span>
          {item.cancel && <button type="button" aria-label={labels.restorePaste} title={labels.restorePaste} onClick={() => item.cancel!()}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground relative after:absolute after:-inset-3 after:content-[''] transition-colors outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><XIcon className="size-3" aria-hidden="true" /></button>}
          {item.state === 'failed' && <button type="button" aria-label={labels.dismiss(item.name)} onClick={() => props.onDismissUpload?.(item.id)}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground relative after:absolute after:-inset-3 after:content-[''] transition-colors outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><XIcon className="size-3" aria-hidden="true" /></button>}
        </li>)}
      </ul>}
    </div>}
  </>;
  const attachmentRow = attachments.length > 0 && <ul data-testid="attachments" aria-label={labels.attachments} className="m-0 flex list-none flex-wrap gap-2 px-3 pt-3">
      {attachments.map(attachment => {
        const src = thumbnail(attachment.mimeType, attachment.data);
        return <li key={attachment.id} data-testid="attachment" className="flex h-9 max-w-full sm:max-w-[14rem] items-center gap-2 rounded-full border border-border bg-muted/50 py-1 pr-1 pl-1">
          {src ? <img src={src} alt="" className="size-7 shrink-0 rounded-full object-cover" /> : <span className="size-7 shrink-0 rounded-full bg-muted" />}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{attachment.name}</span>
          <button type="button" aria-label={labels.remove(attachment.name)} onClick={() => props.onRemoveAttachment(attachment.id)}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground relative after:absolute after:-inset-3 after:content-[''] transition-colors outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"><XIcon className="size-3" aria-hidden="true" /></button>
        </li>;
      })}
    </ul>;
  const textareaEl = <textarea ref={setRef} data-testid="composer-input" aria-label={labels.messageInput} rows={1} value={text} disabled={disabled}
      placeholder={props.placeholder ?? (working ? labels.placeholderWorking : labels.placeholder)}
      {...(slash || mentions ? { role: 'combobox', 'aria-expanded': menuOpen, 'aria-haspopup': 'listbox', 'aria-autocomplete': 'list' } as const : {})}
      onChange={onChange} onKeyDown={onKeyDown} onPaste={onPaste} onKeyUp={event => trackCaret(event.currentTarget)} onClick={event => trackCaret(event.currentTarget)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      className={layout === 'inline'
        ? 'block max-h-40 min-h-11 min-w-0 flex-1 resize-none order-first basis-full border-0 bg-transparent px-1.5 py-2.5 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed'
        : layout !== 'pill' ? 'block max-h-52 min-h-11 w-full resize-none border-0 bg-transparent px-4 py-3 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed'
        : 'block max-h-52 min-h-11 min-w-0 flex-1 resize-none overflow-x-hidden placeholder-shown:whitespace-nowrap border-0 bg-transparent px-1 py-2.5 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed'} />;
  const plus = (canAttach || items.length > 0) && <PlusMenu disabled={disabled} onAttach={canAttach ? () => fileInput.current?.click() : undefined} onCommands={items.length > 0 ? openCommands : undefined} />;
  const fileEl = canAttach && <input ref={fileInput} type="file" multiple accept={props.fileAccept} disabled={disabled} tabIndex={-1} aria-hidden="true" className="sr-only" data-testid="composer-file" data-attach="true"
    onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; props.onPickFiles(files); }} />;
  const chipsControl = props.chips && <div className="flex min-w-0 items-center gap-2 [&>button]:h-10 [&>button]:rounded-full [&>button]:px-3 max-sm:[&>button]:h-11 pointer-coarse:[&>button]:h-11">{props.chips}</div>;
  const send = working
    ? <Button variant="default" size="icon" data-testid="composer-submit" data-state="stop" aria-label={labels.stop} title={labels.stop} disabled={disabled || stopRequested} onClick={props.onStop} className="ml-auto size-10 rounded-(--chat-send-radius) max-sm:size-11 pointer-coarse:size-11 shrink-0">
      {stopRequested ? <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <icons.stop className="size-4 fill-current" aria-hidden="true" />}</Button>
    : <Button variant="default" size="icon" type="submit" data-testid="composer-submit" data-state="send" aria-label={labels.send} title={labels.sendHint} disabled={!canSubmit} className="ml-auto size-10 rounded-(--chat-send-radius) max-sm:size-11 pointer-coarse:size-11 shrink-0 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100">
      <icons.send className="size-5" aria-hidden="true" /></Button>;

  if (layout === 'inline') return <form data-testid="composer" data-layout="inline" onSubmit={event => { event.preventDefault(); if (canSubmit) props.onSend(); }} onDragOver={drag} onDragLeave={drag} onDrop={drop}
    className={cn('relative bg-card', dragging && 'rounded-2xl ring-2 ring-ring/40', disabled && 'opacity-70')}>
    {slashOpen && <SlashMenu query={query!} items={items} onSelect={pickSlash} onDismiss={dismiss} />}
    {mentionOpen && mentions && <MentionMenu query={trigger!.query} search={mentions.search} generation={mentions.generation} onSelect={pickMention} onDismiss={dismiss} />}
    {chipRows}
    {attachmentRow}
    <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-2">
      {fileEl}
      {plus}
      {feedback && <AnnotateButton feedback={feedback} disabled={disabled} />}
      {textareaEl}
      {props.barNote}
      {props.barStart}
      {chipsControl}
      {props.barEnd}
      {uploading && !(props.uploads?.length) && <Loader2Icon role="status" aria-label={labels.preparingAttachmentsShort} className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />}
      {working && hasContent && <Button variant="secondary" size="sm" data-testid="composer-queue" disabled={!canSubmit} onClick={props.onSend} className="h-11 shrink-0 rounded-full px-4"><icons.queue className="size-3.5" aria-hidden="true" />{labels.queue}</Button>}
      {send}
    </div>
  </form>;

  return <form data-testid="composer" data-layout={layout} onSubmit={event => { event.preventDefault(); if (canSubmit) props.onSend(); }} onDragOver={drag} onDragLeave={drag} onDrop={drop}
    className={cn('relative rounded-(--chat-composer-radius) border border-input/60 bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20 motion-reduce:transition-none',
      layout === 'pill' && '@container/composer', dragging && 'border-ring ring-[3px] ring-ring/20', disabled && 'opacity-70')}>
    {slashOpen && <SlashMenu query={query!} items={items} onSelect={pickSlash} onDismiss={dismiss} />}
    {mentionOpen && mentions && <MentionMenu query={trigger!.query} search={mentions.search} generation={mentions.generation} onSelect={pickMention} onDismiss={dismiss} />}
    {chipRows}
    {attachmentRow}
    {layout !== 'pill' && textareaEl}
    <div data-testid="composer-controls" className={cn('flex flex-nowrap items-center gap-2 px-3 pb-3', layout === 'pill' && 'py-2')}>
      {fileEl}
      {plus}
      {layout === 'pill' && textareaEl}
      {feedback && <AnnotateButton feedback={feedback} disabled={disabled} />}
      {props.barStart}
      {chipsControl}
      {props.barNote}
      {uploading && !(props.uploads?.length) && <span role="status" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2Icon className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />{labels.preparingAttachments}</span>}
      {layout !== 'pill' && <span className="min-w-0 flex-1" />}
      {props.barEnd && <div data-testid="composer-tools" className="flex shrink-0 items-center gap-2 [&>button]:h-10 [&>button]:min-w-10 [&>button]:rounded-(--chat-send-radius) [&>button]:bg-muted max-sm:[&>button]:h-11 max-sm:[&>button]:min-w-11 pointer-coarse:[&>button]:h-11 pointer-coarse:[&>button]:min-w-11">{props.barEnd}</div>}
      {working && hasContent && <Button variant="secondary" size="sm" data-testid="composer-queue" disabled={!canSubmit} onClick={props.onSend} className="h-10 shrink-0 rounded-full px-4 max-sm:h-11 pointer-coarse:h-11">
        <icons.queue className="size-3.5" aria-hidden="true" />{labels.queue}</Button>}
      {send}
    </div>
  </form>;
}

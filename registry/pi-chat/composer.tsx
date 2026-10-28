'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, ComponentProps, DragEvent, KeyboardEvent, ReactNode, Ref } from 'react';
import { AlertCircleIcon, FileTextIcon, Loader2Icon, MessageSquarePlusIcon, SlashIcon, XIcon } from 'lucide-react';
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentMedia, AttachmentTitle } from '@/components/ui/attachment';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@/components/ui/input-group';
import { Toggle } from '@/components/ui/toggle';
import { hasMention, isLongPaste, kindMentionDraft, mentionedPaths, mentionKind, mentionToken, mentionTrigger, removeMention, slashItems, slashQuery, writeKindMentionDraft } from '@hachej/boring-ui-kit/chat-text';
import type { PasteToFile, SlashItem } from '@hachej/boring-ui-kit/chat-text';
import type { AttachmentsConfig, MentionsConfig, PastedText, SlashConfig } from './config';
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
export interface ComposerFeedback extends ChatSessionFeedback {
  /** The annotate toggle: arms targeting on the page (point mode on touch and compact screens), or stops it when it is on. */
  readonly annotate: () => void;
  /** Annotating is on: the toggle shows pressed. */
  readonly active: boolean;
  /** Notes taken and waiting to be sent with the next message; above zero, Send is allowed with no text. */
  readonly count: number;
  /** Removes the notes (the count chip's remove button). */
  readonly clear: () => void;

}

/** One file being uploaded (or that failed to upload), shown as a chip until it settles or is dismissed. */
export type { PendingUpload } from '@hachej/boring-ui-kit/chat-react';
import type { PendingUpload, ChatSessionFeedback } from '@hachej/boring-ui-kit/chat-react';

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
  /** Optional host context above the input. */
  readonly quote?: ReactNode;
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly attachments: readonly ComposerAttachment[];
  /** Host-owned content contributes to send readiness. */
  readonly hasFiles?: boolean;
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
  /** The phone camera sheet (`attachments.Camera`, from `pi-chat-attachments`). Without it there is no Take a photo entry. */
  readonly camera?: AttachmentsConfig['Camera'];
  readonly fileAccept: string;
  readonly onPickFiles: (files: readonly File[]) => void;
  readonly onKeyDown?: ((event: KeyboardEvent<HTMLTextAreaElement>) => void) | undefined;
  readonly textareaRef: Ref<HTMLTextAreaElement>;
  readonly placeholder?: string;
  /** Optional visual placeholder (for an inline icon); the textarea keeps its accessible label. */
  readonly placeholderContent?: ReactNode;
  /** While the `@` picker is open, mark the typed query (`@d-2`) as an inline token behind the text (`data-slot="composer-mention-query"`). */
  readonly markMentionQuery?: boolean;
  /** An optional host input editor; normal textarea/IME behavior is unchanged when omitted. */
  readonly input?: ReactNode;
  readonly renderInput?: ((input: { readonly text: string; readonly onText: (text: string) => void; readonly onCaret: (offset: number) => void; readonly onSend: () => void }) => ReactNode) | undefined;
  /** `card` (default): chips, then full-width text, then a row of controls, in the host's shadcn InputGroup. `pill` puts the text between
   * the controls on one row. `stacked` and `inline` are compatibility values that render as `card`. */
  readonly layout?: 'card' | 'pill' | 'stacked' | 'inline';
  /** Host controls (for example a voice button) as round buttons between the model pill and the send button. */
  readonly barEnd?: ReactNode;
  /** Host controls at the very left edge of the bar, before "+" (`PiChat`'s `composerStart`). */
  readonly start?: ReactNode;
  /** A control shown in place of Send while there is nothing to send (WhatsApp's microphone): Send comes back as soon as there is text or a file. */
  readonly whenEmpty?: ReactNode;
  /** An active capture replaces the editable input and ordinary controls with this one recording row. */
  readonly recording?: ReactNode;
  /** The optional Feedback button and chip. */
  readonly feedback?: ComposerFeedback | undefined;
}

/** The annotate toggle beside the "+" menu in both layouts. */
function AnnotateButton({ feedback, disabled }: { readonly feedback: ComposerFeedback; readonly disabled: boolean }) {
  const { labels } = useChatText();
  return <Toggle className="min-h-11 min-w-11" data-testid="composer-annotate" pressed={feedback.active} disabled={disabled}
    aria-label={labels.annotate} title={labels.annotateHint} onPressedChange={() => feedback.annotate()}>
    <MessageSquarePlusIcon data-icon="inline-start" aria-hidden="true" />
  </Toggle>;
}

/**
 * One chip above the text (a mention, an upload, an attachment or the notes count) as the host's shadcn Attachment. The remove
 * buttons keep a 44px touch target on coarse pointers; negative margins let it extend beyond the chip instead of growing it.
 */
function Chip({ media, image = false, label, actions, ...props }: ComponentProps<typeof Attachment> & { readonly media: ReactNode; readonly image?: boolean; readonly label: ReactNode; readonly actions?: ReactNode }) {
  return <Attachment size="xs" role="listitem" {...props}>
    <AttachmentMedia variant={image ? 'image' : 'icon'}>{media}</AttachmentMedia>
    <AttachmentContent><AttachmentTitle>{label}</AttachmentTitle></AttachmentContent>
    {actions && <AttachmentActions className="max-md:-my-2.5 pointer-coarse:-my-2.5">{actions}</AttachmentActions>}
  </Attachment>;
}

function RemoveChip({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return <AttachmentAction aria-label={label} title={label} onClick={onClick}><XIcon aria-hidden="true" /></AttachmentAction>;
}

/** The count chip: how many notes go with the next message, and a way to drop them. */
function NotesChip({ feedback }: { readonly feedback: ComposerFeedback }) {
  const { labels } = useChatText();
  return <Chip data-testid="feedback-count" data-count={feedback.count} media={<MessageSquarePlusIcon aria-hidden="true" />} label={labels.annotateNotes(feedback.count)}
    actions={<AttachmentAction data-testid="feedback-count-clear" aria-label={labels.annotateClear} title={labels.annotateClear} onClick={() => feedback.clear()}><XIcon aria-hidden="true" /></AttachmentAction>} />;
}

/** Whether a file input's `accept` admits a JPEG photo (empty admits everything). */
export function acceptsPhotos(accept: string): boolean {
  const tokens = accept.split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
  return tokens.length === 0 || tokens.some(token => token === 'image/*' || token === '*/*' || token === 'image/jpeg' || token === '.jpg' || token === '.jpeg');
}

/** True on a touch-first device (a phone or tablet); false on the server, so the menu renders the same there. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => globalThis.matchMedia?.('(pointer: coarse)').matches ?? false);
  useEffect(() => {
    const query = globalThis.matchMedia?.('(pointer: coarse)');
    if (!query) return;
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return coarse;
}

/** The "+" button and the host's shadcn dropdown menu (Attach files, Take a photo, Commands). */
function PlusActions({ disabled, onAttach, onTakePhoto, onCommands, textarea }: { readonly disabled: boolean; readonly onAttach?: (() => void) | undefined; readonly onTakePhoto?: (() => void) | undefined; readonly onCommands?: (() => void) | undefined; readonly textarea: { readonly current: HTMLTextAreaElement | null } }) {
  const { labels, icons } = useChatText();
  const [open, setOpen] = useState(false);
  // Commands puts `/` in the message: focus goes back to the text, not to the "+" button.
  const toText = useRef(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a menu left open when the composer gets disabled closes once, after commit
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />} data-testid="composer-plus" aria-label={labels.add} title={labels.add} disabled={disabled}>
      <icons.add data-icon="inline-start" aria-hidden="true" /></DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" aria-label={labels.add} data-testid="composer-plus-menu" className="w-52"
      finalFocus={() => { const text = toText.current; toText.current = false; return text ? textarea.current : true; }}>
      {onAttach && <DropdownMenuItem data-testid="composer-attach" onClick={onAttach} className="max-md:min-h-11 pointer-coarse:min-h-11">
        <icons.attach aria-hidden="true" />{labels.attachFiles}</DropdownMenuItem>}
      {onTakePhoto && <DropdownMenuItem data-testid="composer-take-photo" onClick={onTakePhoto} className="max-md:min-h-11 pointer-coarse:min-h-11">
        <icons.camera aria-hidden="true" />{labels.takePhoto}</DropdownMenuItem>}
      {onCommands && <DropdownMenuItem data-testid="composer-commands" onClick={() => { toText.current = true; onCommands(); }} className="max-md:min-h-11 pointer-coarse:min-h-11">
        <SlashIcon aria-hidden="true" />{labels.commands}</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Draws the text with `start..end` wrapped in a mark, at the textarea's exact font, padding and scroll, under its (transparent) background. */
function QueryBackdrop({ text, start, end }: { readonly text: string; readonly start: number; readonly end: number }) {
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = layer.current, field = node?.parentElement?.querySelector('textarea');
    if (!node || !field) return;
    const copy = () => {
      const style = getComputedStyle(field);
      for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'textIndent', 'wordSpacing'] as const) node.style[name] = style[name];
      node.style.top = `${field.offsetTop}px`; node.style.left = `${field.offsetLeft}px`; node.style.width = `${field.clientWidth}px`; node.style.height = `${field.clientHeight}px`;
      node.scrollTop = field.scrollTop;
    };
    copy();
    field.addEventListener('scroll', copy);
    return () => field.removeEventListener('scroll', copy);
  });
  return <div ref={layer} aria-hidden="true" data-slot="composer-mention-backdrop" className="pointer-events-none absolute overflow-hidden whitespace-pre-wrap break-words text-transparent">
    {text.slice(0, start)}<mark data-slot="composer-mention-query" className="bg-muted text-transparent">{text.slice(start, end)}</mark>{text.slice(end)}
  </div>;
}

const MAX_HEIGHT = 208;

/** Hands the textarea to the caller's ref, a callback or an object. */
function assignRef(ref: Ref<HTMLTextAreaElement>, element: HTMLTextAreaElement | null) {
  if (typeof ref === 'function') ref(element); else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = element;
}

/** Prompt composer: auto-growing textarea, Enter to send, one primary Send/Stop button. While the agent works a message is queued. */
export function Composer(props: ComposerProps) {
  const { attachments, working, sendBlocked, disabled, stopRequested, uploading, canAttach, layout = 'card' } = props;
  const draft = kindMentionDraft(props.text, props.mentions);
  const text = draft.text;
  const tokens = useRef(draft.tokens);
  useLayoutEffect(() => { tokens.current = draft.tokens; });
  // An asynchronous slash command must use today's tokens, not restore a chip removed since it began.
  const onText = (next: string) => props.onText(writeKindMentionDraft(next, tokens.current, props.slash?.skills?.map(skill => skill.name)));
  const { labels, icons } = useChatText();
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [caret, setCaret] = useState(0);
  // A menu closed with Escape stays closed until the text changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- new text re-arms a dismissed menu once, after commit; the updater keeps the value when nothing changed
  useEffect(() => { setDismissed(value => value === null || value === text ? value : null); }, [text]);
  const pendingCaret = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The camera sheet lives here, not in the menu: the menu content unmounts as soon as it closes.
  const [cameraOpen, setCameraOpen] = useState(false);
  const coarse = useCoarsePointer();
  // A feature shows only when its config carries the component that draws it (`pi-chat-slash`, `pi-chat-mentions`, `pi-chat-attachments`).
  const Camera = props.camera, Slash = props.slash?.Picker, Mention = props.mentions?.Picker;
  const canPhoto = canAttach && coarse && acceptsPhotos(props.fileAccept) && Camera !== undefined;
  const slash = Slash ? props.slash : undefined, mentions = Mention ? props.mentions : undefined;
  const items = useMemo<SlashItem[]>(() => slash ? slashItems(slash) : [], [slash]);
  const recording = Boolean(props.recording);
  const setRef = (element: HTMLTextAreaElement | null) => {
    inner.current = element;
    assignRef(props.textareaRef, element);
  };
  useLayoutEffect(() => {
    if (recording) return;
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
  }, [text, recording]);

  const query = slash && items.length ? slashQuery(text, caret) : null;
  const trigger = query === null && mentions ? mentionTrigger(text, caret) : null;
  const slashOpen = query !== null && dismissed !== text, mentionOpen = trigger !== null && dismissed !== text;
  const menuOpen = slashOpen || mentionOpen;
  const edit = (next: string, position: number) => { pendingCaret.current = position; setCaret(position); onText(next); };
  const trackCaret = (element: HTMLTextAreaElement) => setCaret(element.selectionStart ?? element.value.length);
  const dismiss = () => setDismissed(text);
  const pickSlash = (item: SlashItem) => {
    const rest = text.slice(caret).replace(/^\s+/, '');
    if (item.source === 'skill') return edit(`/${item.name} ${rest}`, item.name.length + 2);
    const command = slash?.commands?.find(candidate => candidate.name === item.name);
    onText(rest); setCaret(0);
    inner.current?.focus();
    if (!command) return;
    try { void Promise.resolve(command.run({ text: rest, setText: value => onText(value) })).catch(cause => props.onSlashError?.(cause)); }
    catch (cause) { props.onSlashError?.(cause); }
  };
  const pickMention = (path: string) => {
    if (!trigger) return;
    const token = `${mentionToken(path)} `;
    edit(`${text.slice(0, trigger.start)}${token}${text.slice(trigger.end)}`, trigger.start + token.length);
    props.onMentionPicked?.(path);
  };
  const openCommands = () => edit(`${text}${text && !/\s$/.test(text) ? ' ' : ''}/`, text.length + (text && !/\s$/.test(text) ? 2 : 1));
  const chips = [...new Set([...(props.mentionPaths ?? []), ...mentionedPaths(props.text).filter(path => mentionKind(path, props.mentions))])].filter(path => hasMention(props.text, path));
  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => { trackCaret(event.currentTarget); onText(event.currentTarget.value); };

  const { feedback } = props;
  const hasContent = props.text.trim().length > 0 || attachments.length > 0 || props.hasFiles || (feedback?.count ?? 0) > 0;
  const canSubmit = hasContent && !sendBlocked && !disabled && !props.recording;
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

  const chipList = (props.quote || chips.length > 0 || (props.uploads?.length ?? 0) > 0 || (feedback?.count ?? 0) > 0 || attachments.length > 0) && <>
    {props.quote}
    {feedback && feedback.count > 0 && <div role="list" className="contents"><NotesChip feedback={feedback} /></div>}
    {chips.length > 0 && <div role="list" data-testid="mention-chips" aria-label={labels.mentionedFiles} className="contents">
      {chips.map(path => {
        const registered = mentionKind(path, props.mentions);
        const label = registered ? registered.kind.label(registered.path) : props.mentions?.label?.(path) ?? path;
        return <Chip key={path} data-testid="mention-chip" data-path={path} title={label} className="max-w-full md:max-w-[16rem]"
          media={registered?.kind.icon ?? props.mentions?.icon ?? <FileTextIcon aria-hidden="true" />} label={registered?.kind.open ? <Button variant="link" size="sm" onClick={() => registered.kind.open?.(registered.path)} className="min-w-0 max-w-full justify-start truncate">{label}</Button> : label}
          actions={<RemoveChip label={labels.remove(label)} onClick={() => props.onText(removeMention(props.text, path))} />} />;
      })}
    </div>}
    {(props.uploads?.length ?? 0) > 0 && <div role="list" data-testid="uploads" aria-label={labels.uploads} className="contents">
      {props.uploads!.map(item => <Chip key={item.id} data-testid="upload-chip" state={item.state === 'failed' ? 'error' : 'uploading'} data-state={item.state} title={item.error ?? item.name} className="max-w-full md:max-w-[20rem]"
        media={item.state === 'failed' ? <AlertCircleIcon className="text-destructive" aria-hidden="true" /> : <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        label={item.state === 'failed' ? labels.uploadFailed(item.name, item.error) : labels.uploading(item.name)}
        actions={<>
          {item.cancel && <RemoveChip label={labels.restorePaste} onClick={() => item.cancel!()} />}
          {item.state === 'failed' && <RemoveChip label={labels.dismiss(item.name)} onClick={() => props.onDismissUpload?.(item.id)} />}
        </>} />)}
    </div>}
    {attachments.length > 0 && <div role="list" data-testid="attachments" aria-label={labels.attachments} className="contents">
      {attachments.map(attachment => {
        const src = thumbnail(attachment.mimeType, attachment.data);
        return <Chip key={attachment.id} data-testid="attachment" className="max-w-full md:max-w-[14rem]" image={!!src}
          media={src ? <img src={src} alt="" /> : <FileTextIcon aria-hidden="true" />} label={attachment.name}
          actions={<RemoveChip label={labels.remove(attachment.name)} onClick={() => props.onRemoveAttachment(attachment.id)} />} />;
      })}
    </div>}
  </>;
  const pill = layout === 'pill';
  const textareaEl = <InputGroupTextarea ref={setRef} data-testid="composer-input" aria-label={labels.messageInput} rows={1} value={text} disabled={disabled}
      placeholder={props.placeholderContent ? '' : props.placeholder ?? (working ? labels.placeholderWorking : labels.placeholder)}
      {...(slash || mentions ? { role: 'combobox', 'aria-expanded': menuOpen, 'aria-haspopup': 'listbox', 'aria-autocomplete': 'list' } as const : {})}
      onChange={onChange} onKeyDown={onKeyDown} onPaste={onPaste} onKeyUp={event => trackCaret(event.currentTarget)} onClick={event => trackCaret(event.currentTarget)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      className={cn(props.markMentionQuery && 'relative', pill ? 'max-h-52 min-h-0 min-w-0' : 'max-h-52 min-h-11')} />;
  // The query mark is a backdrop with the textarea's own metrics behind its transparent text: the text the person edits stays the textarea's.
  const marked = props.markMentionQuery && mentionOpen && trigger ? <QueryBackdrop text={text} start={trigger.start} end={trigger.end} /> : null;
  // eslint-disable-next-line react-hooks/refs -- renderInput receives event callbacks, not ref values; an input calls them only on interaction
  const input = props.renderInput?.({ text, onText, onCaret: setCaret, onSend: () => { if (canSubmit && !menuOpen) props.onSend(); } }) ?? props.input ?? (props.placeholderContent || marked ? <div data-slot="composer-field" className="relative flex min-h-16 w-full min-w-0 flex-1">{marked}{textareaEl}{!text && props.placeholderContent && <span aria-hidden="true" data-slot="composer-placeholder" className="pointer-events-none absolute inset-x-3 top-2 text-sm text-muted-foreground">{props.placeholderContent}</span>}</div> : textareaEl);
  const plus = (canAttach || items.length > 0) && <PlusActions disabled={disabled} textarea={inner} onAttach={canAttach ? () => fileInput.current?.click() : undefined} onTakePhoto={canPhoto ? () => setCameraOpen(true) : undefined} onCommands={items.length > 0 ? openCommands : undefined} />;
  // One child slot either way, so a composer without `start` keeps its exact markup (React ids included).
  const startAndPlus = props.start ? <><div data-testid="composer-start" className="flex shrink-0 items-center gap-1">{props.start}</div>{plus}</> : plus;
  const fileEl = canAttach && <Input ref={fileInput} type="file" multiple accept={props.fileAccept} disabled={disabled} tabIndex={-1} aria-hidden="true" className="sr-only" data-testid="composer-file" data-attach="true"
    onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; props.onPickFiles(files); }} />;
  const send = working
    ? <Button variant="default" size="icon" data-testid="composer-submit" data-state="stop" aria-label={labels.stop} title={labels.stop} disabled={disabled || stopRequested} onClick={props.onStop} className="shrink-0">
      {stopRequested ? <Loader2Icon data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <icons.stop data-icon="inline-start" aria-hidden="true" />}</Button>
    : props.whenEmpty && !hasContent ? <div data-testid="composer-when-empty" className="flex shrink-0 items-center">{props.whenEmpty}</div>
    : <Button variant="default" size="icon" type="submit" data-testid="composer-submit" data-state="send" aria-label={labels.send} title={labels.sendHint} disabled={!canSubmit} className="shrink-0">
      <icons.send data-icon="inline-start" aria-hidden="true" /></Button>;
  const end = <>
    {props.barStart}
    {props.chips && <div className="flex min-w-0 items-center gap-2">{props.chips}</div>}
    {props.barNote}
    {uploading && !(props.uploads?.length) && <span role="status" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2Icon className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />{labels.preparingAttachments}</span>}
    {!pill && <span className="min-w-0 flex-1" />}
    {props.barEnd && <div data-testid="composer-tools" className="flex min-w-0 items-center gap-2">{props.barEnd}</div>}
    {working && hasContent && <Button variant="ghost" size="icon" data-testid="composer-queue" aria-label={labels.queue} title={labels.queue} disabled={!canSubmit} onClick={props.onSend} className="shrink-0">
      <icons.queue data-icon="inline-start" aria-hidden="true" /></Button>}
    {send}
  </>;

  // One shadcn InputGroup: the chips, the text and a row of controls (`card`, also used for the `stacked` and `inline` compatibility
  // values), or one row with the text between the controls (`pill`, chips above it). Its look is the host's; ours is layout only.
  return <form data-testid="composer" data-layout={layout} data-dragging={dragging || undefined} onSubmit={event => { event.preventDefault(); if (canSubmit) props.onSend(); }} onDragOver={drag} onDragLeave={drag} onDrop={drop}
    className={cn('relative flex flex-col gap-2', pill && '@container/composer')}>
    {fileEl}
    {slashOpen && Slash && <Slash query={query!} items={items} onSelect={pickSlash} onDismiss={dismiss} />}
    {mentionOpen && mentions && Mention && <Mention query={trigger!.query} listLabel={mentions.listLabel} renderOption={mentions.renderOption} header={typeof mentions.pickerHeader === 'function' ? mentions.pickerHeader(trigger!.query) : mentions.pickerHeader} search={mentions.search} generation={mentions.generation} onSelect={pickMention} onDismiss={dismiss} />}
    {pill && !props.recording && chipList && <div className="flex flex-wrap gap-2">{chipList}</div>}
    {props.recording ? <InputGroup>
      {chipList && <InputGroupAddon align="block-start" className="flex-wrap">{chipList}</InputGroupAddon>}
      <InputGroupAddon align="block-end" data-testid="composer-controls" className="w-full">{props.recording}</InputGroupAddon>
    </InputGroup> : pill ? <InputGroup>
      <InputGroupAddon>{startAndPlus}{feedback && <AnnotateButton feedback={feedback} disabled={disabled} />}</InputGroupAddon>
      {input}
      <InputGroupAddon align="inline-end" data-testid="composer-controls">{end}</InputGroupAddon>
    </InputGroup> : <InputGroup>
      {chipList && <InputGroupAddon align="block-start" className="flex-wrap">{chipList}</InputGroupAddon>}
      {input}
      <InputGroupAddon align="block-end" data-testid="composer-controls">
        {startAndPlus}
        {feedback && <AnnotateButton feedback={feedback} disabled={disabled} />}
        {end}
      </InputGroupAddon>
    </InputGroup>}
    {cameraOpen && Camera && <Camera onClose={() => setCameraOpen(false)} onCapture={file => { setCameraOpen(false); props.onPickFiles([file]); }} />}
  </form>;
}

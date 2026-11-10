'use client';

// D-1978 slice 1: the agent bar (a pill with a history arrow, the field, the mic and send) and the status line that sits above it. Voice is the kit's:
// `useDictation` records and hands the audio to the app's `transcribe`, `useHoldToRecord` is the hold gesture and its cancel policy (slide off, Escape,
// blur, a hidden page). One tap on the mic listens (stop puts the text in the field, send sends it); a press held past TAP_MS talks and sends on release.
// Slice 2 (`question`, agent-question.tsx) puts a question card above the bar and swaps `placeholder` for « Ou réponds ici »; slice 4 feeds the words live (`stream`).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, ComponentType, DragEvent } from 'react';
import { useDictation, type DictationLabels } from '@hachej/boring-ui-kit/chat-react/voice';
import { slashItems, slashQuery } from '@hachej/boring-ui-kit/chat-text';
import type { SlashItem } from '@hachej/boring-ui-kit/chat-text';
import type { ChatAttachment } from '@hachej/boring-ui-kit/native-chat';
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CornerDownRightIcon, MicIcon, PaperclipIcon, SlashIcon, SquareIcon, XIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '../utils/utils';
import { useHoldToRecord } from '../pi-chat-voice/use-hold-to-record';
import type { AttachmentsConfig, SlashConfig } from '../pi-chat/config';
import { AttachmentChips, UploadChips } from '../_shared/attachment-chips';
import { useBarAttachments } from './use-bar-attachments';
import { AgentQuestion, agentQuestionLabels, type AgentQuestionData, type AgentQuestionLabels } from './agent-question';
import { useLiveDictation, type LiveStream } from './use-live-dictation';

export type { LiveSink, LiveSession, LiveStream } from './use-live-dictation';

export interface AgentBarLabels extends DictationLabels, AgentQuestionLabels {
  readonly placeholder: string;
  readonly history: string;
  readonly speak: string;
  readonly send: string;
  readonly cancel: string;
  readonly stop: string;
  readonly releaseToSend: string;
  readonly transcribing: string;
  readonly removeQuote: string;
  readonly working: string;
  /** `attachments`: the pick button's name, the chip lists' names and the chips' words. */
  readonly attachFiles: string;
  readonly attachments: string;
  readonly uploads: string;
  readonly uploading: (name: string) => string;
  readonly uploadFailed: (name: string, error?: string) => string;
  readonly uploadFailedShort: string;
  readonly dismiss: (name: string) => string;
  readonly remove: (name: string) => string;
  readonly restorePaste: string;
  /** `slash`: the Actions button's name (and its text on a wide bar). */
  readonly commands: string;
}

export const agentBarLabels: AgentBarLabels = {
  placeholder: 'Maintiens pour parler',
  history: 'Historique',
  speak: 'Parler',
  send: 'Envoyer',
  cancel: 'Annuler',
  stop: 'Arrêter',
  releaseToSend: 'Relâche pour envoyer',
  transcribing: 'Transcription…',
  removeQuote: 'Retirer la citation',
  working: 'En cours',
  attachFiles: 'Joindre des fichiers',
  attachments: 'Pièces jointes',
  uploads: 'Envois',
  uploading: name => `Envoi de ${name}…`,
  uploadFailed: (name, error) => `${name} : ${error ?? 'échec de l’envoi'}`,
  uploadFailedShort: 'L’envoi a échoué',
  dismiss: name => `Fermer ${name}`,
  remove: name => `Retirer ${name}`,
  restorePaste: 'Remettre le texte collé dans le message',
  commands: 'Actions',
  ...agentQuestionLabels,
  voiceDenied: 'Le micro est refusé. Autorise-le dans les réglages du navigateur.',
  voiceNoMicrophone: 'Aucun micro trouvé.',
  voiceBusy: 'Le micro est utilisé par une autre application.',
  voiceInsecure: 'Le micro demande une connexion sécurisée.',
  voiceUnsupported: 'Ce navigateur ne sait pas enregistrer.',
  voiceStartFailed: 'Le micro ne démarre pas.',
  voiceNothingHeard: 'Je n’ai rien entendu.',
  voiceTranscribeFailed: 'La transcription a échoué.',
};

export interface AgentBarSend {
  /** With `attachments`, the uploaded paths are mentioned at the end of the text (`@uploads/releve.pdf`), as PiChat sends them. */
  readonly text: string;
  readonly quoted?: string;
  /** Uploaded images, in the form a PiChat draft carries them. Only with `attachments`, and only when there are some. */
  readonly attachments?: readonly ChatAttachment[];
}
type BarIcon = ComponentType<{ readonly className?: string | undefined; readonly 'aria-hidden'?: boolean | 'true' | 'false' | undefined }>
export interface AgentBarProps {
  /** Called with the typed or spoken text, and the label of the quoted row when one is shown. The app clears the quote (`quoted.onClear`) if it wants to. */
  readonly onSend: (message: AgentBarSend) => void;
  /** The app's batch transcription of one recording. Not needed with `stream`. */
  readonly transcribe?: (audio: Blob) => Promise<string>;
  /** Live dictation: while listening the bar shows the words as they come (final words normal, not-yet-final words dimmed) and sends the final text on stop. Replaces `transcribe`. */
  readonly stream?: LiveStream;
  readonly quoted?: { readonly label: string; readonly onClear: () => void };
  /** Shows the history arrow; it flips with `historyOpen`. */
  readonly onHistory?: () => void;
  readonly historyOpen?: boolean;
  /** Puts an 8px dot (`bg-primary`) on the history arrow, e.g. while a question waits; `label` is its accessible name. */
  readonly historyBadge?: { readonly label: string };
  /** A question the agent asks, shown as a card above the bar. While it is open the field reads « Ou réponds ici » and text sent from the bar goes to `question.onAnswer({ text, source: 'bar' })`, not `onSend`. */
  readonly question?: AgentQuestionData;
  readonly placeholder?: string;
  /** Off by default. Same shape and meaning as PiChat's `chatProps.attachments`: with it the bar is a drop zone, a paste of files into the field uploads them and an attach button (`labels.attachFiles`) opens the picker. The chips (progress, error, remove) show above the field and the next `onSend` carries them. */
  readonly attachments?: AttachmentsConfig;
  /** Off by default. Like PiChat's `chatProps.slash` (`Picker` is `SlashPicker` of `pi-chat-slash`): typing `/` opens the commands list, and an Actions button (`labels.commands`) opens it too; choosing a command runs it and fills the bar. */
  readonly slash?: SlashConfig;
  /** Overrides the pick button's and the Actions button's icon. */
  readonly icons?: { readonly attach?: BarIcon; readonly commands?: BarIcon };
  /** Not-yet-final words, shown dimmed after the final transcript above the bar (live partials arrive in a later slice). */
  readonly partial?: string;
  readonly labels?: Partial<AgentBarLabels>;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** A press shorter than this is a tap (listening); longer is a hold (release sends). */
const TAP_MS = 300;
const BARS = 20;
// The block restyles only its own parts: they carry `data-agent-bar`, which its CSS targets, so shadcn's Button and Input look is never touched elsewhere (BORING-UI-1).
type Mode = 'idle' | 'press' | 'listening' | 'holding';

function Wave({ levels }: { readonly levels: readonly number[] }) {
  const tail = levels.slice(-BARS);
  return <div aria-hidden="true" data-testid="agent-bar-wave" className="flex h-6 min-w-0 flex-1 items-center justify-center gap-0.5">
    {Array.from({ length: BARS }, (_, index) => {
      const level = tail[index - (BARS - tail.length)] ?? 0;
      const loud = level > 0.04;
      return <span key={index} className={cn('w-0.5 shrink-0 rounded-(--radius-sm)', loud ? 'bg-primary' : 'bg-muted-foreground/40')} style={{ height: loud ? `${Math.min(100, 20 + level * 400)}%` : '12%' }} />;
    })}
  </div>;
}

export function AgentBar({ onSend, transcribe, stream, quoted, question, onHistory, historyOpen = false, historyBadge, placeholder, attachments, slash, icons, partial, labels, disabled = false, className }: AgentBarProps) {
  const words = { ...agentBarLabels, ...labels };
  const [text, setText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const pressedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sendOnText = useRef(false);
  // A stop asked before the microphone is open (the kit's `finish` would cancel then) waits for the recording to begin.
  const stopAsked = useRef(false);
  const field = useRef('');
  const root = useRef<HTMLDivElement>(null);
  // Set while listening; the next rest gives the focus back to the field (a tap on the mic unmounts the focused element).
  const fromListen = useRef(false);
  const quote = useRef(quoted?.label);
  const asked = useRef(question);
  useLayoutEffect(() => { field.current = text; quote.current = quoted?.label; asked.current = question; filesRef.current = files; });
  const hint = question ? words.answerHere : (placeholder ?? words.placeholder);
  const files = useBarAttachments(attachments, words.uploadFailedShort);
  const filesRef = useRef(files);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // The commands list: `/` typed in the field, or the Actions button. Esc or a pick closes it; the text it was dismissed on keeps it closed.
  const Slash = slash?.Picker;
  const items = useMemo<SlashItem[]>(() => slash && Slash ? slashItems(slash) : [], [slash, Slash]);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const deliver = (body: string) => {
    const clean = body.trim();
    const bundle = filesRef.current;
    if (!clean && (asked.current || bundle.count === 0)) return;
    if (asked.current) asked.current.onAnswer({ text: clean, source: 'bar' });
    else {
      const sendable = bundle.compose(clean);
      onSend({ text: sendable.text, ...(quote.current === undefined ? {} : { quoted: quote.current }), ...(sendable.attachments.length ? { attachments: sendable.attachments } : {}) });
      bundle.clear();
    }
    setText(''); setTranscript('');
  };
  const onText = (spoken: string) => {
    if (sendOnText.current) { sendOnText.current = false; deliver([field.current, spoken].filter(Boolean).join(' ')); return; }
    setTranscript(spoken); setText(current => [current, spoken].filter(Boolean).join(' '));
  };
  // Both hooks always run (hook order); with a `stream` the batch one has no transcriber and never starts.
  const batch = useDictation({ transcribe: stream || !transcribe ? undefined : audio => transcribe(audio), labels: words, onText });
  const live = useLiveDictation({ stream, labels: words, onText });
  const dictation = stream ? live : batch;
  // The attempt ended on its own (refused microphone, Escape, blur, the time limit): the bar is at rest again.
  const before = useRef(dictation.phase);
  useEffect(() => {
    if (before.current !== 'idle' && dictation.phase === 'idle') { clearTimeout(timer.current); setMode('idle'); }
    before.current = dictation.phase;
  }, [dictation.phase]);
  useEffect(() => {
    if (dictation.phase === 'recording' && stopAsked.current) { stopAsked.current = false; dictation.finish(); }
    if (dictation.phase === 'idle') stopAsked.current = false;
  }, [dictation.phase, dictation]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const stopListening = (send: boolean) => {
    clearTimeout(timer.current); sendOnText.current = send; setMode('idle');
    if (dictation.phase === 'starting') stopAsked.current = true; else dictation.finish();
  };
  const abandon = () => { stopAsked.current = false; clearTimeout(timer.current); sendOnText.current = false; setMode('idle'); dictation.cancel(); };
  const hold = useHoldToRecord({
    start: () => {
      pressedAt.current = Date.now(); setMode('press'); setTranscript('');
      clearTimeout(timer.current); timer.current = setTimeout(() => setMode('holding'), TAP_MS);
      dictation.start();
    },
    finish: () => {
      // The attempt already ended (a refused microphone): nothing is listening and nothing is sent.
      if (dictation.phase === 'idle') { clearTimeout(timer.current); sendOnText.current = false; setMode('idle'); return; }
      if (Date.now() - pressedAt.current < TAP_MS) { clearTimeout(timer.current); setMode('listening'); return; }
      stopListening(true);
    },
    cancel: abandon,
  }, disabled, { pressBounds: true });
  // The kit hook guards touchstart only on the mic node it first saw; this one remounts after each recording, so bind the node it has now.
  useEffect(() => {
    const node = hold.ref.current;
    const keep = (event: Event) => { if (event.cancelable) event.preventDefault(); };
    node?.addEventListener('touchstart', keep, { passive: false });
    return () => node?.removeEventListener('touchstart', keep);
  });

  const busy = mode === 'idle' && dictation.phase !== 'idle';
  const state = mode === 'holding' ? 'holding' : mode === 'listening' ? 'listening' : busy ? 'transcribing' : 'rest';
  const outlined = state === 'listening' || state === 'holding' || quoted !== undefined;
  const canSend = state === 'rest' ? (text.trim().length > 0 || (!question && files.count > 0)) && !files.uploading : state !== 'transcribing';
  useEffect(() => {
    if (state === 'listening') { fromListen.current = true; root.current?.querySelector<HTMLElement>('[data-testid="agent-bar-stop"]')?.focus(); }
    else if (state === 'rest' && fromListen.current) { fromListen.current = false; root.current?.querySelector<HTMLElement>('[data-slot="input"]')?.focus(); }
  }, [state]);
  // While the audio is being transcribed, Escape abandons it like ✕ does (the kit's own Escape covers only recording).
  useEffect(() => {
    if (state !== 'transcribing') return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') abandon(); };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  });
  const lead = live.final || transcript;
  const dim = [live.interim, partial].filter(Boolean).join(' ');
  const shown = lead || dim ? <p data-testid="agent-bar-transcript" className="px-3 text-sm text-foreground italic">{lead}{dim ? <span className="text-muted-foreground">{lead ? ' ' : ''}{dim}</span> : null}</p> : null;
  const submit = () => {
    if (state === 'listening') { stopListening(true); return; }
    if (canSend) deliver(text);
  };

  const query = items.length ? slashQuery(text, caret) : null;
  const slashOpen = query !== null && dismissed !== text && state === 'rest';
  const edit = (next: string) => { setText(next); setTranscript(''); setCaret(next.length); };
  const focusField = () => root.current?.querySelector<HTMLElement>('[data-slot="input"]')?.focus();
  const pickSlash = (item: SlashItem) => {
    const rest = text.slice(caret).replace(/^\s+/, '');
    if (item.source === 'skill') { edit(`/${item.name} ${rest}`); focusField(); return; }
    const command = slash?.commands?.find(candidate => candidate.name === item.name);
    edit(rest); focusField();
    if (command) void Promise.resolve(command.run({ text: rest, setText: value => edit(value) })).catch(() => undefined);
  };
  const openCommands = () => { setDismissed(null); edit(`${text}${text && !/\s$/.test(text) ? ' ' : ''}/`); focusField(); };
  const droppable = attachments !== undefined && !disabled;
  const pick = (picked: readonly File[]) => { void files.add(picked); };
  const drag = (event: DragEvent) => { if (!droppable) return; event.preventDefault(); setDragging(event.type === 'dragover'); };
  const dropFiles = (event: DragEvent) => { if (!droppable) return; event.preventDefault(); setDragging(false); pick(Array.from(event.dataTransfer.files)); };
  const pasteFiles = (event: ClipboardEvent) => { if (droppable && event.clipboardData.files.length) { event.preventDefault(); pick(Array.from(event.clipboardData.files)); } };
  const AttachIcon = icons?.attach ?? PaperclipIcon, CommandsIcon = icons?.commands ?? SlashIcon;
  const chipList = files.pending.length > 0 || files.chips.length > 0
    ? <div data-testid="agent-bar-chips" className="flex flex-wrap gap-2 px-1"><UploadChips items={files.pending} words={words} onDismiss={files.dismiss} /><AttachmentChips items={files.chips} words={words} onRemove={files.remove} /></div> : null;

  return <div ref={root} data-slot="agent-bar" data-dragging={dragging || undefined} className={cn('mx-auto flex w-full max-w-xl flex-col gap-2', (slash && Slash) && 'relative', className)}
    {...(attachments ? { onDragOver: drag, onDragLeave: drag, onDrop: dropFiles } : {})}>
    {slashOpen && Slash ? <Slash query={query!} items={items} onSelect={pickSlash} onDismiss={() => setDismissed(text)} /> : null}
    {question ? <AgentQuestion key={`${question.step ?? ''}|${question.title}`} question={question} labels={words} /> : null}
    {shown}
    {dictation.problem ? <p role="alert" className="px-3 text-sm text-destructive">{dictation.problem}</p> : null}
    {quoted ? <div data-testid="agent-bar-quoted" className="flex items-center gap-1 rounded-(--radius-xl) bg-primary/10 py-0.5 pr-0.5 pl-3 text-sm font-semibold text-primary">
      <CornerDownRightIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{quoted.label}</span>
      <Button type="button" variant="ghost" size="icon" data-agent-bar="" aria-label={words.removeQuote} onClick={quoted.onClear}><XIcon /></Button>
    </div> : null}
    {chipList}
    <div data-testid="agent-bar" data-state={state} className={cn('flex items-center gap-1.5 rounded-(--radius-3xl) bg-card p-1.5 ring-1 ring-border has-focus-visible:ring-2 has-focus-visible:ring-ring', (outlined || dragging) && 'ring-2 ring-primary')}>
      {state === 'listening' ? <>
        <Button key="cancel" type="button" variant="secondary" size="icon" data-agent-bar="" aria-label={words.cancel} onClick={abandon}><XIcon /></Button>
        <Wave levels={dictation.levels} />
        <Button key="stop" type="button" variant="secondary" size="icon" data-agent-bar="" aria-label={words.stop} data-testid="agent-bar-stop" onClick={() => stopListening(false)}><SquareIcon /></Button>
      </> : <>
        {/* Keyed so the stop button of the listening layout is never the mic node reused (its touchstart guard would swallow the tap). One flat list from rest to hold: the pressed mic must stay mounted, or the browser never delivers its pointer-up. */}
        {onHistory && state !== 'holding' ? <span className="relative inline-flex"><Button type="button" variant="secondary" size="icon" data-agent-bar="" aria-label={words.history} aria-expanded={historyOpen} onClick={onHistory}>{historyOpen ? <ChevronDownIcon /> : <ChevronUpIcon />}</Button>{historyBadge ? <span role="img" aria-label={historyBadge.label} data-testid="agent-bar-history-badge" className="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" /> : null}</span> : null}
        {attachments && state === 'rest' ? <Button type="button" variant="secondary" size="icon" data-agent-bar="" data-testid="agent-bar-attach" aria-label={words.attachFiles} title={words.attachFiles} disabled={disabled} onClick={() => fileInput.current?.click()}><AttachIcon aria-hidden="true" /></Button> : null}
        {state === 'holding'
          ? <div className="flex min-w-0 flex-1 items-center gap-2 px-2"><span data-testid="agent-bar-hold-label" className="min-w-0 truncate text-sm font-medium">{words.releaseToSend}</span><Wave levels={dictation.levels} /></div>
          : state === 'transcribing'
            ? <>
              <Button key="cancel" type="button" variant="secondary" size="icon" data-agent-bar="" aria-label={words.cancel} onClick={abandon}><XIcon /></Button>
              <span className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm text-muted-foreground"><span className="text-primary"><Spinner aria-label={words.transcribing} /></span>{words.transcribing}</span>
            </>
            : <Input data-testid="agent-bar-input" value={text} disabled={disabled} placeholder={hint} aria-label={hint}
                data-agent-bar="" className="min-w-0 flex-1" enterKeyHint="send"
                onChange={event => { setText(event.target.value); setTranscript(''); setCaret(event.target.selectionStart ?? event.target.value.length); }}
                onKeyUp={event => setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)} onClick={event => setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
                onPaste={pasteFiles}
                {...(slash && Slash ? { role: 'combobox', 'aria-expanded': slashOpen, 'aria-haspopup': 'listbox', 'aria-autocomplete': 'list' } as const : {})}
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (!slashOpen) submit(); } }} />}
        {items.length > 0 && state === 'rest' ? <Button type="button" variant="secondary" size="icon" data-agent-bar="" data-testid="agent-bar-actions" aria-label={words.commands} title={words.commands} disabled={disabled} onClick={openCommands} className="sm:w-auto sm:px-3"><CommandsIcon aria-hidden="true" /><span className="max-sm:hidden">{words.commands}</span></Button> : null}
        {state !== 'transcribing' ? <Button key="mic" type="button" variant="secondary" size="icon" data-testid="agent-bar-mic" data-held={state === 'holding' ? '' : undefined} data-agent-bar="" className={cn('touch-none select-none', state === 'holding' && 'order-first')} aria-label={words.speak} disabled={disabled} {...hold}>{state === 'holding' ? <SquareIcon /> : <MicIcon />}</Button> : null}
      </>}
      {attachments ? <Input ref={fileInput} type="file" multiple accept={attachments.accept} disabled={disabled} tabIndex={-1} aria-hidden="true" className="sr-only" data-testid="agent-bar-file"
        onChange={event => { pick(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} /> : null}
      <Button type="button" size="icon" data-agent-bar="" aria-label={words.send} disabled={disabled || !canSend || state === 'holding'} onClick={submit}><ArrowUpIcon /></Button>
    </div>
  </div>;
}

export interface AgentStatusProps {
  readonly state: 'working' | 'done';
  readonly text: string;
  /** Shown as « Annuler » while working only. */
  readonly onCancel?: () => void;
  readonly labels?: Partial<Pick<AgentBarLabels, 'cancel' | 'working'>>;
  readonly className?: string;
}

/** One line above the bar for background agent work: a spinner and the sentence while working, a check and the result when done. */
export function AgentStatus({ state, text, onCancel, labels, className }: AgentStatusProps) {
  const words = { ...agentBarLabels, ...labels };
  return <div data-testid="agent-status" data-state={state} role="status" className={cn('mx-auto flex min-h-11 w-full max-w-xl items-center gap-2 text-sm', className)}>
    {state === 'working'
      ? <span className="text-primary"><Spinner data-testid="agent-status-spinner" aria-label={words.working} /></span>
      : <span data-testid="agent-status-check" className="flex size-4 shrink-0 items-center justify-center rounded-(--radius-3xl) bg-primary text-primary-foreground"><CheckIcon className="size-2.5" aria-hidden="true" /></span>}
    <span className="min-w-0 flex-1 truncate">{text}</span>
    {state === 'working' && onCancel ? <Button type="button" variant="link" onClick={onCancel}>{words.cancel}</Button> : null}
  </div>;
}

export { AgentQuestion, agentQuestionLabels, type AgentAnswer, type AgentQuestionData, type AgentQuestionLabels, type AgentQuestionProps } from './agent-question';

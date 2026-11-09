'use client';

// D-1978 slice 1: the agent bar (a pill with a history arrow, the field, the mic and send) and the status line that sits above it. Voice is the kit's:
// `useDictation` records and hands the audio to the app's `transcribe`, `useHoldToRecord` is the hold gesture and its cancel policy (slide off, Escape,
// blur, a hidden page). One tap on the mic listens (stop puts the text in the field, send sends it); a press held past TAP_MS talks and sends on release.
// Slice 2 puts a question card above the bar and swaps `placeholder` for « Ou réponds ici »; slice 4 feeds `partial` live. Neither is built here.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDictation, type DictationLabels } from '@hachej/boring-ui-kit/chat-react/voice';
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CornerDownRightIcon, MicIcon, SquareIcon, XIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '../utils/utils';
import { useHoldToRecord } from '../pi-chat-voice/use-hold-to-record';

export interface AgentBarLabels extends DictationLabels {
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
  voiceDenied: 'Le micro est refusé. Autorise-le dans les réglages du navigateur.',
  voiceNoMicrophone: 'Aucun micro trouvé.',
  voiceBusy: 'Le micro est utilisé par une autre application.',
  voiceInsecure: 'Le micro demande une connexion sécurisée.',
  voiceUnsupported: 'Ce navigateur ne sait pas enregistrer.',
  voiceStartFailed: 'Le micro ne démarre pas.',
  voiceNothingHeard: 'Je n’ai rien entendu.',
  voiceTranscribeFailed: 'La transcription a échoué.',
};

export interface AgentBarSend { readonly text: string; readonly quoted?: string }
export interface AgentBarProps {
  /** Called with the typed or spoken text, and the label of the quoted row when one is shown. The app clears the quote (`quoted.onClear`) if it wants to. */
  readonly onSend: (message: AgentBarSend) => void;
  /** The app's batch transcription of one recording. */
  readonly transcribe: (audio: Blob) => Promise<string>;
  readonly quoted?: { readonly label: string; readonly onClear: () => void };
  /** Shows the history arrow; it flips with `historyOpen`. */
  readonly onHistory?: () => void;
  readonly historyOpen?: boolean;
  readonly placeholder?: string;
  /** Not-yet-final words, shown dimmed after the final transcript above the bar (live partials arrive in a later slice). */
  readonly partial?: string;
  readonly labels?: Partial<AgentBarLabels>;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** A press shorter than this is a tap (listening); longer is a hold (release sends). */
const TAP_MS = 300;
const BARS = 20;
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

export function AgentBar({ onSend, transcribe, quoted, onHistory, historyOpen = false, placeholder, partial, labels, disabled = false, className }: AgentBarProps) {
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
  const quote = useRef(quoted?.label);
  useLayoutEffect(() => { field.current = text; quote.current = quoted?.label; });

  const deliver = (body: string) => {
    const clean = body.trim();
    if (!clean) return;
    onSend(quote.current === undefined ? { text: clean } : { text: clean, quoted: quote.current });
    setText(''); setTranscript('');
  };
  const dictation = useDictation({
    transcribe: audio => transcribe(audio),
    labels: words,
    onText: spoken => {
      if (sendOnText.current) { sendOnText.current = false; deliver([field.current, spoken].filter(Boolean).join(' ')); return; }
      setTranscript(spoken); setText(current => [current, spoken].filter(Boolean).join(' '));
    },
  });
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
      if (Date.now() - pressedAt.current < TAP_MS) { clearTimeout(timer.current); setMode('listening'); return; }
      stopListening(true);
    },
    cancel: abandon,
  }, disabled);
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
  const canSend = state === 'rest' ? text.trim().length > 0 : state !== 'transcribing';
  const shown = transcript || partial ? <p data-testid="agent-bar-transcript" className="px-3 text-sm text-foreground italic">{transcript}{partial ? <span className="text-muted-foreground">{transcript ? ' ' : ''}{partial}</span> : null}</p> : null;
  const submit = () => {
    if (state === 'listening') { stopListening(true); return; }
    if (canSend) deliver(text);
  };

  return <div data-slot="agent-bar" className={cn('mx-auto flex w-full max-w-xl flex-col gap-2', className)}>
    {shown}
    {dictation.problem ? <p role="alert" className="px-3 text-sm text-destructive">{dictation.problem}</p> : null}
    {quoted ? <div data-testid="agent-bar-quoted" className="flex items-center gap-1 rounded-(--radius-xl) bg-primary/10 py-0.5 pr-0.5 pl-3 text-sm font-semibold text-primary">
      <CornerDownRightIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{quoted.label}</span>
      <Button type="button" variant="ghost" size="icon" aria-label={words.removeQuote} onClick={quoted.onClear}><XIcon /></Button>
    </div> : null}
    <div data-testid="agent-bar" data-state={state} className={cn('flex items-center gap-1.5 rounded-(--radius-3xl) bg-card p-1.5 ring-1 ring-border has-focus-visible:ring-2 has-focus-visible:ring-ring', outlined && 'ring-2 ring-primary')}>
      {state === 'listening' ? <>
        <Button key="cancel" type="button" variant="secondary" size="icon" aria-label={words.cancel} onClick={abandon}><XIcon /></Button>
        <Wave levels={dictation.levels} />
        <Button key="stop" type="button" variant="secondary" size="icon" aria-label={words.stop} onClick={() => stopListening(false)}><SquareIcon /></Button>
      </> : <>
        {/* Keyed so the stop button of the listening layout is never the mic node reused (its touchstart guard would swallow the tap). One flat list from rest to hold: the pressed mic must stay mounted, or the browser never delivers its pointer-up. */}
        {onHistory && state !== 'holding' ? <Button type="button" variant="secondary" size="icon" aria-label={words.history} aria-expanded={historyOpen} onClick={onHistory}>{historyOpen ? <ChevronDownIcon /> : <ChevronUpIcon />}</Button> : null}
        {state === 'holding'
          ? <div className="flex min-w-0 flex-1 items-center gap-2 px-2"><span data-testid="agent-bar-hold-label" className="min-w-0 truncate text-sm font-medium">{words.releaseToSend}</span><Wave levels={dictation.levels} /></div>
          : state === 'transcribing'
            ? <span className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm text-muted-foreground"><span className="text-primary"><Spinner aria-label={words.transcribing} /></span>{words.transcribing}</span>
            : <Input data-testid="agent-bar-input" value={text} disabled={disabled} placeholder={placeholder ?? words.placeholder} aria-label={placeholder ?? words.placeholder}
                className="min-w-0 flex-1" enterKeyHint="send"
                onChange={event => { setText(event.target.value); setTranscript(''); }}
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />}
        {state !== 'transcribing' ? <Button key="mic" type="button" variant="secondary" size="icon" data-testid="agent-bar-mic" data-held={state === 'holding' ? '' : undefined} className={cn('touch-none select-none', state === 'holding' && 'order-first')} aria-label={words.speak} disabled={disabled} {...hold}>{state === 'holding' ? <SquareIcon /> : <MicIcon />}</Button> : null}
      </>}
      <Button type="button" size="icon" aria-label={words.send} disabled={disabled || !canSend || state === 'holding'} onClick={submit}><ArrowUpIcon /></Button>
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

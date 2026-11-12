'use client';

// `composer: 'bar'`'s own pieces: the microphone's tap or hold, the conversation's chevron, the folded card on the field, its send problem, the box.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, FileTextIcon, Loader2Icon, MicIcon, SquareIcon, XIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { MENTION_TOKEN } from '@hachej/boring-ui-kit/chat-text';
import { useHoldToRecord } from '../pi-chat-voice/use-hold-to-record';
import { voiceClock } from '../pi-chat/config';
import { VoiceMessageButton } from '../pi-chat-voice/voice-message';
import { cn } from '../utils/utils';
import type { AgentBarChat } from '../agent-bar/use-agent-bar-chat';
import { composerLabels, shellWords, useInternal } from './layer-context';

/** Tap to start; while active, this same control is the composer's replacement recording row. In the bar it stands in Send's place, named « Dicter ». */
export function TalkButton({ label, primary = false }: { readonly label?: string; readonly primary?: boolean }) {
  const { voice } = useInternal();
  const busy = voice.phase === 'transcribing';
  return <VoiceMessageButton testId="agent-talk" primary={primary} {...(label ? { label } : {})} disabled={busy || (voice.phase === 'idle' && voice.canStart === false)} voice={{
    ...voice, phase: busy ? 'processing' : voice.phase, canStart: voice.canStart !== false,
    pending: voice.pending ?? [], captureSequence: voice.captureSequence ?? 0,
  }} />;
}

/** A press shorter than this is a tap (listen until ■); longer is a hold (release sends). */
const HOLD_SEND_MS = 300;
type MicMode = 'idle' | 'press' | 'listening' | 'holding';
interface BarMic { readonly mode: MicMode; readonly hold: ReturnType<typeof useHoldToRecord>; readonly finish: () => void; readonly cancel: () => void }

/** `composer: 'bar'` (D5, AC-10, AC-11): one microphone for tap and hold, as the agent bar. A tap listens until ■ and leaves the words in the field;
 * a press held past 300 ms says « Relâche pour envoyer » and release sends; a slide off, Échap or a hidden page cancels and sends nothing. */
export function useBarMic(): BarMic {
  const { voice, holdSend: holdSendRef } = useInternal();
  const [mode, setMode] = useState<MicMode>('idle');
  const pressedAt = useRef(0);
  const releasedEarly = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const capturing = voice.phase === 'starting' || voice.phase === 'recording';
  const cancel = useCallback(() => { clearTimeout(timer.current); releasedEarly.current = false; holdSendRef.current = false; setMode('idle'); voice.cancel(); }, [voice, holdSendRef]);
  const finish = useCallback(() => { clearTimeout(timer.current); setMode('idle'); voice.finish(); }, [voice]);
  // A hold released while the microphone is still opening (the first open of a session takes longer than the hold: permission, device start) is not a cancel:
  // the release is kept and the words are sent the moment the recording begins, as for any later hold (K-6).
  useEffect(() => {
    if (!releasedEarly.current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the release was kept in a ref; the phase change that ends the opening is what finishes the hold (finish sets the mode back to idle)
    if (voice.phase === 'recording') { releasedEarly.current = false; holdSendRef.current = true; finish(); }
    else if (voice.phase === 'idle') { releasedEarly.current = false; holdSendRef.current = false; }
  }, [voice.phase, finish, holdSendRef]);
  const hold = useHoldToRecord({
    start: () => {
      if (voice.canStart === false) return;
      pressedAt.current = Date.now(); holdSendRef.current = false; setMode('press');
      clearTimeout(timer.current); timer.current = setTimeout(() => setMode('holding'), HOLD_SEND_MS);
      voice.start();
    },
    finish: () => {
      clearTimeout(timer.current);
      // The attempt already ended (a refused microphone): nothing listens, nothing is sent.
      if (!capturing) { setMode('idle'); return; }
      if (Date.now() - pressedAt.current < HOLD_SEND_MS) { setMode('listening'); return; }
      if (voice.phase === 'starting') { releasedEarly.current = true; return; }
      holdSendRef.current = true; finish();
    },
    cancel,
  }, voice.phase === 'transcribing', { pressBounds: true });
  // The mode only means something while the microphone is open.
  return { mode: capturing ? mode : 'idle', hold, finish, cancel };
}

/** The action button's place: « Dicter » at rest and during a hold (the pressed button stays mounted, or the browser never delivers its release), ■ while a tap listens. */
export function BarMicButton({ mic, label }: { readonly mic: BarMic; readonly label: string }) {
  const layer = useInternal();
  const labels = composerLabels(layer.locale, layer.agent);
  const { ref, ...gesture } = mic.hold;
  // The kit hook guards touchstart only on the node it first saw; the microphone remounts after ■, so bind the node it has now.
  useEffect(() => {
    const node = ref.current;
    const keep = (event: Event) => { if (event.cancelable) event.preventDefault(); };
    node?.addEventListener('touchstart', keep, { passive: false });
    return () => node?.removeEventListener('touchstart', keep);
  });
  if (mic.mode === 'listening') return <Button key="stop" type="button" size="icon" data-testid="agent-talk-stop" aria-label={labels.voiceStop} title={labels.voiceStop} onClick={mic.finish} disabled={layer.voice.phase === 'starting'} className="shrink-0"><SquareIcon data-icon="inline-start" aria-hidden="true" /></Button>;
  const busy = layer.voice.phase === 'transcribing';
  return <Button key="mic" ref={ref} type="button" size="icon" data-testid="agent-talk" data-state={mic.mode === 'holding' ? 'holding' : layer.voice.phase} aria-label={label} title={label}
    disabled={busy || (layer.voice.phase === 'idle' && layer.voice.canStart === false)} className="shrink-0 touch-none select-none" {...gesture}>
    {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : mic.mode === 'holding' ? <SquareIcon data-icon="inline-start" aria-hidden="true" /> : <MicIcon data-icon="inline-start" aria-hidden="true" />}</Button>;
}

/** In the text's place while the microphone is open: ✕ (cancel) and the level, with « J’écoute… », or « Relâche pour envoyer » during a hold. */
export function BarMicStatus({ mic }: { readonly mic: BarMic }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const labels = composerLabels(layer.locale, layer.agent);
  const { voice } = layer;
  const holding = mic.mode === 'holding';
  return <div data-testid="agent-talk-status" data-state={holding ? 'holding' : 'listening'} className="flex w-full min-w-0 items-center gap-2">
    {!holding && <Button type="button" variant="secondary" size="icon" data-testid="agent-talk-cancel" aria-label={labels.voiceCancel} title={labels.voiceCancel} onClick={mic.cancel} className="shrink-0"><XIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    <span role="status" aria-live="polite" data-testid={holding ? 'agent-talk-release' : 'agent-talk-listening'} className="min-w-0 shrink-0 truncate text-muted-foreground">{holding ? text.releaseToSend : text.listening}</span>
    <span className="shrink-0 tabular-nums text-muted-foreground">{voiceClock(voice.seconds)}</span>
    {voice.levels.length > 0 && <div data-testid="agent-talk-wave" aria-hidden="true" className="flex h-6 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden">
      {voice.levels.map((level, index) => <span key={index} className="w-1 shrink-0 bg-muted-foreground" style={{ height: `${Math.max(5, Math.sqrt(Math.min(1, level)) * 100)}%` }} />)}
    </div>}
  </div>;
}

/** What went wrong with the microphone, in the flow under the title row (never over the messages). */
export function VoiceProblem() {
  const { voice } = useInternal();
  return voice.problem ? <p role="alert" data-testid="agent-voice-problem" className="m-0 shrink-0 px-3 pb-1 text-xs leading-4 text-destructive">{voice.problem}</p> : null;
}

/** `composer: 'bar'`: the chevron at the start of the field. It unfolds the conversation above the field and folds it back; a dot while a reply is unread. */
export function ConversationChevron({ unread }: { readonly unread: { readonly label: string } | undefined }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const open = layer.expanded ? layer.trayOpen || layer.dockOpen : layer.snap === 'half' || layer.snap === 'full';
  return <span className="relative inline-flex shrink-0">
    <Button type="button" variant="secondary" size="icon" data-testid="agent-bar-conversation" aria-label={text.conversation} title={text.conversation} aria-expanded={open}
      onClick={() => { if (open) layer.close(); else layer.open('agent'); }}>{open ? <ChevronDownIcon data-icon="inline-start" aria-hidden="true" /> : <ChevronUpIcon data-icon="inline-start" aria-hidden="true" />}</Button>
    {unread && <span role="img" aria-label={unread.label} data-testid="agent-bar-unread" className="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-(--radius-3xl) bg-primary" />}
  </span>;
}

/**
 * `composer: 'bar'`, folded: one card joined to the top of the field, at its width. While the agent works its header is what the running tool does;
 * a question shows its choices (a form, each question in turn); a reply that came while folded shows « ✓ Terminé · <what it used> », three lines
 * and the files it cites. Nothing floats over the page: the card is in the column's flow, above the field.
 */
/** A reply's text as a person reads it: a mention (`@uploads/ecarts.csv`) shows as the file's name. */
const readable = (text: string) => text.replace(MENTION_TOKEN, (_match, before: string, quoted: string | undefined, bare: string | undefined) => {
  const trail = quoted === undefined ? (bare ?? '').match(/[.,;:!?)\]}'"]+$/)?.[0] ?? '' : '';
  const path = quoted ?? (bare ?? '').slice(0, (bare ?? '').length - trail.length);
  return `${before}${path.split('/').at(-1) ?? path}${trail}`;
});

/** AC-12, folded: a send that failed says so on one line at the top of the box, with Réessayer. A refused message is already back in the field
 * (the controller restores it): Réessayer sends it again; an attempt of unknown outcome is retried as the same request (no double send). */
export function SendProblem({ controller }: { readonly controller: NativeChatController }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const labels = composerLabels(layer.locale, layer.agent);
  const read = () => controller.getSnapshot().send;
  const send = useSyncExternalStore(controller.subscribe, read, read);
  if (send.kind !== 'blocked' && send.kind !== 'unknown') return null;
  const retryable = send.kind === 'blocked' || (send as { readonly retryable?: boolean }).retryable !== false;
  const retry = () => { void (send.kind === 'unknown' ? controller.retrySameRequest() : controller.send()).catch(() => {}); };
  return <>
    <p role="alert" data-testid="agent-send-problem" data-state={send.kind} className="m-0 flex min-w-0 items-center gap-2 px-3 py-2 text-xs text-destructive">
      <span className="min-w-0 flex-1 truncate">{text.sendFailed}</span>
      {retryable && <Button type="button" size="sm" variant="outline" data-testid="agent-send-retry" onClick={retry}>{labels.retry}</Button>}
    </p>
    <Separator />
  </>;
}

export function FoldedCard({ bar, onOpenFile }: { readonly bar: AgentBarChat; readonly onOpenFile: ((path: string) => void) | undefined }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const { question, status, reply } = bar;
  const action = layer.agent?.replyAction;
  if (!question && status?.state !== 'working' && !reply) return null;
  const header = question ? undefined : status?.state === 'working'
    ? <><span className="text-primary"><Spinner aria-hidden="true" /></span><span data-testid="agent-card-status" className="min-w-0 flex-1 truncate">{status.text}</span></>
    : reply ? <><span className="flex size-4 shrink-0 items-center justify-center rounded-(--radius-3xl) bg-primary text-primary-foreground"><CheckIcon className="size-2.5" aria-hidden="true" /></span>
      <span data-testid="agent-card-status" className="min-w-0 flex-1 truncate">{[text.done, reply.used.join(', ')].filter(Boolean).join(' · ')}</span></> : undefined;
  return <>
    <section data-testid="agent-card" data-state={question ? 'question' : status?.state === 'working' ? 'working' : 'reply'} aria-label={text.assistant}
      className="flex flex-col gap-2 px-3 pt-2.5 pb-3 text-sm text-card-foreground">
      {header && <p role="status" className="m-0 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">{header}</p>}
      {question && <div data-testid="agent-question" aria-label={question.title} className="flex flex-col gap-2">
        {question.step && <p data-testid="agent-question-step" className="m-0 text-xs text-muted-foreground">{question.step}</p>}
        {question.answered && <p data-testid="agent-question-answered" className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground"><CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />{question.answered}</p>}
        <p className="m-0 text-base font-semibold">{question.title}</p>
        <div className="flex flex-wrap gap-2">{question.choices.map(choice => <Button key={choice} type="button" variant="outline" data-choice="" onClick={() => question.onAnswer({ text: choice, source: 'choice' })}>{choice}</Button>)}</div>
      </div>}
      {!question && status?.state !== 'working' && reply && <>
        {/* A tap on the reply opens the conversation, as the chevron does (the chevron stays the way for a keyboard). */}
        <p data-testid="agent-card-reply" onClick={() => layer.open('agent')} className="m-0 line-clamp-3 cursor-pointer whitespace-pre-line">{readable(reply.text)}</p>
        {(reply.files.length > 0 || action) && <div role="list" data-testid="agent-card-files" className="flex flex-wrap items-center gap-1.5">
          {reply.files.map(path => <span role="listitem" key={path}><Button type="button" variant="outline" size="sm" data-testid="agent-card-file" data-path={path} disabled={!onOpenFile} onClick={() => onOpenFile?.(path)}>
            <FileTextIcon data-icon="inline-start" aria-hidden="true" />{path.split('/').at(-1)}</Button></span>)}
          {action && <span role="listitem" className="ml-auto"><Button type="button" variant="ghost" size="sm" data-testid="agent-card-action" onClick={action.onSelect} className="pointer-coarse:min-h-11">{action.label}</Button></span>}
        </div>}
      </>}
    </section>
    <Separator />
  </>;
}
/** `composer: 'bar'`: the thread (Ouvert), the folded card and the field in one frame at the field's width, never the page's (AC-16). The inner input group's own frame is cleared by the block's CSS (`.app-shell [data-one-composer]`). */
export function OneBox({ children }: { readonly children: ReactNode }) {
  // Docked (AC-17) the field and the thread are in the right column: the box stays mounted, empty and out of sight, so nothing stays at the bottom.
  const { dockOpen } = useInternal();
  return <div className={cn('shrink-0 bg-card px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]', dockOpen && 'hidden')}>
    <div data-one-composer="" data-testid="agent-composer-box" className="mx-auto flex w-full max-w-[720px] min-w-0 flex-col overflow-hidden rounded-(--radius-3xl) bg-card text-card-foreground ring-1 ring-border has-focus-visible:ring-2 has-focus-visible:ring-ring">{children}</div>
  </div>;
}

'use client';

// `composer: 'bar'`'s own pieces: the microphone's tap or hold, the conversation's chevron, the folded card on the field, its send problem, the box.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, FileTextIcon, Loader2Icon, MicIcon, SquareIcon, XIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { MENTION_TOKEN } from '@hachej/boring-ui-kit/chat-text';
import { isFileBlock, withoutTarget } from '@hachej/boring-ui-kit/chat-view';
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
  const stop = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (layer.voice.phase !== 'recording') return;
    const control = mic.mode === 'listening' ? stop.current : mic.mode === 'holding' ? ref.current : null;
    control?.focus({ preventScroll: true });
  }, [mic.mode, layer.voice.phase, ref]);
  // The kit hook guards touchstart only on the node it first saw; the microphone remounts after ■, so bind the node it has now.
  useEffect(() => {
    const node = ref.current;
    const keep = (event: Event) => { if (event.cancelable) event.preventDefault(); };
    node?.addEventListener('touchstart', keep, { passive: false });
    return () => node?.removeEventListener('touchstart', keep);
  });
  if (mic.mode === 'listening') return <Button key="stop" ref={stop} type="button" size="icon" data-testid="agent-talk-stop" aria-label={labels.voiceStop} title={labels.voiceStop} onClick={mic.finish} disabled={layer.voice.phase === 'starting'} className="shrink-0"><SquareIcon data-icon="inline-start" aria-hidden="true" /></Button>;
  const busy = layer.voice.phase === 'transcribing';
  return <Button key="mic" ref={ref} type="button" size="icon" data-testid="agent-talk" data-state={mic.mode === 'holding' ? 'holding' : layer.voice.phase} aria-label={label} title={label}
    disabled={busy || (layer.voice.phase === 'idle' && layer.voice.canStart === false)} className="shrink-0 touch-none select-none" {...gesture}>
    {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : mic.mode === 'holding' ? <ArrowUpIcon data-icon="inline-start" aria-hidden="true" /> : <MicIcon data-icon="inline-start" aria-hidden="true" />}</Button>;
}

/** The level and listening words in the text's place; cancellation uses the leading control's slot. */
export function BarMicStatus({ mic }: { readonly mic: BarMic }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const { voice } = layer;
  const holding = mic.mode === 'holding';
  return <div data-testid="agent-talk-status" data-state={holding ? 'holding' : 'listening'} className="flex w-full min-w-0 items-center gap-2">
    <span role="status" aria-live="polite" data-testid={holding ? 'agent-talk-release' : 'agent-talk-listening'} className="min-w-0 flex-1 whitespace-normal text-sm text-muted-foreground">{holding ? text.releaseToSend : text.listening}</span>
    <span className="shrink-0 tabular-nums text-muted-foreground">{voiceClock(voice.seconds)}</span>
    {voice.levels.length > 0 && <div data-testid="agent-talk-wave" aria-hidden="true" className="flex h-6 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden">
      {voice.levels.map((level, index) => <span key={index} className="w-1 shrink-0 bg-muted-foreground" style={{ height: `${Math.max(5, Math.sqrt(Math.min(1, level)) * 100)}%` }} />)}
    </div>}
  </div>;
}

export function BarMicCancel({ mic }: { readonly mic: BarMic }) {
  const layer = useInternal();
  const labels = composerLabels(layer.locale, layer.agent);
  return <Button type="button" variant="secondary" size="icon" data-testid="agent-talk-cancel" aria-label={labels.voiceCancel} title={labels.voiceCancel} onClick={mic.cancel}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>;
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
      onClick={() => { if (open) { layer.close(); requestAnimationFrame(() => (layer.host?.querySelector<HTMLElement>('[data-testid=composer-input]') ?? layer.composerSlot?.querySelector<HTMLElement>('[data-testid=composer-input]'))?.focus({ preventScroll: true })); } else layer.open('agent'); }}>{open ? <ChevronDownIcon data-icon="inline-start" aria-hidden="true" /> : <ChevronUpIcon data-icon="inline-start" aria-hidden="true" />}</Button>
    {unread && <span role="img" aria-label={unread.label} data-testid="agent-bar-unread" className="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-(--radius-3xl) bg-primary" />}
  </span>;
}

/**
 * `composer: 'bar'`, folded: one card joined to the top of the field, at its width. While the agent works its header is what the running tool does;
 * a question shows its choices (a form, each question in turn); a reply that came while folded shows « ✓ Terminé · <what it used> », three lines
 * and the files it cites. Nothing floats over the page: the card is in the column's flow, above the field.
 */
/** The folded excerpt names files and ends omitted source lines with one ellipsis. */
const replyExcerpt = (text: string) => {
  const lines = text.replace(MENTION_TOKEN, (_match, before: string, quoted: string | undefined, bare: string | undefined) => {
    const trail = quoted === undefined ? (bare ?? '').match(/[.,;:!?)\]}'"]+$/)?.[0] ?? '' : '';
    const path = quoted ?? (bare ?? '').slice(0, (bare ?? '').length - trail.length);
    return `${before}${path.split('/').at(-1) ?? path}${trail}`;
  }).split(/\r?\n/);
  if (lines.length <= 3) return lines.join('\n');
  return `${lines.slice(0, 3).join('\n').trimEnd().replace(/[.,;:!?…]+$/u, '')}…`;
};

/** Keep the last visible word whole inside the existing three-line preview. */
function FoldedReply({ text, onOpen }: { readonly text: string; readonly onOpen: () => void }) {
  const source = replyExcerpt(text);
  const visible = useRef<HTMLSpanElement>(null);
  const [excerpt, setExcerpt] = useState(source);
  useLayoutEffect(() => {
    const element = visible.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let width = 0;
    const fit = () => {
      if (!element.clientWidth) return;
      width = element.clientWidth;
      const previous = element.textContent;
      element.textContent = source;
      const fits = () => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
      if (!fits()) {
        const ends = Array.from(source.matchAll(/\S+/gu), match => match.index + match[0].length);
        let low = 0, high = ends.length;
        const prefix = (count: number) => `${source.slice(0, count ? ends[count - 1] : 0).trimEnd().replace(/[.,;:!?…]+$/u, '')}…`;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          element.textContent = prefix(middle);
          if (fits()) low = middle;
          else high = middle - 1;
        }
        element.textContent = prefix(low);
      }
      const next = element.textContent ?? '';
      element.textContent = previous;
      setExcerpt(next);
    };
    const observer = new ResizeObserver(() => { if (element.clientWidth !== width) fit(); });
    observer.observe(element);
    document.fonts.addEventListener('loadingdone', fit);
    return () => { observer.disconnect(); document.fonts.removeEventListener('loadingdone', fit); };
  }, [source]);
  return <p data-testid="agent-card-reply" onClick={onOpen} className="m-0 line-clamp-3 cursor-pointer whitespace-pre-line">
    <span className="sr-only">{source}</span>
    <span ref={visible} aria-hidden="true" className="line-clamp-3">{excerpt}</span>
  </p>;
}

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
  const retry = () => {
    (layer.host?.querySelector<HTMLElement>('[data-testid=composer-input]') ?? layer.composerSlot?.querySelector<HTMLElement>('[data-testid=composer-input]'))?.focus({ preventScroll: true });
    void (send.kind === 'unknown' ? controller.retrySameRequest() : controller.send()).catch(() => {});
  };
  return <>
    <p role="alert" data-testid="agent-send-problem" data-state={send.kind} className="m-0 flex min-w-0 flex-wrap items-center gap-2 px-3 py-2 text-sm text-destructive md:flex-nowrap md:text-xs">
      <span className="min-w-0 flex-1 basis-full text-pretty md:basis-auto">{text.sendFailed}</span>
      {retryable && <Button type="button" size="sm" variant="outline" data-testid="agent-send-retry" onClick={retry}>{labels.retry}</Button>}
    </p>
    <Separator />
  </>;
}

export function FoldedCard({ bar, onOpenFile }: { readonly bar: AgentBarChat; readonly onOpenFile: ((path: string, files: readonly string[]) => void) | undefined }) {
  const layer = useInternal();
  const text = shellWords(layer.locale ?? layer.agent?.chatProps?.locale, layer.agent);
  const { question, status, reply } = bar;
  const controller = layer.agent!.controller;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const running = Boolean(snapshot.view?.docs['pi.live']?.['run']);
  const stopped = snapshot.stop === 'confirmed';
  const working = !stopped && !question && (running || status?.state === 'working');
  const request = working && status?.state !== 'working'
    ? snapshot.view?.entries.flatMap(entry => entry.model ?? []).findLast(message => message.role === 'user') : undefined;
  const task = request?.role === 'user' ? withoutTarget(typeof request.content === 'string' ? request.content
    : request.content.flatMap(part => part.type === 'text' && !isFileBlock(part.text) ? [part.text] : []).join('\n')).trim() : '';
  const continuing = task ? `${text.working} · ${task}` : text.working;
  const workingText = working ? (status?.state === 'working' ? status.text : layer.agent?.workingWords?.({ text: continuing })?.trim() || continuing) : undefined;
  const { markRead } = bar;
  useEffect(() => { if (stopped) markRead(); }, [stopped, markRead]);
  const labels = { ...composerLabels(layer.locale, layer.agent), ...layer.agent?.chatProps?.labels };
  const stoppedHint = layer.agent?.chatProps?.labels?.emptyDescription ?? layer.agent?.words?.emptyDescription
    ?? ((layer.locale ?? layer.agent?.chatProps?.locale) === 'fr' ? 'Envoyez un nouveau message pour continuer.' : 'Send a new message to continue.');
  const action = layer.agent?.replyAction;
  if (!question && !working && !reply && !stopped) return null;
  const header = stopped ? <><SquareIcon weight="fill" className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 text-pretty wrap-anywhere"><span data-testid="agent-card-status">{labels.subagentStatus('cancelled')}</span>{' · '}{stoppedHint}</span></> : question ? undefined : working
    ? <><span className="shrink-0 text-primary"><Spinner aria-hidden="true" /></span><span data-testid="agent-card-status" className="min-w-0 flex-1 whitespace-normal text-pretty wrap-anywhere">{workingText}</span></>
    : reply ? <><span className="flex size-4 shrink-0 items-center justify-center rounded-(--radius-3xl) bg-primary text-primary-foreground"><CheckIcon className="size-2.5" aria-hidden="true" /></span>
      <span data-testid="agent-card-status" className="min-w-0 flex-1 whitespace-normal wrap-anywhere md:truncate">{text.done}{text.done && reply.used.length > 0 ? ' · ' : ''}{reply.used.map((name, index) => {
        const extension = name.lastIndexOf('.');
        const split = extension > 0 ? Math.max(1, extension - 3) : name.length;
        return <span key={name}>{index > 0 ? ', ' : ''}<span title={name} className="inline-flex max-w-full align-bottom whitespace-nowrap">
          <span className="min-w-0 truncate">{name.slice(0, split)}</span><span className="shrink-0">{name.slice(split)}</span>
        </span></span>;
      })}</span></> : undefined;
  return <>
    <section data-testid="agent-card" data-state={stopped ? 'stopped' : question ? 'question' : working ? 'working' : 'reply'} aria-label={text.assistant}
      className="flex flex-col gap-2 px-3 pt-2.5 pb-3 text-sm text-card-foreground md:data-[state=working]:pb-2">
      {header && <p role="status" className={cn('m-0 flex min-w-0 items-center gap-2', working ? 'text-sm font-medium text-card-foreground' : 'text-xs text-muted-foreground')}>{header}</p>}
      {!stopped && question && <div data-testid="agent-question" aria-label={question.title} className="flex flex-col gap-2">
        {question.step && <p data-testid="agent-question-step" className="m-0 text-xs text-muted-foreground">{question.step}</p>}
        {question.answered && <p data-testid="agent-question-answered" className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground"><CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />{question.answered}</p>}
        <p className="m-0 text-base font-semibold">{question.title}</p>
        <div className="flex flex-wrap gap-2">{question.choices.map(choice => <Button key={choice} type="button" variant="outline" data-choice="" onClick={() => {
          (layer.host?.querySelector<HTMLElement>('[data-testid=composer-input]') ?? layer.composerSlot?.querySelector<HTMLElement>('[data-testid=composer-input]'))?.focus({ preventScroll: true });
          question.onAnswer({ text: choice, source: 'choice' });
        }}>{choice}</Button>)}</div>
      </div>}
      {!stopped && !question && !working && reply && <>
        {/* A tap on the reply opens the conversation, as the chevron does (the chevron stays the way for a keyboard). */}
        <FoldedReply text={reply.text} onOpen={() => layer.open('agent')} />
        {(reply.files.length > 0 || action) && <div role="list" data-testid="agent-card-files" className="flex flex-wrap items-center gap-1.5">
          {reply.files.map(path => <span role="listitem" key={path}><Button type="button" variant="outline" size="sm" data-testid="agent-card-file" data-path={path} disabled={!onOpenFile} onClick={() => onOpenFile?.(path, reply.files)}>
            <FileTextIcon data-icon="inline-start" aria-hidden="true" />{path.split('/').at(-1)}</Button></span>)}
          {action && <span role="listitem"><Button type="button" variant="ghost" size="sm" data-testid="agent-card-action" onClick={action.onSelect} className="pointer-coarse:min-h-11">{action.label}</Button></span>}
        </div>}
      </>}
    </section>
    <Separator />
  </>;
}
/** `composer: 'bar'`: the thread (Ouvert), the folded card and the field in one frame at the field's width, never the page's (AC-16). The inner input group's own frame is cleared by the block's CSS (`.app-shell [data-one-composer]`). */
export function OneBox({ children }: { readonly children: ReactNode }) {
  // Docked (AC-17) the field and the thread are in the right column: the box stays mounted, empty and out of sight, so nothing stays at the bottom.
  const { dockOpen, anchored, folded, trayOpen } = useInternal();
  const overlay = trayOpen && !anchored;
  return <div className={cn('shrink-0 bg-card px-6 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]', dockOpen && 'hidden')}>
    <div data-one-composer="" data-folded={folded || undefined} data-testid="agent-composer-box" style={anchored ? undefined : { marginInlineStart: 'clamp(0px, calc((100cqw - var(--app-shell-composer-max)) / 2 - var(--spacing) * 6), max(0px, calc(100% - var(--container-xs, 20rem))))', marginInlineEnd: 0, width: 'auto' }} className={cn('group/one-box mx-auto flex w-full max-w-[720px] min-w-0 flex-col rounded-(--radius-3xl) bg-card text-card-foreground', !anchored && 'relative', overlay ? 'overflow-visible' : 'overflow-hidden ring-1 ring-border has-focus-visible:ring-2 has-focus-visible:ring-ring')}>
      {children}
      {overlay && <>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-1/2 z-20 overflow-hidden" style={{ top: 'calc(0px - var(--app-shell-bar-tray-expanded))' }}>
          <div className="absolute inset-x-0 top-0 -bottom-(--radius-3xl) rounded-(--radius-3xl) ring-1 ring-inset ring-border group-has-focus-visible/one-box:ring-2 group-has-focus-visible/one-box:ring-ring transition-transform duration-(--duration-fast) ease-(--ease-standard) motion-reduce:transition-none" style={{ transform: 'translateY(calc(var(--app-shell-bar-tray-expanded) - var(--app-shell-bar-tray-size)))' }} />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 rounded-(--radius-3xl) ring-1 ring-inset ring-border group-has-focus-visible/one-box:ring-2 group-has-focus-visible/one-box:ring-ring" style={{ clipPath: 'inset(50% 0 0)' }} />
      </>}
    </div>
  </div>;
}

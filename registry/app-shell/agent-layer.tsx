'use client';

// The AgentLayer: ONE agent's PiChat above the app. Compact (below 768px): a bottom drawer with three fixed snap points, peek, half and
// full (shadcn `drawer`, Base UI variant). Expanded: a right panel (`sidebar`, the sidebar-15 right-sidebar pattern). The same layer shows
// the product manager (« Améliorer l'app ») when the account menu asks for it. Push-to-talk is an option of the agent.
// Host concern: Pi has no layout. The chat is the borrowed NativeChatController rendered by PiChat; the screen context travels as the
// submit's `context` (agent-context.ts). Nothing here is configurable beyond AgentSpec.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode, Ref, RefObject } from 'react';
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, Loader2Icon, MicIcon, SparklesIcon, XIcon } from 'lucide-react';
import { Drawer as DrawerPrimitive } from '@base-ui/react/drawer';
import { createVoiceCapture } from '@hachej/boring-feedback/page';
import type { VoiceCapture, VoiceRefusal } from '@hachej/boring-feedback/page';
import type { FeedbackSession } from '@hachej/boring-feedback/ui';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Sidebar, SidebarContent, SidebarHeader, SidebarProvider } from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { PiChat } from '../pi-chat/pi-chat';
import type { PiChatProps } from '../pi-chat/pi-chat';
import { chatTextFor } from '../pi-chat/locale';
import { NoteBubble, useComposerFeedback } from '../feedback/feedback-session';
import { feedbackLabelsFr } from '../feedback/feedback-labels';
import { PointBar, usePointing } from '../feedback/point-mode';
import { cn } from '../utils/utils';
import { useBackLayer } from './back';
import { appShellText } from './text';
import type { AppShellText } from './text';
import { useVisualViewport } from './use-visual-viewport';
import { AgentContextProvider } from './agent-context';

export interface AgentSpec {
  readonly controller: NativeChatController;
  /** The agent's name in the expanded sidebar (default: the chat's title, then « Assistant »). */
  readonly label?: string;
  /** The agent's icon in the sidebar (default: the sparkles of the header trigger). */
  readonly icon?: ComponentType<{ className?: string }>;
  readonly chatProps?: Omit<PiChatProps, 'controller'>;
  /** Push-to-talk. `send` 'auto' submits the transcript; 'draft' (default) only fills the composer. */
  readonly voice?: { readonly transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>; readonly send?: 'auto' | 'draft' };
  /** Point mode (the product manager, in practice). */
  readonly feedback?: FeedbackSession;
}

/** Compact: closed, peek, half or full. Expanded: closed or open. */
export type AgentLayerState = 'closed' | 'peek' | 'half' | 'full' | 'open';
type Which = 'agent' | 'improve';
type Snap = 'closed' | 'peek' | 'half' | 'full';

export interface AgentLayerApi {
  readonly state: AgentLayerState;
  readonly showing: Which | null;
  open(which?: Which, at?: 'half' | 'full'): void;
  close(): void;
  readonly expanded: boolean;
}

// The three fixed snap points: a peek (one composer row and a line of the last reply, `PEEK_REM` above the tab bar), 55% and the full height.
const PEEK_REM = 8;
const HALF = 0.55;
const FULL = 1;
/** Hold the trigger this long before it records; shorter is a tap. */
const HOLD_MS = 350;

/**
 * What a close request from the drawer becomes: a swipe, an outside press and a lost focus never close the layer. `reason` is Base UI's
 * `details.reason` (`'swipe'`, `'outside-press'`, `'focus-out'`, `'escape-key'`, `'close-watcher'`, `'close-press'`, `'trigger-press'`, `'imperative-action'`, `'none'`).
 */
export function nextSnapOnClose(reason: string, hasPeek: boolean): 'peek' | 'half' | 'close' {
  return reason === 'swipe' || reason === 'outside-press' || reason === 'focus-out' ? (hasPeek ? 'peek' : 'half') : 'close';
}

type VoicePhase = 'idle' | 'starting' | 'recording' | 'transcribing';
interface Voice {
  readonly phase: VoicePhase;
  readonly seconds: number;
  readonly problem: string | undefined;
  readonly start: () => void;
  readonly finish: () => void;
  readonly cancel: () => void;
}

interface Internal extends AgentLayerApi {
  readonly agent: AgentSpec | undefined;
  readonly improve: AgentSpec | undefined;
  readonly snap: Snap;
  readonly setSnap: (snap: Snap) => void;
  readonly showAgent: () => void;
  /** Until this time (ms) an outside press is the AgentTrigger's own click. */
  readonly triggerUntil: { current: number };
  readonly voice: Voice;
  /** The peek height in px: `PEEK_REM` plus the tab bar the peek sits above. */
  readonly peekPoint: string;
}

const LayerContext = createContext<Internal | null>(null);

function useInternal(): Internal {
  const layer = useContext(LayerContext);
  if (!layer) throw new Error('useAgentLayer needs an AgentLayerProvider');
  return layer;
}

/** The layer's state and controls. */
export function useAgentLayer(): AgentLayerApi {
  const { state, showing, open, close, expanded } = useInternal();
  return useMemo(() => ({ state, showing, open, close, expanded }), [state, showing, open, close, expanded]);
}

const REFUSAL: Readonly<Record<VoiceRefusal, 'voiceDenied' | 'voiceNoMicrophone' | 'voiceBusy' | 'voiceInsecure' | 'voiceUnsupported' | 'voiceStartFailed'>> = {
  denied: 'voiceDenied', 'no-microphone': 'voiceNoMicrophone', busy: 'voiceBusy', insecure: 'voiceInsecure', unsupported: 'voiceUnsupported', failed: 'voiceStartFailed',
};

/** The agent's push-to-talk: record on `start`, transcribe on `finish`, then submit or fill the composer. One microphone capture per mount. */
function useVoice(agent: AgentSpec | undefined, done: (outcome: 'sent' | 'drafted') => void): Voice {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState<string | undefined>();
  const capture = useRef<VoiceCapture | null>(null);
  const run = useRef(0);
  const work = useRef<AbortController | null>(null);
  const phaseRef = useRef<VoicePhase>('idle');
  const latest = useRef({ agent, done });
  latest.current = { agent, done };
  const set = (next: VoicePhase) => { phaseRef.current = next; setPhase(next); };
  const words = () => chatTextFor(latest.current.agent?.chatProps?.locale).labels;

  useEffect(() => () => { run.current += 1; capture.current?.cancel(); work.current?.abort(); }, []);
  useEffect(() => {
    if (phase !== 'recording') return;
    setSeconds(0);
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [phase]);

  const start = useCallback(() => {
    if (!latest.current.agent?.voice || phaseRef.current !== 'idle') return;
    const attempt = ++run.current;
    setProblem(undefined);
    set('starting');
    capture.current ??= createVoiceCapture();
    // Called synchronously from the person's gesture, so the browser ties the permission prompt to it.
    void capture.current.start().then(result => {
      if (attempt !== run.current) { capture.current?.cancel(); return; }
      if (result.kind === 'refused') { set('idle'); setProblem(result.code ? words()[REFUSAL[result.code]] : result.reason); return; }
      set('recording');
    });
  }, []);

  const cancel = useCallback(() => {
    run.current += 1;
    capture.current?.cancel();
    work.current?.abort();
    work.current = null;
    setProblem(undefined);
    set('idle');
  }, []);

  const finish = useCallback(() => {
    const current = latest.current.agent;
    if (!current?.voice) return;
    if (phaseRef.current === 'starting') { cancel(); return; }
    if (phaseRef.current !== 'recording') return;
    const attempt = run.current;
    set('transcribing');
    void (async () => {
      const recording = await capture.current?.stop().catch(() => null);
      if (attempt !== run.current) return;
      if (!recording) { set('idle'); setProblem(words().voiceNothingHeard); return; }
      const abort = new AbortController();
      work.current = abort;
      try {
        const spoken = (await current.voice!.transcribe(recording.audio, abort.signal)).trim();
        if (attempt !== run.current) return;
        if (!spoken) { setProblem(words().voiceNothingHeard); return; }
        if (current.voice!.send === 'auto') { void current.controller.send(undefined, { text: spoken }); latest.current.done('sent'); }
        else {
          const draft = current.controller.getSnapshot().draft.text;
          current.controller.setText(`${draft}${draft === '' || /\s$/.test(draft) ? '' : ' '}${spoken}`);
          latest.current.done('drafted');
        }
      } catch { if (attempt === run.current) setProblem(words().voiceTranscribeFailed); }
      finally { if (work.current === abort) work.current = null; if (attempt === run.current) set('idle'); }
    })();
  }, [cancel]);

  return useMemo(() => ({ phase, seconds, problem, start, finish, cancel }), [phase, seconds, problem, start, finish, cancel]);
}

/** The height in px of the tab bar the peek sits above (`--app-shell-tabbar` on the shell root), and one rem. */
function useMeasuredPeek(probe: RefObject<HTMLDivElement | null>): string {
  const [px, setPx] = useState(PEEK_REM * 16);
  useLayoutEffect(() => {
    const measure = () => {
      const tab = probe.current?.offsetHeight ?? 0;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setPx(Math.round(PEEK_REM * rem + tab));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' || !probe.current ? undefined : new ResizeObserver(measure);
    if (observer && probe.current) observer.observe(probe.current);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [probe]);
  return `${px}px`;
}

/** Places the layer in the app. `agent` is the one assistant; `improve` is the product manager. Either may be absent. */
export function AgentLayerProvider({ agent, improve, children }: { readonly agent?: AgentSpec | undefined; readonly improve?: AgentSpec | undefined; readonly children: ReactNode }): ReactElement {
  const compact = useIsMobile();
  const expanded = !compact;
  const [snap, setSnapState] = useState<Snap>('closed');
  const [shown, setShown] = useState<Which>(agent ? 'agent' : 'improve');
  const probe = useRef<HTMLDivElement>(null);
  const peekPoint = useMeasuredPeek(probe);
  const triggerUntil = useRef(0);
  const specs = useRef({ agent, improve });
  specs.current = { agent, improve };

  const setSnap = useCallback((next: Snap) => setSnapState(next), []);
  const open = useCallback((which?: Which, at: 'half' | 'full' = 'half') => {
    const { agent: a, improve: i } = specs.current;
    const target = which ?? (a ? 'agent' : 'improve');
    if (target === 'agent' ? !a : !i) return;
    setShown(target);
    setSnapState(at);
  }, []);
  const close = useCallback(() => setSnapState('closed'), []);
  const showAgent = useCallback(() => { if (specs.current.agent) setShown('agent'); }, []);

  // A spec that goes away takes the layer with it.
  const shownSpec = shown === 'agent' ? agent : improve;
  useEffect(() => { if (!shownSpec) { setSnapState('closed'); if (shown === 'improve' && agent) setShown('agent'); else if (shown === 'agent' && improve) setShown('improve'); } }, [shownSpec, shown, agent, improve]);

  const voice = useVoice(agent, outcome => {
    if (outcome === 'drafted') { setShown('agent'); setSnapState('half'); }
  });

  const state: AgentLayerState = snap === 'closed' ? 'closed' : expanded ? 'open' : snap;
  const value = useMemo<Internal>(() => ({
    state, showing: snap === 'closed' ? null : shown, open, close, expanded, agent, improve, snap, setSnap, showAgent, triggerUntil, voice, peekPoint,
  }), [state, snap, shown, open, close, expanded, agent, improve, setSnap, showAgent, triggerUntil, voice, peekPoint]);

  // The shell's z-scale (tabs 20, peek 30, drawer and panel 40, other sheets 50, point bar 60) as custom properties; `display: contents` keeps the box tree unchanged.
  const scale = { '--app-shell-z-tabs': 20, '--app-shell-z-peek': 30, '--app-shell-z-layer': 40, '--app-shell-z-sheet': 50, '--app-shell-z-point': 60 } as CSSProperties;
  return <AgentContextProvider>
    <LayerContext.Provider value={value}>
      <div data-app-shell="" className="contents" style={scale}>
        <div ref={probe} aria-hidden="true" className="pointer-events-none invisible fixed top-0 left-0 w-0" style={{ height: 'var(--app-shell-tabbar, 0px)' }} />
        {children}
      </div>
    </LayerContext.Provider>
  </AgentContextProvider>;
}

/** The header button that opens the layer: a tap opens half; with `agent.voice`, press and hold records and a slide off cancels. Absent without `agent`. */
export function AgentTrigger({ className, children }: { readonly className?: string; readonly children?: ReactNode }) {
  const layer = useInternal();
  const { agent, voice } = layer;
  const text = appShellText(agent?.chatProps?.locale);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; held: boolean; id: number } | null>(null);
  if (!agent) return null;

  const toggle = () => {
    layer.triggerUntil.current = Date.now() + 500;
    if (layer.state !== 'closed' && layer.showing === 'agent' && layer.expanded) layer.close();
    else layer.open('agent', 'half');
  };
  const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = hold.current;
    hold.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    if (event.currentTarget.hasPointerCapture?.(current.id)) event.currentTarget.releasePointerCapture(current.id);
    if (current.held) { if (event.type === 'pointerup') voice.finish(); else voice.cancel(); }
    else if (event.type === 'pointerup') toggle();
  };
  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const state = { timer: undefined as ReturnType<typeof setTimeout> | undefined, held: false, id: event.pointerId };
    hold.current = state;
    if (agent.voice) {
      state.timer = setTimeout(() => {
        state.held = true;
        if (layer.snap === 'closed') layer.setSnap('peek');
        layer.showAgent();
        voice.start();
      }, HOLD_MS);
    }
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = hold.current;
    if (!current?.held) return;
    const box = event.currentTarget.getBoundingClientRect();
    const slack = 24;
    if (event.clientX < box.left - slack || event.clientX > box.right + slack || event.clientY < box.top - slack || event.clientY > box.bottom + slack) {
      hold.current = null;
      voice.cancel();
    }
  };
  return <button type="button" data-agent-trigger="" data-testid="agent-trigger" aria-label={text.open} aria-expanded={layer.state !== 'closed'}
    onPointerDown={down} onPointerUp={release} onPointerCancel={release} onPointerMove={move} onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0) toggle(); }}
    className={cn('inline-flex min-h-9 min-w-9 touch-none items-center justify-center rounded-md text-foreground outline-none select-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11 pointer-coarse:min-w-11', className)}>
    {children ?? <SparklesIcon className="size-4" aria-hidden="true" />}
  </button>;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The hero push-to-talk button at the top of the content at half and full. */
function HeroTalk({ text }: { readonly text: AppShellText }) {
  const { voice } = useInternal();
  const recording = voice.phase === 'recording' || voice.phase === 'starting';
  const busy = voice.phase === 'transcribing';
  const down = (event: ReactPointerEvent<HTMLButtonElement>) => { event.currentTarget.setPointerCapture?.(event.pointerId); voice.start(); };
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (event.type === 'pointerup') voice.finish(); else voice.cancel(); };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!recording) return;
    const box = event.currentTarget.getBoundingClientRect(), slack = 24;
    if (event.clientX < box.left - slack || event.clientX > box.right + slack || event.clientY < box.top - slack || event.clientY > box.bottom + slack) voice.cancel();
  };
  return <div className="shrink-0 px-3 pt-1 pb-2">
    <button type="button" data-testid="agent-hero-talk" data-state={voice.phase} disabled={busy} onPointerDown={down} onPointerUp={up} onPointerCancel={up} onPointerMove={move}
      onContextMenu={event => event.preventDefault()}
      className={cn('flex min-h-14 w-full touch-none items-center justify-center gap-2 rounded-xl bg-muted text-base font-medium text-foreground outline-none select-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60 pointer-coarse:min-h-14', recording && 'bg-destructive text-white hover:bg-destructive/90')}>
      {busy ? <Loader2Icon className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <MicIcon className="size-5" aria-hidden="true" />}
      {recording ? `${text.listening} ${clock(voice.seconds)}` : text.holdToTalk}
    </button>
    {voice.problem && <p role="alert" data-testid="agent-voice-problem" className="m-0 mt-1 text-xs leading-4 text-destructive">{voice.problem}</p>}
  </div>;
}

/** One agent's PiChat. It stays mounted while hidden, so its scroll, focus and drafts survive a swap with the other spec. */
function SpecChat({ spec, visible, role }: { readonly spec: AgentSpec; readonly visible: boolean; readonly role: Which }) {
  // Both entries: the Feedback button and « Montrer dans l'app » (point mode, which hides the layer while the person taps the app).
  const feedback = useComposerFeedback(spec.feedback, { entry: 'both' });
  return <div data-spec={role} hidden={!visible} className={cn('min-h-0 min-w-0 flex-1', visible ? 'flex flex-col' : 'hidden')}>
    <PiChat {...spec.chatProps} controller={spec.controller} {...(feedback ? { feedback } : {})} />
  </div>;
}

/** Both specs, each mounted once it has been shown. */
function Chats({ showing }: { readonly showing: Which }) {
  const { agent, improve } = useInternal();
  const seen = useRef(new Set<Which>());
  seen.current.add(showing);
  return <>
    {agent && seen.current.has('agent') && <SpecChat spec={agent} visible={showing === 'agent'} role="agent" />}
    {improve && seen.current.has('improve') && <SpecChat spec={improve} visible={showing === 'improve'} role="improve" />}
  </>;
}

const ICON_BUTTON = 'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-11 pointer-coarse:min-w-11';

/** Title row: « ← » when the improve view has an agent to go back to, the title, then Expand or Collapse (compact only) and Close. */
function Header({ text, title, compactSnap, closeRef }: { readonly text: AppShellText; readonly title: string; readonly compactSnap?: Snap; readonly closeRef?: Ref<HTMLButtonElement> }) {
  const layer = useInternal();
  const back = layer.showing === 'improve' && layer.agent;
  return <div data-testid="agent-layer-header" className="flex shrink-0 items-center gap-1 px-2 pb-1">
    {back && <button type="button" data-testid="agent-layer-back" aria-label={text.back} title={text.back} onClick={layer.showAgent} className={ICON_BUTTON}><ArrowLeftIcon className="size-4" aria-hidden="true" /></button>}
    <h2 data-testid="agent-layer-title" className="m-0 min-w-0 flex-1 truncate px-1 text-sm font-semibold">{title}</h2>
    {compactSnap === 'half' && <button type="button" data-testid="agent-layer-expand" aria-label={text.expand} title={text.expand} onClick={() => layer.setSnap('full')} className={ICON_BUTTON}><ChevronUpIcon className="size-4" aria-hidden="true" /></button>}
    {compactSnap === 'full' && <button type="button" data-testid="agent-layer-collapse" aria-label={text.collapse} title={text.collapse} onClick={() => layer.setSnap('half')} className={ICON_BUTTON}><ChevronDownIcon className="size-4" aria-hidden="true" /></button>}
    <button type="button" ref={closeRef} data-testid="agent-layer-close" aria-label={text.close} title={text.close} onClick={layer.close} className={ICON_BUTTON}><XIcon className="size-4" aria-hidden="true" /></button>
  </div>;
}

function useTitle(): { text: AppShellText; title: string } {
  const layer = useInternal();
  const spec = layer.showing === 'improve' ? layer.improve : layer.agent;
  const text = appShellText(spec?.chatProps?.locale);
  const title = layer.showing === 'improve' ? text.improve : (spec?.chatProps?.labels?.title ?? text.assistant);
  return { text, title };
}

const toSnap = (point: number | string | null, peekPoint: string): Snap | null =>
  point === peekPoint ? 'peek' : point === HALF ? 'half' : point === FULL ? 'full' : null;

function CompactSheet({ pointing }: { readonly pointing: boolean }) {
  const layer = useInternal();
  const { snap, agent, voice } = layer;
  const hasPeek = Boolean(agent);
  const { text, title } = useTitle();
  const vv = useVisualViewport();
  const closeRef = useRef<HTMLButtonElement>(null);
  const vetoed = useRef(false);
  const open = snap !== 'closed' && !pointing;
  const peek = snap === 'peek';
  const points = useMemo(() => hasPeek ? [layer.peekPoint, HALF, FULL] : [HALF, FULL], [hasPeek, layer.peekPoint]);
  const value = peek ? layer.peekPoint : snap === 'full' ? FULL : HALF;
  const showing = layer.showing ?? 'agent';
  const recording = voice.phase !== 'idle';

  useBackLayer((snap === 'half' || snap === 'full') && !pointing, layer.close, 'agent');

  // The popup is taller than what shows and slides down by `--drawer-snap-point-offset` (a registered, non-inheriting property, so only the
  // popup itself can read it): padding the popup by that offset makes its content box exactly the visible part. At peek the tab bar below is left out too.
  const style = { '--app-shell-vv-height': vv ? `${vv.height}px` : '100dvh',
    paddingBottom: peek ? 'calc(var(--drawer-snap-point-offset, 0px) + var(--app-shell-tabbar, 0px))' : 'var(--drawer-snap-point-offset, 0px)' } as CSSProperties;
  return <Drawer open={open} modal={!peek} showSwipeHandle swipeDirection="down" snapPoints={points} snapPoint={value}
    onOpenChange={(next, details) => {
      if (next) return;
      const outcome = nextSnapOnClose(details.reason, hasPeek);
      if (outcome === 'close') { layer.close(); return; }
      details.cancel();
      vetoed.current = true;
      setTimeout(() => { vetoed.current = false; }, 120);
      // Focus leaving the non-modal peek changes nothing, and neither does the click that finished a press on the AgentTrigger (outside the
      // drawer, so it counts as an outside press): the trigger already chose the snap.
      if (details.reason === 'focus-out' || Date.now() < layer.triggerUntil.current) return;
      layer.setSnap(outcome);
    }}
    onSnapPointChange={point => {
      // Vetoing a swipe-close makes the drawer snap back to where it was: that echo must not undo the snap we chose.
      if (vetoed.current) return;
      const next = toSnap(point, layer.peekPoint);
      if (next && (next !== 'peek' || hasPeek)) layer.setSnap(next);
    }}>
    <DrawerContent data-testid="agent-layer" data-state={snap} data-peek={peek} initialFocus={closeRef} style={style}
      className={cn('box-border z-(--app-shell-z-layer) data-[swipe-direction=down]:bottom-(--drawer-keyboard-inset,0px) data-[swipe-axis=y]:[--drawer-content-max-height:calc(var(--app-shell-vv-height,100dvh)-1.5rem)]',
        // The peek is the top PEEK_REM of the popup; the part that overlaps the tab bar is clipped away, so the tabs stay visible and tappable.
        'data-[peek=true]:not-data-swiping:[clip-path:inset(0_0_calc(100%_-_8rem)_0)]')}>
      <DrawerPrimitive.VirtualKeyboardProvider>
        <div data-testid="agent-layer-sheet" onFocusCapture={event => { if ((event.target as HTMLElement).matches('[data-testid=composer-input]')) layer.setSnap('full'); }}
          className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain',
            // The layer's own header carries the title and Close, so the chat's is hidden. At peek: one line of the last reply above the
            // composer, no empty-state overlay, room for Close.
            '[&_[data-boring=pi-chat]>header]:hidden',
            peek && '[&_[data-boring=pi-chat]>.relative]:overflow-hidden [&_[data-testid=transcript]]:pr-14 [&_[data-testid=transcript]]:pb-2')}>
          {!peek && <Header text={text} title={title} compactSnap={snap} closeRef={closeRef} />}
          {peek && <button type="button" ref={closeRef} data-testid="agent-layer-close" aria-label={text.close} title={text.close} onClick={layer.close}
            className={cn(ICON_BUTTON, 'absolute top-0 right-1 z-10')}><XIcon className="size-4" aria-hidden="true" /></button>}
          {!peek && showing === 'agent' && agent?.voice && <HeroTalk text={text} />}
          {peek && recording && <div role="status" data-testid="agent-listening" className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-popover text-sm font-medium">
            <MicIcon className="size-4 text-destructive" aria-hidden="true" />{voice.phase === 'transcribing' ? <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : `${text.listening} ${clock(voice.seconds)}`}
          </div>}
          {/* The transcript scrolls and never drags the sheet: only the handle and the title row swipe. */}
          <div data-base-ui-swipe-ignore="" className="flex min-h-0 flex-1 flex-col"><Chats showing={showing} /></div>
        </div>
      </DrawerPrimitive.VirtualKeyboardProvider>
    </DrawerContent>
  </Drawer>;
}

function ExpandedPanel() {
  const layer = useInternal();
  const { text, title } = useTitle();
  const open = layer.snap !== 'closed';
  const showing = layer.showing ?? 'agent';
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) layer.close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, layer]);
  // Its own provider keeps the panel's width and open state apart from the left sidebar's (Ctrl+B belongs to that one); `contents` adds no box.
  return <SidebarProvider open={open} onOpenChange={() => {}} className="contents" style={{ '--sidebar-width': '24rem' } as CSSProperties}>
    <Sidebar side="right" collapsible="offcanvas" data-testid="agent-layer" data-state={open ? 'open' : 'closed'} aria-label={title} inert={!open} className="z-(--app-shell-z-layer)">
      <SidebarHeader className="p-0 pt-2"><Header text={text} title={title} /></SidebarHeader>
      <SidebarContent className="gap-0 overflow-hidden">
        {open && <div className="flex min-h-0 flex-1 flex-col [&_[data-boring=pi-chat]>header]:hidden"><Chats showing={showing} /></div>}
      </SidebarContent>
    </Sidebar>
  </SidebarProvider>;
}

/** The layer itself: the drawer on a phone, the right panel on a wide screen. Placed once by the shell. */
export function AgentLayer(): ReactElement | null {
  const layer = useInternal();
  const pointingAgent = usePointing(layer.agent?.feedback), pointingImprove = usePointing(layer.improve?.feedback);
  const session = pointingAgent ? layer.agent?.feedback : pointingImprove ? layer.improve?.feedback : undefined;
  if (!layer.agent && !layer.improve) return null;
  const locale = (pointingAgent ? layer.agent : layer.improve)?.chatProps?.locale;
  // Point mode: the compact sheet steps aside (the wide panel does not cover the app); the bar sits above the tab bar, outside the layer.
  return <>
    {layer.expanded ? <ExpandedPanel /> : <CompactSheet pointing={session !== undefined} />}
    {session && <>
      <PointBar session={session} bottomOffset="var(--app-shell-tabbar, 0px)" {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />
      <NoteBubble session={session} {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />
    </>}
  </>;
}

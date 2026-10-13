'use client';

// The AgentLayer: ONE agent's PiChat above the app. Compact (below 768px): a bottom drawer with three fixed snap points, peek, half and
// full (shadcn `drawer`, Base UI variant). Expanded: a right panel (`sidebar`, the sidebar-15 right-sidebar pattern). The same layer shows
// the product manager (« Améliorer l'app ») when the account menu asks for it. Push-to-talk is an option of the agent.
// Host concern: Pi has no layout. The chat is the borrowed NativeChatController rendered by PiChat; the screen context travels as the
// submit's `context` (agent-context.ts). Nothing here is configurable beyond AgentSpec.
import { createPortal } from 'react-dom';
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
const PEEK_REM = 6;
/** The shell's z-scale (tabs 20, peek 30, drawer and panel 40, other sheets 50, point bar 60). */
const Z = { tabs: 20, peek: 30, layer: 40, sheet: 50, point: 60 } as const;
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
  /** The measured tab bar height in px, given explicitly to the parts portalled to the body (they cannot inherit the shell's variables). */
  readonly tabbar: number;
  /** The persistent element holding both chats: it moves between the drawer and the panel, so closing never unmounts a chat. */
  readonly host: HTMLElement | null;
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
        const fill = () => {
          const draft = current.controller.getSnapshot().draft.text;
          current.controller.setText(`${draft}${draft === '' || /\s$/.test(draft) ? '' : ' '}${spoken}`);
          latest.current.done('drafted');
        };
        if (current.voice!.send === 'auto') {
          // Admission is awaited: the text is reported as sent only when the submission was admitted. A refusal puts it back in the composer
          // (the controller does that); a rejection (an earlier submission still unconfirmed) is caught here and the transcript is kept as a draft.
          try { if (await current.controller.send(undefined, { text: spoken })) latest.current.done('sent'); else latest.current.done('drafted'); }
          catch { fill(); }
        } else fill();
      } catch { if (attempt === run.current) setProblem(words().voiceTranscribeFailed); }
      finally { if (work.current === abort) work.current = null; if (attempt === run.current) set('idle'); }
    })();
  }, [cancel]);

  return useMemo(() => ({ phase, seconds, problem, start, finish, cancel }), [phase, seconds, problem, start, finish, cancel]);
}

/** The height in px of the tab bar the peek sits above (`--app-shell-tabbar` on the shell root), and one rem. */
function useMeasuredPeek(probe: RefObject<HTMLDivElement | null>): { readonly peekPoint: string; readonly tabbar: number } {
  const [px, setPx] = useState(PEEK_REM * 16);
  const [tabbar, setTabbar] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const tab = probe.current?.offsetHeight ?? 0;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setPx(Math.round(PEEK_REM * rem + tab));
      setTabbar(tab);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' || !probe.current ? undefined : new ResizeObserver(measure);
    if (observer && probe.current) observer.observe(probe.current);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [probe]);
  return { peekPoint: `${px}px`, tabbar };
}

/** Places the layer in the app. `agent` is the one assistant; `improve` is the product manager. Either may be absent. */
export function AgentLayerProvider({ agent, improve, children }: { readonly agent?: AgentSpec | undefined; readonly improve?: AgentSpec | undefined; readonly children: ReactNode }): ReactElement {
  const compact = useIsMobile();
  const expanded = !compact;
  const [snap, setSnapState] = useState<Snap>('closed');
  const [shown, setShown] = useState<Which>(agent ? 'agent' : 'improve');
  const probe = useRef<HTMLDivElement>(null);
  const { peekPoint, tabbar } = useMeasuredPeek(probe);
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

  // The chats live in one element that is moved into the open drawer or panel; React keeps them mounted (and so their presentation state
  // and uploads) while the layer is closed, on a phone and on a wide screen. Nothing is mounted before the layer is first opened.
  const [host] = useState(() => typeof document === 'undefined' ? null : Object.assign(document.createElement('div'), { className: 'flex min-h-0 flex-1 flex-col [&_[data-boring=pi-chat]>header]:hidden' }));
  const opened = useRef(false);
  if (snap !== 'closed') opened.current = true;

  const voice = useVoice(agent, outcome => {
    if (outcome === 'drafted') { setShown('agent'); setSnapState('half'); }
  });

  const state: AgentLayerState = snap === 'closed' ? 'closed' : expanded ? 'open' : snap;
  const value = useMemo<Internal>(() => ({
    state, showing: snap === 'closed' ? null : shown, open, close, expanded, agent, improve, snap, setSnap, showAgent, triggerUntil, voice, peekPoint, tabbar, host,
  }), [state, snap, shown, open, close, expanded, agent, improve, setSnap, showAgent, triggerUntil, voice, peekPoint, tabbar, host]);

  // The shell's z-scale (tabs 20, peek 30, drawer and panel 40, other sheets 50, point bar 60) as custom properties; `display: contents` keeps the box tree unchanged.
  const scale = { '--app-shell-z-tabs': Z.tabs, '--app-shell-z-peek': Z.peek, '--app-shell-z-layer': Z.layer, '--app-shell-z-sheet': Z.sheet, '--app-shell-z-point': Z.point } as CSSProperties;
  return <AgentContextProvider>
    <LayerContext.Provider value={value}>
      <div data-app-shell="" className="contents" style={scale}>
        <div ref={probe} aria-hidden="true" className="pointer-events-none invisible fixed top-0 left-0 w-0" style={{ height: 'var(--app-shell-tabbar, 0px)' }} />
        {children}
        {host && opened.current && createPortal(<Chats showing={shown} />, host)}
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

/** Push-to-talk in the composer row (PiChat's `tools` slot): press and hold, release to send or fill; a slide off cancels. */
function TalkButton({ text }: { readonly text: AppShellText }) {
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
  return <button type="button" data-testid="agent-talk" data-state={voice.phase} disabled={busy} aria-label={text.holdToTalk} title={text.holdToTalk}
    onPointerDown={down} onPointerUp={up} onPointerCancel={up} onPointerMove={move} onContextMenu={event => event.preventDefault()}
    className={cn('inline-flex size-11 shrink-0 touch-none items-center justify-center rounded-lg bg-muted text-foreground outline-none select-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60', recording && 'bg-destructive text-white hover:bg-destructive/90')}>
    {busy ? <Loader2Icon className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <MicIcon className="size-5" aria-hidden="true" />}
  </button>;
}

/** What went wrong with the microphone, in the flow under the title row (never over the messages). */
function VoiceProblem() {
  const { voice } = useInternal();
  return voice.problem ? <p role="alert" data-testid="agent-voice-problem" className="m-0 shrink-0 px-3 pb-1 text-xs leading-4 text-destructive">{voice.problem}</p> : null;
}

/** One agent's PiChat. It stays mounted while hidden, so its scroll, focus and drafts survive a swap with the other spec. */
function SpecChat({ spec, visible, role }: { readonly spec: AgentSpec; readonly visible: boolean; readonly role: Which }) {
  // Both entries: the Feedback button and « Montrer dans l'app » (point mode, which hides the layer while the person taps the app).
  const feedback = useComposerFeedback(spec.feedback, { entry: 'both' });
  const pointing = usePointing(spec.feedback);
  const fr = spec.chatProps?.locale === 'fr';
  return <div data-spec={role} hidden={!visible} className={cn('min-h-0 min-w-0 flex-1', visible ? 'flex flex-col' : 'hidden')}>
    <PiChat {...spec.chatProps} controller={spec.controller} {...(feedback ? { feedback } : {})}
      {...(role === 'agent' && spec.voice ? { tools: <TalkButton text={appShellText(spec.chatProps?.locale)} /> } : {})} />
    {/* The note editor of ordinary feedback lives inside the layer, in the modal's focus tree; while pointing the layer steps aside and AgentLayer renders it. */}
    {spec.feedback && visible && !pointing && <NoteBubble session={spec.feedback} {...(fr ? { labels: feedbackLabelsFr } : {})} />}
  </div>;
}

/** Where the chats show: the persistent host element is moved in once, when the drawer or panel mounts. */
function ChatSlot() {
  const { host } = useInternal();
  const place = useCallback((slot: HTMLDivElement | null) => { if (slot && host) slot.appendChild(host); }, [host]);
  // Coarse pointers: the chat's own transcript buttons (copy, show earlier) get the layer's 44px rule from here, without touching pi-chat.
  return <div ref={place} className="flex min-h-0 flex-1 flex-col [&_[data-testid=transcript]_button]:pointer-coarse:min-h-11 [&_[data-testid=transcript]_button]:pointer-coarse:min-w-11" />;
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

  useBackLayer(snap === 'half' || snap === 'full', layer.close, 'agent');

  // The popup is taller than what shows and slides down by `--drawer-snap-point-offset` (a registered, non-inheriting property, so only the
  // popup itself can read it): padding the popup by that offset makes its content box exactly the visible part. At peek the tab bar below is left out too.
  // The popup is portalled to the body, outside the shell root: it is given the measured tab bar height and the z-values explicitly.
  const style = { '--app-shell-vv-height': vv ? `${vv.height}px` : '100dvh', '--app-shell-tabbar': `${layer.tabbar}px`, '--app-shell-z-layer': Z.layer,
    paddingBottom: peek ? 'calc(var(--drawer-snap-point-offset, 0px) + var(--app-shell-tabbar, 0px))' : 'var(--drawer-snap-point-offset, 0px)' } as CSSProperties;
  // Entering the modal half or full from the non-modal peek does not rerun Base UI's initial focus: if focus is still on the page, take it to Close.
  const wasPeek = useRef(false);
  useEffect(() => {
    const entering = wasPeek.current && !peek && open;
    wasPeek.current = peek;
    if (!entering) return;
    const take = () => {
      const popup = closeRef.current?.closest('[data-slot=drawer-popup]');
      if (popup && !popup.contains(document.activeElement)) closeRef.current?.focus({ preventScroll: true });
    };
    // Base UI re-applies its modal guards as the sheet moves: take focus once they have settled, and again after the slide.
    const early = setTimeout(take, 60), late = setTimeout(take, 520);
    return () => { clearTimeout(early); clearTimeout(late); };
  }, [peek, open]);
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
    <DrawerContent data-testid="agent-layer" aria-label={title} data-state={snap} data-peek={peek} initialFocus={() => closeRef.current ?? false} style={style}
      className={cn('app-shell box-border z-(--app-shell-z-layer) data-[swipe-direction=down]:bottom-(--drawer-keyboard-inset,0px) data-[swipe-axis=y]:[--drawer-content-max-height:calc(var(--app-shell-vv-height,100dvh)-1.5rem)]',
        // The peek is the top PEEK_REM of the popup; the part that overlaps the tab bar is clipped away, so the tabs stay visible and tappable.
        'data-[peek=true]:not-data-swiping:[clip-path:inset(0_0_calc(100%_-_6rem)_0)]')}>
      <DrawerPrimitive.VirtualKeyboardProvider>
        <div data-testid="agent-layer-sheet" onFocusCapture={event => { if ((event.target as HTMLElement).matches('[data-testid=composer-input]')) layer.setSnap('full'); }}
          className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain',
            // The layer's own header carries the title and Close, so the chat's is hidden. At peek: one line of the last reply above the
            // composer, no empty-state overlay, room for Close.
            '[&_[data-boring=pi-chat]>header]:hidden',
            // At peek: ONE compact row (a one-line input, the microphone and Send; the other composer controls wait for half), and the last
            // reply as a single truncated line above it.
            peek && ['[&_[data-boring=pi-chat]>.relative]:overflow-hidden [&_[data-boring=pi-chat]>.relative>.pointer-events-none]:hidden',
              '[&_[data-boring=pi-chat]>footer]:px-2 [&_[data-boring=pi-chat]>footer]:pt-1 [&_[data-boring=pi-chat]>footer]:pb-2',
              '[&_[data-testid=transcript]]:gap-0 [&_[data-testid=transcript]]:p-0 [&_[data-testid=transcript]]:px-3 [&_[data-testid=transcript]>*]:max-h-5 [&_[data-testid=transcript]>*]:truncate [&_[data-testid=transcript]_button]:hidden',
              '[&_[data-testid=composer]]:flex [&_[data-testid=composer]]:items-center [&_[data-testid=composer]]:rounded-full',
              '[&_[data-testid=composer-input]]:min-h-11 [&_[data-testid=composer-input]]:max-h-11 [&_[data-testid=composer-input]]:flex-1 [&_[data-testid=composer-input]]:px-4 [&_[data-testid=composer-input]]:py-2.5',
              '[&_[data-testid=composer]>div]:p-0 [&_[data-testid=composer]>div]:pr-1 [&_[data-testid=composer]>div>.flex-1]:hidden',
              '[&_[data-testid=composer-plus]]:hidden [&_[data-testid=composer-feedback]]:hidden [&_[data-testid=composer-point]]:hidden'])}>
          {!peek && <Header text={text} title={title} compactSnap={snap} closeRef={closeRef} />}
          {!peek && <VoiceProblem />}
          {peek && recording && <div role="status" data-testid="agent-listening" data-phase={voice.phase} className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-popover text-sm font-medium">
            <MicIcon className="size-4 text-destructive" aria-hidden="true" />{voice.phase === 'transcribing' ? <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : `${text.listening} ${clock(voice.seconds)}`}
          </div>}
          {/* The transcript scrolls and never drags the sheet: only the handle and the title row swipe. */}
          <div data-base-ui-swipe-ignore="" className="flex min-h-0 flex-1 flex-col"><ChatSlot /></div>
        </div>
      </DrawerPrimitive.VirtualKeyboardProvider>
    </DrawerContent>
  </Drawer>;
}

function ExpandedPanel() {
  const layer = useInternal();
  const { text, title } = useTitle();
  const open = layer.snap !== 'closed';
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) layer.close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, layer]);
  // Its own provider keeps the panel's width and open state apart from the left sidebar's (Ctrl+B belongs to that one); `contents` adds no box.
  return <SidebarProvider open={open} onOpenChange={() => {}} className="contents" style={{ '--sidebar-width': '24rem' } as CSSProperties}>
    <Sidebar side="right" collapsible="offcanvas" data-testid="agent-layer" data-state={open ? 'open' : 'closed'} aria-label={title} inert={!open} className="app-shell z-(--app-shell-z-layer)">
      <SidebarHeader className="p-0 pt-2"><Header text={text} title={title} /></SidebarHeader>
      <SidebarContent className="gap-0 overflow-hidden">
        <VoiceProblem />
        <ChatSlot />
      </SidebarContent>
    </Sidebar>
  </SidebarProvider>;
}

/** The layer itself: the drawer on a phone, the right panel on a wide screen. Placed once by the shell. */
export function AgentLayer(): ReactElement | null {
  const layer = useInternal();
  const pointingAgent = usePointing(layer.agent?.feedback), pointingImprove = usePointing(layer.improve?.feedback);
  const session = pointingAgent ? layer.agent?.feedback : pointingImprove ? layer.improve?.feedback : undefined;
  // Back ends pointing first (the `point` priority); the layer keeps its own history entry underneath.
  useBackLayer(session !== undefined, () => session?.discard(), 'point');
  if (!layer.agent && !layer.improve) return null;
  const locale = (pointingAgent ? layer.agent : layer.improve)?.chatProps?.locale;
  // Point mode: the compact sheet steps aside (the wide panel does not cover the app); the bar sits above the tab bar, outside the layer.
  return <>
    {layer.expanded ? <ExpandedPanel /> : <CompactSheet pointing={session !== undefined} />}
    {session && <>
      <PointBar session={session} bottomOffset={`${layer.tabbar}px`} className="z-[60]" {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />
      <NoteBubble session={session} {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />
    </>}
  </>;
}

'use client';

// The AgentLayer: ONE agent's PiChat above the app. Compact (below 768px): a bottom drawer with three fixed snap points, peek, half and
// full (shadcn `drawer`, Base UI variant). Expanded: a `Dock` (the `dock` item) beside the app, docked on the left or the right (default right)
// or floating over it; the person chooses and the choice is remembered. The same layer shows
// the product manager (« Améliorer l’app ») when the account menu asks for it. Push-to-talk is an option of the agent.
// Host concern: Pi has no layout. The chat is the borrowed NativeChatController rendered by PiChat; the screen context travels as the
// submit's `context` (agent-context.ts). Nothing here is configurable beyond AgentSpec.
import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, HTMLAttributes, PointerEvent as ReactPointerEvent, ReactElement, ReactNode, Ref, RefObject } from 'react';
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, Loader2Icon, MicIcon, PanelLeftIcon, PanelRightIcon, PictureInPicture2Icon, SparklesIcon, XIcon } from 'lucide-react';
// Behaviour only: Base UI's keyboard-inset provider for the host drawer's content. It renders nothing visible.
import * as BaseDrawerParts from '@base-ui/react/drawer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { FeedbackSession } from '@hachej/boring-feedback/ui';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { appendToDraft, mentionedPaths, mentionToken, pieces, removeMention, withoutMentions } from '@hachej/boring-ui-kit/chat-text';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dock, DockLayout, DockMain } from '../dock/dock';
import { useDraggable } from '../utils/use-draggable';
import type { DockApi } from '../dock/dock';
import { PiChat } from '../pi-chat/pi-chat';
import type { PiChatProps } from '../pi-chat/pi-chat';
import type { VoiceMessageConfig } from '../pi-chat/config';
import { useRecordingCancellation } from '../pi-chat-voice/use-hold-to-record';
import { useVoiceMessage } from '../pi-chat-voice/use-voice-message';
import type { PendingVoice } from '../pi-chat-voice/use-voice-message';
import { voiceClock } from '../pi-chat/config';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';
import { PendingVoiceBubble, VoiceMessageButton } from '../pi-chat-voice/voice-message';
import { chatTextFor } from '../pi-chat/locale';
import { NoteBubble, useComposerFeedback } from '../feedback/feedback-session';
import { feedbackLabelsFr } from '../feedback/feedback-labels';
import { CommentBanner, useCommenting, usePointing } from '../feedback/point-mode';
import { cn } from '../utils/utils';
import { useBackLayer } from './back';
import { parseAgentLink } from './agent-link';
import { closeShellLayer, registerAgentLayerCloser } from './shell-layer';
import { appShellText } from './text';
import type { AppShellLocale, AppShellText } from './text';
import { useVisualViewport } from './use-visual-viewport';
import { AgentContextProvider } from './agent-context';
import { HeaderActions } from './header-actions';
import type { ScreenHeaderAction } from './header-actions';
import { useDictation } from './use-dictation';
import type { Dictation } from './use-dictation';

export interface AgentSpec {
  readonly controller: NativeChatController;
  /** The agent's name in the expanded sidebar and the header trigger's accessible name (default: the chat's title, then « Assistant »). */
  readonly label?: string;
  /** The agent's icon in the sidebar and the header trigger (default: sparkles). */
  readonly icon?: ComponentType<{ className?: string }>;
  readonly chatProps?: Omit<PiChatProps, 'controller'>;
  /** Push-to-talk. `message` retains audio plus transcript; `auto` sends text only; `draft` (default) fills the composer. */
  readonly voice?: VoiceMessageConfig & { readonly send?: 'auto' | 'draft' | 'message' };
  /** Point mode (the product manager, in practice). */
  readonly feedback?: FeedbackSession;
  /** Host actions in the layer's title row (before the dock controls, or the snap and close controls when compact), as the screen header's. Two shown, the rest in « … ». Not at peek. */
  readonly headerActions?: readonly ScreenHeaderAction[];
}

/** Compact: closed, peek, half or full. Expanded: closed or open. */
export type AgentLayerState = 'closed' | 'peek' | 'half' | 'full' | 'open';
type Which = 'agent' | 'improve';
type Snap = 'closed' | 'peek' | 'half' | 'full';

export interface AgentLayerApi {
  readonly agent: NativeChatController | undefined;
  readonly state: AgentLayerState;
  readonly showing: Which | null;
  open(which?: Which, at?: 'peek' | 'half' | 'full'): void;
  close(): void;
  /** Open the real chat with one card mention. Call directly from a click or swipe release to grant microphone permission. False without an agent. */
  readonly talkAbout: (mention: string, options?: { readonly voice?: boolean; readonly at?: 'half' | 'full' }) => boolean;
  readonly expanded: boolean;
}

// The three fixed snap points: a peek (the file chip, one composer row and a line of the last reply, `PEEK_REM` above the tab bar), 55% and the full height.
const PEEK_REM = 8;
/** The shell's z-scale (tabs 20, peek 30, drawer and panel 40, other sheets 50, point bar 60). */
const Z = { tabs: 20, peek: 30, layer: 40, sheet: 50, point: 60 } as const;
const HALF = 0.55;
const FULL = 1;
/** Hold the trigger this long before it records; shorter is a tap. */
const HOLD_MS = 350;

/**
 * What a close request from the drawer becomes. A swipe, an outside press, a lost focus and Escape never close the layer: they step down
 * to peek (half without an `agent`), so the modal state goes and the coach stays reachable. Only the Close control closes it. `reason` is
 * Base UI's `details.reason` (`'swipe'`, `'outside-press'`, `'focus-out'`, `'escape-key'`, `'close-watcher'`, `'close-press'`, `'trigger-press'`,
 * `'imperative-action'`, `'none'`).
 */
export function nextSnapOnClose(reason: string, hasPeek: boolean): 'peek' | 'half' | 'close' {
  return reason === 'swipe' || reason === 'outside-press' || reason === 'focus-out' || reason === 'escape-key' ? (hasPeek ? 'peek' : 'half') : 'close';
}

interface Voice extends Dictation {
  readonly pending?: readonly PendingVoice[] | undefined;
  readonly captureSequence?: number;
  readonly canStart?: boolean;
}

/**
 * Whether a close request comes from something the layer does not own: a full-screen overlay portalled above it (`[data-boring-overlay]`,
 * for example the composer's camera). Its taps count as outside presses and its focus as a focus-out of the drawer, but they must change
 * nothing: the caller cancels the request and leaves the snap alone. Only those three reasons are looked at, and the event target, the
 * related target (focus-out) or the focused element may be the overlay.
 */
export function isOverlayEvent(details: { readonly reason: string; readonly event?: Event | undefined }): boolean {
  if (details.reason !== 'outside-press' && details.reason !== 'focus-out' && details.reason !== 'escape-key') return false;
  const inside = (node: unknown) => node instanceof Element && node.closest('[data-boring-overlay]') !== null;
  const event = details.event as (Event & { relatedTarget?: EventTarget | null }) | undefined;
  return inside(event?.target) || inside(event?.relatedTarget) || inside(globalThis.document?.activeElement);
}

interface Internal extends Omit<AgentLayerApi, 'agent'> {
  readonly agent: AgentSpec | undefined;
  readonly improve: AgentSpec | undefined;
  readonly snap: Snap;
  readonly setSnap: (snap: Snap) => void;
  /** Whether the wide layout's dock is floating over the app (reported by the panel); with `expanded` it gives the chats' placement. */
  readonly dockFloating: boolean;
  readonly setDockFloating: (floating: boolean) => void;
  readonly showAgent: () => void;
  /** Until this time (ms) an outside press is the AgentTrigger's own click. */
  readonly triggerUntil: { current: number };
  readonly voice: Voice;
  readonly talkRecording: boolean;
  /** The peek height in px: `PEEK_REM` plus the tab bar the peek sits above. */
  readonly peekPoint: string;
  /** The measured tab bar height in px, given explicitly to the parts portalled to the body (they cannot inherit the shell's variables). */
  readonly tabbar: number;
  /** The persistent element holding both chats: it moves between the drawer and the panel, so closing never unmounts a chat. */
  readonly host: HTMLElement | null;
  /** The shell's `locale`: the layer's own words when the agent spec sets none (`agent.chatProps.locale` first). */
  readonly locale: AppShellLocale | undefined;
  /** Expanded only: the side the dock sits on while docked (the viewer's choice, remembered). */
  readonly side: DockSide;
  readonly setSide: (side: DockSide) => void;
  /** Set by a dock control: the next placement or side change puts focus back on the panel's first dock control. */
  readonly restoreFocus: { current: boolean };
}

type DockSide = 'left' | 'right';
/** The dock's remembered state lives under this prefix (DockLayout's storageKey): `<key>.agent.floating`, `.width`, and the side. */
const DOCK_KEY = 'boring.app-shell';
const SIDE_KEY = `${DOCK_KEY}.agent.side`;

const LayerContext = createContext<Internal | null>(null);

function useInternal(): Internal {
  const layer = useContext(LayerContext);
  if (!layer) throw new Error('useAgentLayer needs an AgentLayerProvider');
  return layer;
}

/** A screen's way to hand the layer an assistant it already owns (see `useAgentLoan`). */
export interface AgentLoan {
  /** False when the shell has its own `agent`: a loan never replaces it. */
  readonly available: boolean;
  /** Lends `spec` as the shell's `agent` and opens it at `at` (just lends it without `at`). `undefined` takes it back and closes the layer. */
  lend(spec: AgentSpec | undefined, at?: 'peek' | 'half' | 'full'): void;
}
interface LoanContextValue extends AgentLoan { readonly compact: boolean }
const LoanContext = createContext<LoanContextValue | null>(null);

/**
 * For a screen that owns an assistant (a page-sized `AgentWorkspace`): `lend(spec, 'peek')` shows that same controller in the shell's
 * bottom drawer on a phone, so one chat drawer serves the app; `lend(undefined)` returns it. `null` outside an `AppShell`; `compact` says
 * whether the layer is the phone drawer (below 768px), the only place a loan is shown (a wide shell keeps the screen's own placement).
 */
export function useAgentLoan(): (AgentLoan & { readonly compact: boolean }) | null { return useContext(LoanContext); }

/** The layer's state and controls. */
export function useAgentLayer(): AgentLayerApi {
  const { state, showing, open, close, talkAbout, expanded, agent: spec } = useInternal();
  const agent = spec?.controller;
  return useMemo(() => ({ state, showing, open, close, talkAbout, expanded, agent }), [state, showing, open, close, talkAbout, expanded, agent]);
}

/** Push-to-talk uses the same dictation lifecycle as page targeting, over the existing composer/controller. */
function useVoice(agent: AgentSpec | undefined, locale: AppShellLocale | undefined, done: (outcome: 'sent' | 'drafted') => void): Voice {
  const message = useVoiceMessage({ controller: agent?.controller, config: agent?.voice?.send === 'message' ? agent.voice : undefined, attachments: agent?.chatProps?.attachments, labels: chatTextFor(agent?.chatProps?.locale ?? locale).labels, admitted: () => done('sent') });
  const voice = useDictation({
    transcribe: agent?.voice?.send === 'message' ? undefined : agent?.voice?.transcribe,
    locale: agent?.chatProps?.locale ?? locale,
    onText: async (spoken, signal) => {
      if (!agent || signal.aborted) return;
      const fill = () => {
        if (signal.aborted) return;
        const draft = agent.controller.getSnapshot().draft.text;
        agent.controller.setText(appendToDraft(draft, spoken));
        done('drafted');
      };
      if (agent.voice?.send !== 'auto') { fill(); return; }
      const draft = agent.controller.getSnapshot().draft.text;
      const paths = mentionedPaths(draft);
      agent.controller.setText(withoutMentions(draft));
      try {
        const sent = await agent.controller.send(undefined, { text: [...paths.map(mentionToken), spoken].join(' '), restore: { text: spoken } });
        if (!signal.aborted) done(sent ? 'sent' : 'drafted');
      } catch { fill(); }
    },
  });
  const { cancel } = voice;
  const controller = agent?.controller, send = agent?.voice?.send, hasVoice = Boolean(agent?.voice);
  useEffect(() => () => cancel(), [controller, send, hasVoice, cancel]);
  const phase: Dictation['phase'] = message.phase === 'starting' || message.phase === 'recording' ? message.phase : message.phase === 'processing' || message.phase === 'sending' ? 'transcribing' : 'idle';
  return agent?.voice?.send === 'message' ? { ...message, phase, levels: message.levels ?? [], paused: message.paused ?? false, pause: message.pause, resume: message.resume } : voice;
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
export function AgentLayerProvider({ agent: own, improve, locale, agentLink, children }: { readonly agent?: AgentSpec | undefined; readonly improve?: AgentSpec | undefined; readonly locale?: AppShellLocale | undefined; readonly agentLink?: false | undefined; readonly children: ReactNode }): ReactElement {
  const compact = useIsMobile();
  const expanded = !compact;
  const [snap, setSnapState] = useState<Snap>('closed');
  const [dockFloating, setDockFloating] = useState(false);
  // A screen may lend the layer its assistant (`useAgentLoan`); the shell's own `agent` always wins.
  const [lent, setLent] = useState<AgentSpec | undefined>();
  const agent = own ?? lent;
  const [shown, setShown] = useState<Which>(agent ? 'agent' : 'improve');
  const probe = useRef<HTMLDivElement>(null);
  const { peekPoint, tabbar } = useMeasuredPeek(probe);
  const triggerUntil = useRef(0);
  const restoreFocus = useRef(false);
  const [side, setSideState] = useState<DockSide>('right');
  // The side is the viewer's, remembered beside the Dock's own placement; read after mount so server and client markup agree.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only after mount; reading it before paint keeps server and client markup equal without a flash
  useLayoutEffect(() => { try { const saved = globalThis.localStorage?.getItem(SIDE_KEY); if (saved === 'left' || saved === 'right') setSideState(saved); } catch { /* a convenience */ } }, []);
  const setSide = useCallback((next: DockSide) => { setSideState(next); try { globalThis.localStorage?.setItem(SIDE_KEY, next); } catch { /* a convenience */ } }, []);
  const specs = useRef({ agent, improve, snap, shown });
  // eslint-disable-next-line react-hooks/refs -- latest-value ref: open/lend/showAgent may be called from a child's layout effect, before this component's own effects run
  specs.current = { agent, improve, snap, shown };
  const lentRef = useRef<AgentSpec | undefined>(undefined);

  const setSnap = useCallback((next: Snap) => setSnapState(next), []);
  const close = useCallback(() => setSnapState('closed'), []);
  // One full-screen layer at a time: opening the agent or product manager closes a view of the app (`useShellLayer`), and a view closes these.
  useEffect(() => registerAgentLayerCloser(close), [close]);
  const open = useCallback((which?: Which, at: 'peek' | 'half' | 'full' = 'half') => {
    const { agent: a, improve: i } = specs.current;
    const target = which ?? (a ? 'agent' : 'improve');
    if (target === 'agent' ? !a : !i) return;
    closeShellLayer();
    setShown(target);
    setSnapState(at === 'peek' && target !== 'agent' ? 'half' : at);
  }, []);
  const lend = useCallback((spec: AgentSpec | undefined, at?: 'peek' | 'half' | 'full') => {
    if (specs.current.agent && specs.current.agent !== lentRef.current) return;
    lentRef.current = spec;
    setLent(spec);
    if (spec && at) { closeShellLayer(); setShown('agent'); setSnapState(at); }
  }, []);
  const loan = useMemo<LoanContextValue>(() => ({ available: !own, lend, compact }), [own, lend, compact]);
  const showAgent = useCallback(() => { if (specs.current.agent) setShown('agent'); }, []);

  // A spec that goes away takes the layer with it.
  const shownSpec = shown === 'agent' ? agent : improve;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- closes the layer once after its spec goes away; the guard (!shownSpec) settles after one pass
  useEffect(() => { if (!shownSpec) { setSnapState('closed'); if (shown === 'improve' && agent) setShown('agent'); else if (shown === 'agent' && improve) setShown('improve'); } }, [shownSpec, shown, agent, improve]);

  // The chats live in one element that is moved into the open drawer or panel; React keeps them mounted (and so their presentation state
  // and uploads) while the layer is closed, on a phone and on a wide screen. Nothing is mounted before the layer is first opened.
  const [host] = useState(() => typeof document === 'undefined' ? null : Object.assign(document.createElement('div'), { className: 'flex min-h-0 flex-1 flex-col [&_[data-boring=pi-chat]>header]:hidden' }));
  const opened = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- a monotonic "ever opened" latch for this render: no re-render, no setState during render
  if (snap !== 'closed') opened.current = true;

  // Consume the launch URL before an open layer pushes its Back entry. Keep the parsed request through StrictMode's effect replay.
  const launch = useRef<ReturnType<typeof parseAgentLink> | undefined>(undefined);
  const [firstAgentLink] = useState(agentLink);
  useEffect(() => {
    if (launch.current === undefined) {
      launch.current = firstAgentLink === false ? null : parseAgentLink(window.location.search);
      if (firstAgentLink !== false) {
        const url = new URL(window.location.href);
        if (['agent', 'open', 'input'].some(key => url.searchParams.has(key))) {
          for (const key of ['agent', 'open', 'input']) url.searchParams.delete(key);
          history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
        }
      }
    }
    const link = launch.current;
    if (!link) return;
    const which = link.agent === 'improve' ? 'improve' : 'agent';
    open(which, link.open);
    const spec = specs.current[which];
    if (link.input !== 'text' || !spec) return;
    // The drawer's slide and initial focus finish first. Voice deliberately leaves focus off the composer and never calls start().
    const timer = setTimeout(() => {
      const current = specs.current;
      if (current.snap !== 'closed' && current.shown === which && current[which]?.controller === spec.controller) {
        host?.querySelector<HTMLElement>(`[data-spec=${which}] [data-testid=composer-input]`)?.focus({ preventScroll: true });
      }
    }, 520);
    return () => clearTimeout(timer);
  }, [host, open, firstAgentLink]);

  const voice = useVoice(agent, locale, outcome => {
    if (outcome === 'drafted') { setShown('agent'); setSnapState('half'); }
  });
  const [talkRecording, setTalkRecording] = useState(false);
  const cancelTalkRecording = useCallback(() => {
    if (talkRecording && (voice.phase === 'starting' || voice.phase === 'recording')) voice.cancel();
  }, [talkRecording, voice]);
  useRecordingCancellation(cancelTalkRecording);
  const previousTalk = useRef<{ controller: NativeChatController; path: string } | undefined>(undefined);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(focusTimer.current), [agent?.controller]);
  const talkAbout = useCallback<AgentLayerApi['talkAbout']>((token, options = {}) => {
    const selected = specs.current.agent;
    if (!selected) return false;
    clearTimeout(focusTimer.current);
    const parsed = pieces(token, { mentions: true, skills: [] });
    if (parsed.length !== 1 || parsed[0]?.kind !== 'mention') throw new TypeError('talkAbout requires one @mention token');
    const path = parsed[0].value!;
    const before = previousTalk.current;
    const draft = selected.controller.getSnapshot().draft.text;
    const text = before?.controller === selected.controller ? removeMention(draft, before.path) : draft;
    selected.controller.setText(`${appendToDraft(text, mentionToken(path))} `);
    previousTalk.current = { controller: selected.controller, path };
    open('agent', options.at ?? 'half');
    if (options.voice && selected.voice) {
      setTalkRecording(true);
      // No await or effect: permission belongs to the caller's click or swipe release, even before the chat mounts.
      voice.start();
    } else {
      focusTimer.current = setTimeout(() => {
        if (specs.current.agent?.controller === selected.controller && specs.current.snap !== 'closed' && specs.current.shown === 'agent') host?.querySelector<HTMLElement>('[data-spec=agent] [data-testid=composer-input]')?.focus({ preventScroll: true });
      }, 520);
    }
    return true;
  }, [open, voice, host]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a completed or refused capture resets this gesture's presentation once
  useEffect(() => { if (voice.phase === 'idle') setTalkRecording(false); }, [voice.phase]);
  const revealedFailures = useRef(new Set<number>());
  const voiceSend = agent?.voice?.send, pendingKey = voice.pending?.map(item => `${item.id}:${item.phase}`).join(',');
  useEffect(() => {
    const failure = voice.pending?.findLast(item => item.phase === 'transcribe-failed' || item.phase === 'upload-failed' || item.phase === 'blocked' || item.phase === 'unconfirmed');
    const captureProblem = voiceSend === 'message' && voice.problem;
    const failureId = captureProblem ? voice.captureSequence : failure?.id;
    if (failureId === undefined) { revealedFailures.current.clear(); return; }
    if (revealedFailures.current.has(failureId)) return;
    revealedFailures.current.add(failureId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reveals a new voice failure once per failure id (the ref guards repeats), so it settles after one pass
    if (!expanded && shown === 'agent' && snap === 'peek') setSnapState('half');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a pending item's id or phase changes (pendingKey), not on every new pending array
  }, [expanded, shown, snap, voiceSend, voice.captureSequence, voice.problem, pendingKey]);

  const state: AgentLayerState = snap === 'closed' ? 'closed' : expanded ? 'open' : snap;
  const value = useMemo<Internal>(() => ({
    state, showing: snap === 'closed' ? null : shown, open, close, talkAbout, talkRecording, expanded, agent, improve, snap, setSnap, dockFloating, setDockFloating, showAgent, triggerUntil, voice, peekPoint, tabbar, host, locale, side, setSide, restoreFocus,
  }), [state, snap, shown, open, close, talkAbout, talkRecording, expanded, agent, improve, setSnap, dockFloating, showAgent, triggerUntil, voice, peekPoint, tabbar, host, locale, side, setSide]);

  // The shell's z-scale (tabs 20, peek 30, drawer and panel 40, other sheets 50, point bar 60) as custom properties; `display: contents` keeps the box tree unchanged.
  const scale = { '--app-shell-z-tabs': Z.tabs, '--app-shell-z-peek': Z.peek, '--app-shell-z-layer': Z.layer, '--app-shell-z-sheet': Z.sheet, '--app-shell-z-point': Z.point } as CSSProperties;
  return <AgentContextProvider>
    <LayerContext.Provider value={value}><LoanContext.Provider value={loan}>
      <div data-app-shell="" className="contents" style={scale}>
        <div ref={probe} aria-hidden="true" className="pointer-events-none invisible fixed top-0 left-0 w-0" style={{ height: 'var(--app-shell-tabbar, 0px)' }} />
        {children}
        {/* eslint-disable-next-line react-hooks/refs -- reads the "ever opened" latch set above in this same render */}
        {host && opened.current && createPortal(<Chats showing={shown} />, host)}
      </div>
    </LoanContext.Provider></LayerContext.Provider>
  </AgentContextProvider>;
}

/** The header button that opens the layer: a tap opens half; with `agent.voice`, press and hold records and a slide off cancels. Absent without `agent`. */
export function AgentTrigger({ className, children }: { readonly className?: string; readonly children?: ReactNode }) {
  const layer = useInternal();
  const { agent, voice } = layer;
  const text = appShellText(agent?.chatProps?.locale ?? layer.locale);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; held: boolean; id: number } | null>(null);
  const voiceRef = useRef(voice);
  useLayoutEffect(() => { voiceRef.current = voice; });
  const cancelHold = useCallback(() => {
    const current = hold.current;
    hold.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    if (current.held) voiceRef.current.cancel();
  }, []);
  useRecordingCancellation(cancelHold);
  const controller = agent?.controller;
  useEffect(() => () => cancelHold(), [controller, cancelHold]);
  const { triggerUntil: triggerUntilRef } = layer;
  if (!agent) return null;

  const toggle = () => {
    triggerUntilRef.current = Date.now() + 500;
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
  const name = agent.label ?? text.open;
  const Icon = agent.icon;
  return <Button variant="ghost" size="icon" data-agent-trigger="" data-testid="agent-trigger" aria-label={name} title={name} aria-expanded={layer.state !== 'closed'}
    onPointerDown={down} onPointerUp={release} onPointerCancel={release} onPointerMove={move} onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0) toggle(); }}
    className={cn('touch-none', className)}>
    {children ?? (Icon ? <Icon className="size-5" /> : <SparklesIcon data-icon="inline-start" aria-hidden="true" />)}
  </Button>;
}

/** Tap to start; while active, this same control is the composer's replacement recording row. */
function TalkButton() {
  const { voice } = useInternal();
  const busy = voice.phase === 'transcribing';
  return <VoiceMessageButton testId="agent-talk" disabled={busy || (voice.phase === 'idle' && voice.canStart === false)} voice={{
    ...voice, phase: busy ? 'processing' : voice.phase, canStart: voice.canStart !== false,
    pending: voice.pending ?? [], captureSequence: voice.captureSequence ?? 0,
  }} />;
}

/** What went wrong with the microphone, in the flow under the title row (never over the messages). */
function VoiceProblem() {
  const { voice } = useInternal();
  return voice.problem ? <p role="alert" data-testid="agent-voice-problem" className="m-0 shrink-0 px-3 pb-1 text-xs leading-4 text-destructive">{voice.problem}</p> : null;
}

/** One agent's PiChat. It stays mounted while hidden, so its scroll, focus and drafts survive a swap with the other spec. */
function SpecChat({ spec, visible, role }: { readonly spec: AgentSpec; readonly visible: boolean; readonly role: Which }) {
  const layer = useInternal();
  const locale = spec.chatProps?.locale ?? layer.locale;
  // One annotate toggle: pins on desktop, point mode (which hides the layer while the person taps the app) on touch and compact screens.
  const feedback = useComposerFeedback(spec.feedback);
  const pointing = usePointing(spec.feedback);
  // The pin's mic uses the shell's transcription: this agent's own, else the coach's.
  const transcribe = (spec.voice ?? layer.agent?.voice)?.transcribe;
  const fr = locale === 'fr';
  return <div data-spec={role} hidden={!visible} className={cn('min-h-0 min-w-0 flex-1', visible ? 'flex flex-col' : 'hidden')}>
    <PiChat {...withChatPlugins(spec.chatProps ?? {})} {...(locale ? { locale } : {})} controller={spec.controller} keyboardInset={false} placement={layer.expanded && !layer.dockFloating ? 'docked' : 'floating'} {...(feedback ? { feedback } : {})}
      {...(role === 'agent' && spec.voice ? { voiceMessage: { transcribe: spec.voice.transcribe, Bubble: PendingVoiceBubble }, tools: <>{spec.chatProps?.tools}<TalkButton /></>, composerRecording: layer.voice.phase === 'starting' || layer.voice.phase === 'recording' ? <TalkButton /> : undefined, pendingVoice: layer.voice.pending } : {})} />
    {/* The note editor of ordinary feedback lives inside the layer, in the modal's focus tree; while pointing the layer steps aside and AgentLayer renders it. */}
    {/* In the flow, inside the visible content box: the popup is transformed (a fixed element would be placed against its off-screen bottom). */}
    {spec.feedback && visible && !pointing && <div className="shrink-0 px-2 pb-2 empty:hidden">
      <NoteBubble session={spec.feedback} {...(transcribe ? { transcribe } : {})} {...(fr ? { labels: feedbackLabelsFr } : {})} /></div>}
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
  // eslint-disable-next-line react-hooks/refs -- a monotonic "ever shown" set filled during render: no setState, no re-render
  seen.current.add(showing);
  // eslint-disable-next-line react-hooks/refs -- reads the "ever shown" set filled above in this same render
  const seenAgent = seen.current.has('agent'), seenImprove = seen.current.has('improve');
  return <>
    {agent && seenAgent && <SpecChat spec={agent} visible={showing === 'agent'} role="agent" />}
    {improve && seenImprove && <SpecChat spec={improve} visible={showing === 'improve'} role="improve" />}
  </>;
}

/** Title row: « ← » when the improve view has an agent to go back to, the title, then Expand or Collapse (compact only), the dock controls (expanded only) and Close. */
function Header({ text, title, compactSnap, closeRef, controls, className, ...rest }: { readonly text: AppShellText; readonly title: string; readonly compactSnap?: Snap; readonly closeRef?: Ref<HTMLButtonElement>; readonly controls?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  const layer = useInternal();
  const back = layer.showing === 'improve' && layer.agent;
  const actions = (layer.showing === 'improve' ? layer.improve : layer.agent)?.headerActions ?? [];
  return <div data-testid="agent-layer-header" {...rest} className={cn('flex shrink-0 items-center gap-1 px-2 pb-1', className)}>
    {back && <Button variant="ghost" size="icon" data-testid="agent-layer-back" aria-label={text.back} title={text.back} onClick={layer.showAgent}><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    <h2 data-testid="agent-layer-title" className="m-0 min-w-0 flex-1 truncate px-1 text-sm font-semibold">{title}</h2>
    {actions.length > 0 && <HeaderActions actions={actions} compact={compactSnap !== undefined} text={text} prefix="agent-layer" run={id => actions.find(action => action.id === id)?.onSelect()} />}
    {compactSnap === 'half' && <Button variant="ghost" size="icon" data-testid="agent-layer-expand" aria-label={text.expand} title={text.expand} onClick={() => layer.setSnap('full')}><ChevronUpIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    {compactSnap === 'full' && <Button variant="ghost" size="icon" data-testid="agent-layer-collapse" aria-label={text.collapse} title={text.collapse} onClick={() => layer.setSnap('half')}><ChevronDownIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    {controls}
    <Button variant="ghost" size="icon" ref={closeRef} data-testid="agent-layer-close" aria-label={text.close} title={text.close} onClick={layer.close}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
  </div>;
}

function useTitle(): { text: AppShellText; title: string } {
  const layer = useInternal();
  const spec = layer.showing === 'improve' ? layer.improve : layer.agent;
  const text = appShellText(spec?.chatProps?.locale ?? layer.locale);
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
  const liveViewport = useVisualViewport();
  const closeRef = useRef<HTMLButtonElement>(null);
  const vetoed = useRef(false);
  // Set while the layer closes; cleared when it opens again (a close is final until the trigger or a choice opens the layer).
  const closing = useRef(false);
  useEffect(() => { if (snap !== 'closed') closing.current = false; }, [snap]);
  const open = snap !== 'closed' && !pointing;
  const peek = snap === 'peek';
  const points = useMemo(() => hasPeek ? [layer.peekPoint, HALF, FULL] : [HALF, FULL], [hasPeek, layer.peekPoint]);
  const value = peek ? layer.peekPoint : snap === 'full' ? FULL : HALF;
  const recording = voice.phase !== 'idle';
  // While the person talks the sheet holds still: the viewport height and the keyboard inset are pinned at what they were when the recording
  // began, the composer takes no focus and no keyboard, so nothing moves under the finger on the microphone.
  const sheet = useRef<HTMLDivElement>(null);
  const idleViewport = useRef(liveViewport);
  // eslint-disable-next-line react-hooks/refs -- ref cache: the last viewport seen while not recording, pinned during a recording; no setState during render
  if (!recording) idleViewport.current = liveViewport;
  // eslint-disable-next-line react-hooks/refs -- reads the pinned viewport cached above in this same render
  const vv = recording ? idleViewport.current : liveViewport;
  const [pinnedBottom, setPinnedBottom] = useState<string | undefined>();
  useLayoutEffect(() => {
    const popup = sheet.current?.closest('[data-slot=drawer-popup]');
    if (!recording || !sheet.current) return;
    if (popup) setPinnedBottom(getComputedStyle(popup).bottom);
    const inputs = [...sheet.current.querySelectorAll<HTMLTextAreaElement>('[data-testid=composer-input]')].map(input => ({ input, mode: input.getAttribute('inputmode'), readOnly: input.readOnly }));
    for (const { input } of inputs) { input.readOnly = true; input.setAttribute('inputmode', 'none'); }
    return () => {
      setPinnedBottom(undefined);
      for (const { input, mode, readOnly } of inputs) { input.readOnly = readOnly; if (mode === null) input.removeAttribute('inputmode'); else input.setAttribute('inputmode', mode); }
    };
  }, [recording]);

  useBackLayer(snap === 'half' || snap === 'full', layer.close, 'agent');

  // The popup is taller than what shows and slides down by `--drawer-snap-point-offset` (a registered, non-inheriting property, so only the
  // popup itself can read it): padding the popup by that offset makes its content box exactly the visible part. At peek the tab bar below is left out too.
  // The popup is portalled to the body, outside the shell root: it is given the measured tab bar height and the z-values explicitly.
  const style = { '--app-shell-vv-height': vv ? `${vv.height}px` : '100dvh', '--app-shell-tabbar': `${layer.tabbar}px`, '--app-shell-peek-height': `${PEEK_REM}rem`, '--app-shell-z-layer': Z.layer,
    paddingBottom: peek ? 'calc(var(--drawer-snap-point-offset, 0px) + var(--app-shell-tabbar, 0px))' : 'var(--drawer-snap-point-offset, 0px)',
    ...(pinnedBottom ? { bottom: pinnedBottom } : {}) } as CSSProperties;
  // Entering the modal half or full from the non-modal peek does not rerun Base UI's initial focus: if focus is still on the page, take it to Close.
  const wasPeek = useRef(false);
  useEffect(() => {
    const entering = wasPeek.current && !peek && open;
    wasPeek.current = peek;
    if (!entering) return;
    // The element that held focus when the sheet left peek (a page control now behind the modal). Base UI re-applies its modal guards as the
    // sheet moves, so retake focus once they have settled and again after the slide, but only while focus is still stranded there (or lost to the body).
    const stranded = document.activeElement;
    const take = () => {
      const popup = closeRef.current?.closest('[data-slot=drawer-popup]');
      const active = document.activeElement;
      // Still stranded, or dropped to the body by the modal guards: retake. Focus that went anywhere else is the person's and is left alone.
      if (popup && (active === stranded || active === document.body || active === null) && !popup.contains(active)) closeRef.current?.focus({ preventScroll: true });
    };
    const early = setTimeout(take, 60), late = setTimeout(take, 520);
    return () => { clearTimeout(early); clearTimeout(late); };
  }, [peek, open]);
  return <Drawer open={open} modal={!peek} showSwipeHandle swipeDirection="down" snapPoints={points} snapPoint={value}
    onOpenChange={(next, details) => {
      if (next) return;
      if (isOverlayEvent(details)) { details.cancel(); return; }
      const outcome = nextSnapOnClose(details.reason, hasPeek);
      if (outcome === 'close') { closing.current = true; layer.close(); return; }
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
      // Base UI also reports the first snap point (peek) as the drawer closes: that echo must not reopen the layer.
      if (vetoed.current || closing.current) return;
      const next = toSnap(point, layer.peekPoint);
      if (next && (next !== 'peek' || hasPeek)) layer.setSnap(next);
    }}>
    <DrawerContent data-testid="agent-layer" aria-label={title} data-state={snap} data-peek={peek} initialFocus={() => closeRef.current ?? false} style={style}
      className={cn('app-shell box-border z-(--app-shell-z-layer) data-[swipe-direction=down]:bottom-(--drawer-keyboard-inset,0px) data-[swipe-axis=y]:[--drawer-content-max-height:calc(var(--app-shell-vv-height,100dvh)-1.5rem)]',
        // The peek is the top PEEK_REM of the popup; the part that overlaps the tab bar is clipped away, so the tabs stay visible and tappable.
        'data-[peek=true]:not-data-swiping:[clip-path:inset(0_0_calc(100%_-_var(--app-shell-peek-height))_0)]')}>
      <BaseDrawerParts.Drawer.VirtualKeyboardProvider>
        <div ref={sheet} data-testid="agent-layer-sheet" onFocusCapture={event => { if (!recording && (event.target as HTMLElement).matches('[data-testid=composer-input]')) layer.setSnap('full'); }}
          className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden overscroll-contain',
            // The layer's own header carries the title and Close, so the chat's is hidden. At peek: one line of the last reply above the
            // composer, no empty-state overlay, room for Close.
            '[&_[data-boring=pi-chat]>header]:hidden',
            // At peek: ONE compact row (a one-line input, the microphone and Send; the other composer controls wait for half), and the last
            // reply as a single truncated line above it.
            peek && ['[&_[data-boring=pi-chat]>.relative]:overflow-hidden [&_[data-boring=pi-chat]>.relative>.pointer-events-none]:hidden',
              '[&_[data-boring=pi-chat]>footer]:px-2 [&_[data-boring=pi-chat]>footer]:pt-1 [&_[data-boring=pi-chat]>footer]:pb-2',
              '[&_[data-testid=transcript]]:gap-0 [&_[data-testid=transcript]]:p-0 [&_[data-testid=transcript]]:px-3 [&_[data-testid=transcript]>*]:max-h-5 [&_[data-testid=transcript]>*]:truncate [&_[data-testid=transcript]_button]:hidden',
              '[&_[data-testid=composer]_[data-slot=input-group]]:flex-row! [&_[data-testid=composer]_[data-slot=input-group]]:items-center',
              '[&_[data-testid=composer-input]]:min-h-11 [&_[data-testid=composer-input]]:max-h-11 [&_[data-testid=composer-input]]:flex-1 [&_[data-testid=composer-input]]:px-4 [&_[data-testid=composer-input]]:py-2.5',
              voice.phase !== 'starting' && voice.phase !== 'recording' && '[&_[data-testid=composer-controls]]:w-auto [&_[data-testid=composer-controls]]:shrink-0 [&_[data-testid=composer-controls]]:py-0 [&_[data-testid=composer-controls]>span.flex-1]:hidden',
              '[&_[data-testid=composer-plus]]:hidden [&_[data-testid=composer-annotate]]:hidden'])}>
          {!peek && <Header text={text} title={title} compactSnap={snap} closeRef={closeRef} />}
          {!peek && <VoiceProblem />}
          {peek && recording && <div aria-hidden="true" data-testid="agent-listening" data-phase={voice.phase} className="sr-only">
            <MicIcon className="size-4 text-destructive" aria-hidden="true" />{voice.phase === 'transcribing' ? <><Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{voiceClock(voice.seconds)}</> : `${text.listening} ${voiceClock(voice.seconds)}`}
          </div>}
          {/* The transcript scrolls and never drags the sheet: only the handle and the title row swipe. */}
          <div data-base-ui-swipe-ignore="" className="flex min-h-0 flex-1 flex-col"><ChatSlot /></div>
        </div>
      </BaseDrawerParts.Drawer.VirtualKeyboardProvider>
    </DrawerContent>
  </Drawer>;
}

/** The panel inside the dock: the same element docked or floating, so a placement change keeps focus and the chats where they are. */
function DockPanel({ api, side }: { readonly api: DockApi; readonly side: DockSide }) {
  const layer = useInternal();
  const { text, title } = useTitle();
  const open = layer.snap !== 'closed';
  const floating = api.floating;
  // The chats report this as their placement: the phone drawer and the floating panel are `floating`, the dock is `docked`.
  const { setDockFloating } = layer;
  useLayoutEffect(() => { setDockFloating(floating); return () => setDockFloating(false); }, [floating, setDockFloating]);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) layer.close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, layer]);
  // A dock control (or the divider's Alt+Arrow) moves or removes the element that had focus: it goes to the panel's first dock control instead of the page.
  const { restoreFocus: restoreFocusRef } = layer;
  const openRef = useRef(open);
  useLayoutEffect(() => { openRef.current = open; });
  useLayoutEffect(() => {
    const lost = !document.activeElement || document.activeElement === document.body;
    const wanted = restoreFocusRef.current || (openRef.current && lost && api.placement !== 'closed');
    restoreFocusRef.current = false;
    if (wanted) box.current?.querySelector<HTMLElement>('[data-dock-control]')?.focus({ preventScroll: true });
  }, [api.placement, side, restoreFocusRef]);
  const drag = useDraggable({ box, position: open ? pos : null, onPositionChange: setPos, enabled: floating });
  const act = (run: () => void) => () => { restoreFocusRef.current = true; run(); };
  const control = (id: string, label: string, Icon: ComponentType<{ className?: string }>, run: () => void) =>
    <Button variant="ghost" size="icon" key={id} data-testid={`agent-layer-${id}`} data-dock-control="" aria-label={label} title={label} onClick={act(run)}><Icon data-icon="inline-start" aria-hidden="true" /></Button>;
  const controls = <>
    {!floating && control('float', text.float, PictureInPicture2Icon, () => api.float())}
    {(floating || side === 'right') && control('dock-left', text.dockLeft, PanelLeftIcon, () => { layer.setSide('left'); api.dock(); })}
    {(floating || side === 'left') && control('dock-right', text.dockRight, PanelRightIcon, () => { layer.setSide('right'); api.dock(); })}
  </>;
  // Floating, the host's Card is drawn behind the layer (a sibling layer, so docking or floating never remounts the chat).
  return <div ref={box} data-testid="agent-layer" data-state={open ? 'open' : 'closed'} data-placement={api.placement} data-side={side} role={floating ? 'dialog' : 'complementary'} aria-label={title}
    style={floating ? pos ?? { right: 16, bottom: 16 } : undefined}
    className={cn('app-shell relative flex min-h-0 flex-col',
      floating ? 'fixed isolate z-(--app-shell-z-layer) h-[min(36rem,calc(100dvh-2rem))] w-[min(24rem,calc(100vw-2rem))]'
        : 'h-full min-w-0 flex-1 bg-background text-foreground')}>
    {floating && <Card aria-hidden="true" data-boring="chrome" className="pointer-events-none absolute inset-0 -z-10" />}
    {!floating && <Separator orientation="vertical" className={cn('absolute inset-y-0', side === 'right' ? 'left-0' : 'right-0')} />}
    <Header text={text} title={title} controls={controls} className={cn('pt-2', floating && 'cursor-move touch-none select-none')} {...drag} />
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><VoiceProblem /><ChatSlot /></div>
  </div>;
}

function AgentDock({ side }: { readonly side: DockSide }) {
  const layer = useInternal();
  const { title } = useTitle();
  return <Dock id="agent" side={side} floatable defaultWidth={384} minWidth={320} dragBelow={260} open={layer.snap !== 'closed'} onOpenChange={next => { if (!next) layer.close(); }} labels={{ region: title }}>
    {api => <DockPanel api={api} side={side} />}
  </Dock>;
}

/**
 * Wraps the app's content (placed once by the shell): on a wide screen the agent dock sits on its left or right and the content reflows,
 * or it floats over the content; on a phone this is only the content (the layer is the bottom drawer). Host concern: Pi has no layout.
 */
export function AgentDockLayout({ children }: { readonly children: ReactNode }): ReactElement {
  const layer = useInternal();
  const dock = layer.expanded && (layer.agent || layer.improve) ? <AgentDock side={layer.side} /> : null;
  return <DockLayout storageKey={DOCK_KEY} persist="local">
    {layer.side === 'left' && dock}
    <DockMain>{children}</DockMain>
    {layer.side === 'right' && dock}
  </DockLayout>;
}

/** The layer itself: the drawer on a phone (the wide dock is `AgentDockLayout`). Placed once by the shell, for point mode on both. */
export function AgentLayer(): ReactElement | null {
  const layer = useInternal();
  const pointingAgent = usePointing(layer.agent?.feedback), pointingImprove = usePointing(layer.improve?.feedback);
  const session = pointingAgent ? layer.agent?.feedback : pointingImprove ? layer.improve?.feedback : undefined;
  const commentingAgent = useCommenting(layer.agent?.feedback), commentingImprove = useCommenting(layer.improve?.feedback);
  const commenting = commentingAgent ? layer.agent?.feedback : commentingImprove ? layer.improve?.feedback : undefined;
  // Back ends pointing first (the `point` priority), like Done: the notes wait for the next message. The layer keeps its own history entry underneath.
  useBackLayer(session !== undefined, () => { void session?.done(); }, 'point');
  if (!layer.agent && !layer.improve) return null;
  const pointed = pointingAgent || commentingAgent ? layer.agent : layer.improve;
  const transcribe = (pointed?.voice ?? layer.agent?.voice)?.transcribe;
  const locale = pointed?.chatProps?.locale ?? layer.locale;
  // Comment mode shows its banner either way: on a phone (point mode) above the tab bar, outside the layer, while the compact sheet steps
  // aside; on a wide screen at the top, the dock beside the app. The note bubble is here only while pointing (else inside the layer).
  return <>
    {!layer.expanded && <CompactSheet pointing={session !== undefined} />}
    {commenting && <CommentBanner session={commenting} bottomOffset={`${layer.tabbar}px`} className="z-[60]" {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />}
    {session && <NoteBubble session={session} {...(transcribe ? { transcribe } : {})} {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />}
  </>;
}

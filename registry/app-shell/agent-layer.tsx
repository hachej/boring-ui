'use client';

// The AgentLayer: ONE agent's PiChat above the app. Compact (below 768px): a bottom drawer with three fixed snap points, peek, half and
// full (shadcn `drawer`, Base UI variant). Expanded: a `Dock` (the `dock` item) beside the app, docked on the left or the right (default right)
// or floating over it; the person chooses and the choice is remembered. The same layer shows
// the product manager (« Améliorer l'app ») when the account menu asks for it. One of the two at a time on a phone and on a screen too
// narrow for both (below `TOGETHER_FROM`): opening one closes the other. From `TOGETHER_FROM` up the PM column opens beside the dock, each
// closes on its own, and the shell's closer closes both. Push-to-talk is an option of the agent.
// Host concern: Pi has no layout. The chat is the borrowed NativeChatController rendered by PiChat; the screen context travels as the
// submit's `context` (agent-context.ts). Nothing here is configurable beyond AgentSpec.
import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, HTMLAttributes, PointerEvent as ReactPointerEvent, ReactElement, ReactNode, Ref, RefObject } from 'react';
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, FileTextIcon, LibraryIcon, Loader2Icon, MicIcon, PanelBottomIcon, PanelLeftIcon, PanelRightIcon, PictureInPicture2Icon, SparklesIcon, XIcon } from '../_shared/icons';
// Behaviour only: Base UI's keyboard-inset provider for the host drawer's content. It renders nothing visible.
import * as BaseDrawerParts from '@base-ui/react/drawer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import type { FeedbackSession } from '@hachej/boring-feedback/ui';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { useChatVoice } from '@hachej/boring-ui-kit/chat-react/voice';
import type { ChatVoiceHandle as Voice } from '@hachej/boring-ui-kit/chat-react/voice';
import { MENTION_TOKEN, appendToDraft, mentionToken, pieces, removeMention } from '@hachej/boring-ui-kit/chat-text';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { useMedia, usePhone } from '../utils/use-media';
import { Dock, DockLayout, DockMain } from '../dock/dock';
import { useDraggable } from '../utils/use-draggable';
import type { DockApi } from '../dock/dock';
import { PiChat } from '../pi-chat/pi-chat';
import type { PiChatProps } from '../pi-chat/pi-chat';
import type { VoiceMessageConfig } from '../pi-chat/config';
import { useRecordingCancellation } from '../pi-chat-voice/use-hold-to-record';
import { voiceClock } from '../pi-chat/config';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';
import { PendingVoiceBubble, VoiceMessageButton } from '../pi-chat-voice/voice-message';
import { chatTextFor } from '../pi-chat/locale';
import { NoteBubble, useComposerFeedback } from '../feedback/feedback-session';
import { feedbackLabelsFr } from '../feedback/feedback-labels';
import { sentFeedbackContent } from '../feedback/sent-content';
import { CommentBanner, useCommenting, usePointing } from '../feedback/point-mode';
import { cn } from '../utils/utils';
import { useAgentBarChat } from '../agent-bar/use-agent-bar-chat';
import type { AgentBarChat } from '../agent-bar/use-agent-bar-chat';
import { useBackLayer } from '../utils/back';
import { parseAgentLink } from './agent-link';
import { sidebarKey } from './sidebar-resize';
import { closeShellLayer, registerAgentLayerCloser } from './shell-layer';
import { appShellText } from './text';
import type { AppShellLocale, AppShellText } from './text';
import { useVisualViewport } from './use-visual-viewport';
import { AgentContextProvider } from './agent-context';
import type { ShellPanel } from './shell-panel';
import { HeaderActions } from './header-actions';
import type { ScreenHeaderAction } from './header-actions';

export interface AgentSpec {
  readonly controller: NativeChatController;
  /** The agent's name in the expanded sidebar and the header trigger's accessible name (default: the chat's title, then « Assistant »). */
  readonly label?: string;
  /** The agent's icon in the sidebar and the header trigger (default: sparkles). */
  readonly icon?: ComponentType<{ className?: string }>;
  readonly chatProps?: Omit<PiChatProps, 'controller'>;
  /** Push-to-talk. `message` retains audio plus transcript; `auto` sends text only; `draft` (default) fills the composer. */
  readonly voice?: VoiceMessageConfig & { readonly send?: 'auto' | 'draft' | 'message' };
  /** The pointing tool, from the `feedback` item: the composer's annotate toggle and point mode on the app's surface. */
  readonly feedback?: FeedbackSession;
  /** Host actions in the layer's title row (before the dock controls, or the snap and close controls when compact), as the screen header's. Two shown, the rest in « … ». Not at peek. */
  readonly headerActions?: readonly ScreenHeaderAction[];
  /**
   * `composer="bar"` (D-2198): the app's library, the same shape as the workspace bar's `library`: the app renders its file navigator (for example
   * the kit's `FileTreeView`) and calls `onPicked` once a file is chosen. « Bibliothèque » in the assistant's header and in a preview's header opens it
   * in the right pane, by the preview's rules (over the docked conversation, or the right column); the file the app then opens with
   * `useAgentLayer().preview` takes its place.
   */
  readonly library?: ((onPicked: () => void) => ReactNode) | undefined;
}

/** Compact: closed, peek, half or full. Expanded: closed or open. */
export type AgentLayerState = 'closed' | 'peek' | 'half' | 'full' | 'open';
type Which = 'agent' | 'improve';
type Snap = 'closed' | 'peek' | 'half' | 'full';

export interface AgentLayerApi {
  readonly agent: NativeChatController | undefined;
  readonly state: AgentLayerState;
  readonly showing: Which | null;
  /** Opens the assistant or the PM. Below `TOGETHER_FROM` (and on a phone) it closes the other; from it, the PM opens beside the assistant. */
  open(which?: Which, at?: 'peek' | 'half' | 'full'): void;
  /** Closes what `showing` names: with both open, the assistant (a second call closes the PM). */
  close(): void;
  /** Open the real chat with one card mention. Call directly from a click or swipe release to grant microphone permission. False without an agent. */
  readonly talkAbout: (mention: string, options?: { readonly voice?: boolean; readonly at?: 'half' | 'full' }) => boolean;
  readonly expanded: boolean;
  /**
   * `composer: 'bar'` (D-2198): shows the app's preview of a file (dropped, attached or cited) in the right column, or full screen on a phone. The column holds one
   * thing at a time: a docked assistant goes back above the field (Ouvert) while the preview is open, and comes back when it closes. `null` closes it.
   * False (nothing shown) without `composer: 'bar'` or an agent.
   */
  readonly preview: (preview: AgentPreview | null) => boolean;
}

/** What `useAgentLayer().preview` shows: the app's own view of the file, under its title. */
export interface AgentPreview {
  readonly title: string;
  readonly content: ReactNode;
}

/** The preview header's Library button, when the app gives one. */
function LibraryButton({ open, text, testId = 'agent-preview-library' }: { readonly open: (() => void) | undefined; readonly text: AppShellText; readonly testId?: string }) {
  if (!open) return null;
  return <Button variant="ghost" size="sm" data-testid={testId} onClick={open}><LibraryIcon data-icon="inline-start" aria-hidden="true" />{text.library}</Button>;
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
 * From this width the assistant dock and the PM column are open together: the expanded sidebar (the default `--sidebar-width`, 16rem) + the screen's least width
 * (`DockLayout`'s 360px) + the dock's least width (320px) + the PM column (26rem) = 1352px. Below it they are one at a time, as on a phone.
 * A media query cannot read `--sidebar-width`, so this stays a constant for the default 16rem. A narrower themed sidebar only adds room; a sidebar wider than 16.5rem (8px of slack) needs this raised.
 */
const TOGETHER_FROM = 1360;
const TOGETHER_QUERY = `(width >= ${TOGETHER_FROM}px)`;
/** The PM column's width in px (26rem): while it is open beside the dock, the dock leaves the screen its least width beside both. */
const PM_COLUMN = 416;
const MIN_MAIN = 360;

/**
 * What a close request from the drawer becomes. A swipe, an outside press, a lost focus and Escape never close the layer: they step down
 * to peek (half without an `agent`), so the modal state goes and the coach stays reachable. Only the Close control closes it. `reason` is
 * Base UI's `details.reason` (`'swipe'`, `'outside-press'`, `'focus-out'`, `'escape-key'`, `'close-watcher'`, `'close-press'`, `'trigger-press'`,
 * `'imperative-action'`, `'none'`).
 */
export function nextSnapOnClose(reason: string, hasPeek: boolean): 'peek' | 'half' | 'close' {
  return reason === 'swipe' || reason === 'outside-press' || reason === 'focus-out' || reason === 'escape-key' ? (hasPeek ? 'peek' : 'half') : 'close';
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
  /** The layer's own controls (Close, the trigger, Escape, a swipe): the one snap (the assistant, or the PM where they are one at a time). */
  readonly close: () => void;
  /** `AgentLayerApi.close`: what `showing` names. */
  readonly closeShowing: () => void;
  readonly agent: AgentSpec | undefined;
  readonly improve: ShellPanel | undefined;
  readonly snap: Snap;
  readonly setSnap: (snap: Snap) => void;
  /** Whether the wide layout's dock is floating over the app (reported by the panel); with `expanded` it gives the chats' placement. */
  readonly dockFloating: boolean;
  readonly setDockFloating: (floating: boolean) => void;
  readonly showAgent: () => void;
  /** Wide enough for both and the PM column open: the dock leaves room for it (`AgentDockLayout`). */
  readonly besidePanel: boolean;
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
  /** The shell's `locale`: it wins over `agent.chatProps.locale` (used only when the shell sets none). */
  readonly locale: AppShellLocale | undefined;
  /** Expanded only: the side the dock sits on while docked (the viewer's choice, remembered). */
  readonly side: DockSide;
  readonly setSide: (side: DockSide) => void;
  /** `composer: 'content'` on a wide screen with an assistant: the field is drawn under the page content, the dock holds only the thread. False on a phone (the peek drawer) and for `'dock'`. */
  readonly contentComposer: boolean;
  /** `composer: 'content'` with an agent: the content always sits in the same column wrapper, wide or narrow, so crossing the breakpoint never remounts the screen. */
  readonly contentColumn: boolean;
  /** Where the content composer is drawn and the element a dropped file is taken on (both set by `AgentDockLayout`). */
  readonly composerSlot: HTMLElement | null;
  readonly dropZone: HTMLElement | null;
  readonly setComposerSlot: (element: HTMLElement | null) => void;
  /** An `AgentComposerAnchor` is mounted: the field and the tray are drawn there, not in the full-width slot. */
  readonly anchored: boolean;
  readonly setAnchor: (anchor: { readonly tray: HTMLElement; readonly field: HTMLElement; readonly card: HTMLElement } | null) => void;
  readonly setDropZone: (element: HTMLElement | null) => void;
  /** The content composer sent a message: the thread opens in the dock. */
  readonly onSent: () => void;
  /** Set by a dock control: the next placement or side change puts focus back on the panel's first dock control. */
  readonly restoreFocus: { current: boolean };
  /** Content composer on a wide screen: where a send opens the thread, the person's remembered choice. A tray above the field (default) or the dock. */
  readonly mode: AgentMode;
  readonly setMode: (mode: AgentMode) => void;
  /** The tray's Dock: the same thread to the side pane, docked (never floating), and remember the choice. */
  readonly moveToDock: () => void;
  /** The dock panel reports its api so the tray can dock it. */
  readonly registerDock: (api: DockApi | null) => void;
  /** The tray is filling the main column (Agrandir). */
  readonly grown: boolean;
  readonly setGrown: (grown: boolean) => void;
  /** The thread is on show in the tray above the field. */
  readonly trayOpen: boolean;
  /** The thread is on show in the dock (the dock's own `open`). */
  readonly dockOpen: boolean;
  /** `composer: 'bar'`: the one composer (D-2198). */
  readonly bar: boolean;
  /** `composer: 'bar'` on a wide screen with the conversation folded: the reply card sits on the field. */
  readonly folded: boolean;
  /** Where the folded card is drawn, right above the field (set by `ContentColumn` or `AgentComposerAnchor`). */
  readonly cardSlot: HTMLElement | null;
  readonly setCardSlot: (element: HTMLElement | null) => void;
  /** The file preview on show (`AgentLayerApi.preview`), if any. */
  readonly shownPreview: AgentPreview | null;
  /** The preview sits on top of the docked conversation in the same column (« ← Assistant »), not in a column of its own. */
  readonly previewStacked: boolean;
  /** Opens `agent.library` in the right pane (undefined without one). */
  readonly openLibrary: (() => void) | undefined;
}

type DockSide = 'left' | 'right';
/** Where a thread sent from the content composer opens on a wide screen: `tray` above the field, or `dock` beside the app. */
type AgentMode = 'tray' | 'dock';
/**
 * Where the assistant's field sits on a wide screen. `dock` (default): inside the dock, under the thread. `content`: pinned under the page
 * content, at the content's width, with the dock holding only the thread (one controller, one thread, the same chat as the phone's peek).
 * `bar` (D-2198), the one composer: the same field under the page, drawn as one row (the conversation's chevron, attach, the field and one
 * action button, Dicter, Envoyer or Arrêter; `/` opens the actions), the conversation's work or reply as a card on the field while it is folded,
 * and docked, the field goes with the thread to the right column (nothing stays at the bottom). `useAgentLayer().preview` fills that column.
 * Below the wide breakpoint nothing changes: the peek drawer.
 */
export type AgentComposer = 'dock' | 'content' | 'bar';
/** The dock's remembered state lives under this prefix (DockLayout's storageKey): `<key>.agent.floating`, `.width`, and the side. */
const DOCK_KEY = 'boring.app-shell';
const SIDE_KEY = `${DOCK_KEY}.agent.side`;
/** The tray's height: 35% of the content column, at most this many px. */
const TRAY_MAX = 360;

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

/** Whether `which` is on show: the assistant on the one snap; the PM on it too, or in its own column when wide enough for both. */
function onShow(current: { readonly improve: ShellPanel | undefined; readonly snap: Snap; readonly shown: Which; readonly pmOpen: boolean; readonly together: boolean }, which: Which): boolean {
  if (which === 'agent') return current.snap !== 'closed' && current.shown === 'agent';
  // A PM column alone stays on show for the one render between a narrowing and its move to the snap (no Back entry dropped and pushed again).
  return current.improve !== undefined && ((current.snap !== 'closed' && current.shown === 'improve') || (current.pmOpen && (current.together || current.snap === 'closed')));
}

const controllerOf = (spec: AgentSpec | ShellPanel | undefined) => spec && ('controller' in spec ? spec.controller : spec.identity);

/** The layer's state and controls. */
export function useAgentLayer(): AgentLayerApi {
  const { state, showing, open, closeShowing: close, talkAbout, expanded, agent: spec, preview } = useInternal();
  const agent = spec?.controller;
  return useMemo(() => ({ state, showing, open, close, talkAbout, expanded, agent, preview }), [state, showing, open, close, talkAbout, expanded, agent, preview]);
}

/** Push-to-talk uses the same dictation lifecycle as page targeting, over the existing composer/controller. */
function useVoice(agent: AgentSpec | undefined, locale: AppShellLocale | undefined, done: (outcome: 'sent' | 'drafted') => void): Voice {
  return useChatVoice({ controller: agent?.controller, voice: agent?.voice, attachments: agent?.chatProps?.attachments,
    labels: chatTextFor(locale ?? agent?.chatProps?.locale).labels, onDone: done });
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

/** Places the layer in the app. `agent` is the one assistant; `panel` sits beside the app (the product manager). Either may be absent. */
export function AgentLayerProvider({ agent: own, panel: improve, locale, agentLink, appName, composer = 'dock', modeIdentity, children }: { readonly modeIdentity?: { readonly app?: string | undefined; readonly person?: string | undefined; readonly screen?: boolean | undefined } | undefined; readonly composer?: AgentComposer | undefined; readonly agent?: AgentSpec | undefined; readonly panel?: ShellPanel | undefined; readonly locale?: AppShellLocale | undefined; readonly agentLink?: false | undefined; readonly appName?: string | undefined; readonly children: ReactNode }): ReactElement {
  const compact = usePhone();
  const expanded = !compact;
  const together = useMedia(TOGETHER_QUERY) && expanded;
  const [snap, setSnapState] = useState<Snap>('closed');
  // The PM column beside the dock, used only `together`; below that the PM is `shown === 'improve'` with the one snap, as on a phone.
  const [pmOpen, setPmOpen] = useState(false);
  const [dockFloating, setDockFloating] = useState(false);
  const [columnSlot, setComposerSlot] = useState<HTMLElement | null>(null);
  // The app's own column (`AgentComposerAnchor`) takes the field and the tray from the full-width slot while it is mounted.
  const [anchor, setAnchor] = useState<{ readonly tray: HTMLElement; readonly field: HTMLElement; readonly card: HTMLElement } | null>(null);
  const composerSlot = anchor?.field ?? columnSlot;
  const [dropZone, setDropZone] = useState<HTMLElement | null>(null);
  const composerSlotRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { composerSlotRef.current = composerSlot; }, [composerSlot]);
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
  const [mode, setModeState] = useState<AgentMode>('tray');
  const [grown, setGrown] = useState(false);
  // The tray-or-dock choice is the viewer's, remembered with the side; read after mount for the same reason.
  // Keyed as the left pane's open choice (D-1919): the same helper and identity (app, person) and a key per layout, so two apps on one origin never share it. Reloaded when the identity changes.
  const modeKey = sidebarKey(modeIdentity?.screen ? 'agent-mode-screen' : 'agent-mode', modeIdentity?.app, modeIdentity?.person);
  const setMode = useCallback((next: AgentMode) => { setModeState(next); try { globalThis.localStorage?.setItem(modeKey, next); } catch { /* a convenience */ } }, [modeKey]);
  const dockApi = useRef<DockApi | null>(null);
  const registerDock = useCallback((api: DockApi | null) => { dockApi.current = api; }, []);
  // The tray's Dock: this thread goes to the docked side pane whatever placement was persisted (a floated dock stays floated only for the dock's own controls).
  const moveToDock = useCallback(() => { restoreFocus.current = true; dockApi.current?.dock(); setMode('dock'); }, [setMode]);
  const contentColumn = (composer === 'content' || composer === 'bar') && agent !== undefined;
  const contentComposer = contentColumn && expanded;
  const bar = composer === 'bar' && agent !== undefined;
  const [columnCard, setCardSlot] = useState<HTMLElement | null>(null);
  const cardSlot = anchor?.card ?? columnCard;
  const [shownPreview, setPreview] = useState<AgentPreview | null>(null);
  const specs = useRef({ agent, improve, snap, shown, pmOpen, together, contentComposer, mode, expanded });
  // eslint-disable-next-line react-hooks/refs -- latest-value ref: open/lend/showAgent may be called from a child's layout effect, before this component's own effects run
  specs.current = { agent, improve, snap, shown, pmOpen, together, contentComposer, mode, expanded };
  // Another person's choice (the account switched, no remount) can take the tray or the dock away from under the focus: the one field is the stable control to land on.
  const refocusField = useRef(false);
  useLayoutEffect(() => {
    let next: AgentMode = 'tray';
    try { if (globalThis.localStorage?.getItem(modeKey) === 'dock') next = 'dock'; } catch { /* a convenience */ }
    if (next !== specs.current.mode && specs.current.snap !== 'closed' && document.activeElement?.closest('[data-testid=agent-tray], [data-testid=agent-layer]')) refocusField.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage exists only after mount; reading it before paint keeps server and client markup equal without a flash
    setModeState(next);
  }, [modeKey]);
  useLayoutEffect(() => {
    if (!refocusField.current) return;
    refocusField.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) composerSlotRef.current?.querySelector<HTMLElement>('[data-testid=composer-input]')?.focus({ preventScroll: true });
  }, [mode]);
  const lentRef = useRef<AgentSpec | undefined>(undefined);

  const setSnap = useCallback((next: Snap) => setSnapState(next), []);
  // Closing the dock goes back to the tray mode (the content composer only): the next send opens the tray again.
  const leaveDock = useCallback(() => { if (specs.current.contentComposer && specs.current.mode === 'dock' && specs.current.snap !== 'closed') setMode('tray'); }, [setMode]);
  const close = useCallback(() => { leaveDock(); setSnapState('closed'); }, [leaveDock]);
  const closePm = useCallback(() => {
    setPmOpen(false);
    if (specs.current.shown === 'improve') setSnapState('closed');
  }, []);
  const closeAll = useCallback(() => { setPmOpen(false); setSnapState('closed'); }, []);
  const closeShowing = useCallback(() => {
    const current = specs.current;
    if (current.snap === 'closed' || current.shown === 'improve') setPmOpen(false);
    if (current.snap !== 'closed') { leaveDock(); setSnapState('closed'); }
  }, [leaveDock]);
  // Crossing `TOGETHER_FROM` moves the PM between its two representations, so what is on show stays on show and nothing reopens by itself.
  // Narrowing: a PM alone becomes the one snap; beside the assistant it closes (one at a time), its conversation still mounted. Widening:
  // a PM on the one snap moves to its column and the assistant's snap is free again.
  const wasTogether = useRef(together);
  useLayoutEffect(() => {
    if (wasTogether.current === together) return;
    wasTogether.current = together;
    const current = specs.current;
    const alone = current.snap === 'closed' && current.improve !== undefined;
    if (!together) { if (current.pmOpen) { setPmOpen(false); if (alone) { setShown('improve'); setSnapState('half'); } } return; }
    if (current.snap !== 'closed' && current.shown === 'improve') { setPmOpen(true); setSnapState('closed'); if (current.agent) setShown('agent'); }
  }, [together]);
  // One full-screen layer at a time: opening the agent or product manager closes a view of the app (`useShellLayer`), and a view closes both.
  useEffect(() => registerAgentLayerCloser(closeAll), [closeAll]);
  // The assistant comes on show; below `TOGETHER_FROM` the PM closes (one at a time), from it the PM column stays as it is.
  const toAgent = useCallback(() => {
    if (!specs.current.together) setPmOpen(false);
    setShown('agent');
  }, []);
  const open = useCallback((which?: Which, at: 'peek' | 'half' | 'full' = 'half') => {
    const { agent: a, improve: i, together: both } = specs.current;
    const target = which ?? (a ? 'agent' : 'improve');
    if (target === 'agent' ? !a : !i) return;
    closeShellLayer();
    if (target === 'agent') { toAgent(); setSnapState(at); return; }
    // Wide enough for both: the PM opens beside the assistant and leaves it as it is.
    if (both) { setPmOpen(true); return; }
    setPmOpen(false);
    setShown('improve');
    setSnapState(at === 'peek' ? 'half' : at);
  }, [toAgent]);
  const lend = useCallback((spec: AgentSpec | undefined, at?: 'peek' | 'half' | 'full') => {
    if (specs.current.agent && specs.current.agent !== lentRef.current) return;
    lentRef.current = spec;
    setLent(spec);
    if (spec && at) { closeShellLayer(); toAgent(); setSnapState(at); }
  }, [toAgent]);
  const loan = useMemo<LoanContextValue>(() => ({ available: !own, lend, compact }), [own, lend, compact]);
  const showAgent = useCallback(() => { if (specs.current.agent) toAgent(); }, [toAgent]);

  // A spec that goes away takes the layer with it.
  const shownSpec = shown === 'agent' ? agent : improve;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- closes the layer once after its spec goes away; the guard (!shownSpec) settles after one pass
  useEffect(() => { if (!shownSpec) { setSnapState('closed'); if (shown === 'improve' && agent) setShown('agent'); else if (shown === 'agent' && improve) setShown('improve'); } }, [shownSpec, shown, agent, improve]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a panel that goes away takes its column with it; the guard settles after one pass
  useEffect(() => { if (!improve && pmOpen) setPmOpen(false); }, [improve, pmOpen]);

  // The chats live in one element that is moved into the open drawer or panel; React keeps them mounted (and so their presentation state
  // and uploads) while the layer is closed, on a phone and on a wide screen. Nothing is mounted before the layer is first opened.
  const [host] = useState(() => typeof document === 'undefined' ? null : Object.assign(document.createElement('div'), { className: 'flex min-h-0 flex-1 flex-col [&_[data-boring=pi-chat]>header]:hidden' }));
  const opened = useRef(false);
  // eslint-disable-next-line react-hooks/refs -- a monotonic "ever opened" latch for this render: no re-render, no setState during render
  if (snap !== 'closed' || contentComposer) opened.current = true;

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
      if (onShow(current, which) && controllerOf(current[which]) === controllerOf(spec)) {
        (host?.querySelector<HTMLElement>(`[data-spec=${which}] [data-testid=composer-input]`) ?? (which === 'agent' ? composerSlotRef.current?.querySelector<HTMLElement>('[data-testid=composer-input]') : null))?.focus({ preventScroll: true });
      }
    }, 520);
    return () => clearTimeout(timer);
  }, [host, open, firstAgentLink]);

  const voice = useVoice(agent, locale, outcome => {
    if (outcome === 'drafted') { toAgent(); setSnapState('half'); }
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
    // The tray takes room from the content column: the row the person cited (focused when they cited it) is kept in view above it.
    const cited = specs.current.contentComposer && specs.current.mode === 'tray' && document.activeElement instanceof HTMLElement && !document.activeElement.closest('[data-testid=composer-dock]') && document.activeElement.closest('[data-testid=agent-content]') ? document.activeElement : null;
    if (cited) requestAnimationFrame(() => requestAnimationFrame(() => (cited.closest('[role=row]') ?? cited).scrollIntoView({ block: 'nearest' })));
    open('agent', options.at ?? 'half');
    if (options.voice && selected.voice) {
      setTalkRecording(true);
      // No await or effect: permission belongs to the caller's click or swipe release, even before the chat mounts.
      voice.start();
    } else {
      focusTimer.current = setTimeout(() => {
        if (specs.current.agent?.controller === selected.controller && specs.current.snap !== 'closed' && specs.current.shown === 'agent') (host?.querySelector<HTMLElement>('[data-spec=agent] [data-testid=composer-input]') ?? composerSlotRef.current?.querySelector<HTMLElement>('[data-testid=composer-input]'))?.focus({ preventScroll: true });
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

  // One Back entry for the PM, one more while pointing: Back returns to chat, then closes the PM (only the PM, beside the dock) without leaving the app.
  const improveOpen = onShow({ improve, snap, shown, pmOpen, together }, 'improve');
  const [pmFull, setPmFull] = useState<{ readonly full: boolean; readonly collapse: () => void }>({ full: false, collapse: () => {} });
  const onFull = useCallback((full: boolean, collapse: () => void) => setPmFull(current => current.full === full ? current : { full, collapse }), []);
  useBackLayer(improveOpen, closePm, 'agent');
  useBackLayer(improveOpen && pmFull.full, pmFull.collapse, 'sheet');
  // Both open: the state is `open` and `showing` the assistant; the PM alone: `improve`.
  const state: AgentLayerState = snap === 'closed' ? (improveOpen ? 'open' : 'closed') : expanded ? 'open' : snap;
  const besidePanel = together && improveOpen;
  const setSlot = setComposerSlot;
  // Sending from the content composer shows the thread; a dock already open stays as it is.
  const onSent = useCallback(() => { if (specs.current.snap === 'closed' || specs.current.shown !== 'agent') open('agent'); }, [open]);
  // On a wide content composer the reply is a tray above the field unless the person chose the dock; elsewhere the dock (or the phone's drawer) as before.
  // `bar`: the right column holds one thing at a time (D7). Docked, a preview stacks on top of the conversation in that column; otherwise it takes the column itself.
  const trayOpen = contentComposer && snap !== 'closed' && shown === 'agent' && mode === 'tray';
  const dockOpen = snap !== 'closed' && shown !== 'improve' && (!contentComposer || mode === 'dock');
  const previewStacked = bar && expanded && shownPreview !== null && dockOpen && shown === 'agent';
  const folded = bar && contentComposer && !trayOpen && !dockOpen;
  const preview = useCallback((next: AgentPreview | null) => {
    if (!specs.current.agent || composer !== 'bar') return false;
    setPreview(next);
    // The conversation stays at hand above the field, to talk about the file.
    if (next && specs.current.expanded && (specs.current.snap === 'closed' || specs.current.shown !== 'agent')) open('agent');
    return true;
  }, [composer, open]);
  // « Bibliothèque »: the app's navigator in the right pane, as a preview; a file the app opens from it replaces it, `onPicked` closes it otherwise.
  const shownRef = useRef<AgentPreview | null>(null);
  useLayoutEffect(() => { shownRef.current = shownPreview; });
  const library = agent?.library;
  const openLibrary = useMemo(() => {
    if (!library || composer !== 'bar') return undefined;
    return () => {
      const words = appShellText(locale ?? specs.current.agent?.chatProps?.locale);
      const view: { title: string; content: ReactNode } = { title: words.library, content: null };
      view.content = library(() => { if (shownRef.current === view) preview(null); });
      preview(view);
    };
  }, [library, composer, locale, preview]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- a preview goes with the agent it was opened beside
  useEffect(() => { if (!agent && shownPreview) setPreview(null); }, [agent, shownPreview]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the tray is gone with the content composer (a phone width, a lost agent): the fill state goes with it
  useEffect(() => { if (!trayOpen && grown) setGrown(false); }, [trayOpen, grown]);
  const value = useMemo<Internal>(() => ({
    state, showing: snap !== 'closed' ? shown : improveOpen ? 'improve' : null, open, close, closeShowing, talkAbout, talkRecording, expanded, agent, improve, snap, setSnap, dockFloating, setDockFloating, showAgent, besidePanel, triggerUntil, voice, peekPoint, tabbar, host, locale, side, setSide, restoreFocus, contentComposer, contentColumn, composerSlot, dropZone, setComposerSlot: setSlot, anchored: anchor !== null, setAnchor, setDropZone, onSent, mode, setMode, moveToDock, registerDock, grown, setGrown, trayOpen, dockOpen,
    bar, folded, cardSlot, setCardSlot, shownPreview, previewStacked, preview, openLibrary,
  }), [state, snap, shown, improveOpen, open, close, closeShowing, talkAbout, talkRecording, expanded, agent, improve, setSnap, dockFloating, showAgent, besidePanel, triggerUntil, voice, peekPoint, tabbar, host, locale, side, setSide, contentComposer, contentColumn, composerSlot, dropZone, setSlot, anchor, onSent, mode, setMode, moveToDock, registerDock, grown, trayOpen, dockOpen, bar, folded, cardSlot, shownPreview, previewStacked, preview, openLibrary]);

  // The shell's z-scale (tabs 20, peek 30, drawer and panel 40, other sheets 50, point bar 60) as custom properties; `display: contents` keeps the box tree unchanged.
  const scale = { '--app-shell-z-tabs': Z.tabs, '--app-shell-z-peek': Z.peek, '--app-shell-z-layer': Z.layer, '--app-shell-z-sheet': Z.sheet, '--app-shell-z-point': Z.point } as CSSProperties;
  const page = <div data-app-shell="" className="contents" style={scale}>
    <div ref={probe} aria-hidden="true" className="pointer-events-none invisible fixed top-0 left-0 w-0" style={{ height: 'var(--app-shell-tabbar, 0px)' }} />
    {children}
    {/* eslint-disable-next-line react-hooks/refs -- reads the "ever opened" latch set above in this same render */}
    {host && opened.current && createPortal(<Chats showing={shown} />, host)}
  </div>;
  return <AgentContextProvider>
    <LayerContext.Provider value={value}><LoanContext.Provider value={loan}>
      {improve ? <improve.Provider config={improve.config} open={improveOpen} close={closePm} appName={appName} locale={locale} onFull={onFull}>{page}</improve.Provider> : page}
    </LoanContext.Provider></LayerContext.Provider>
  </AgentContextProvider>;
}

/** The header button that opens the layer: a tap opens half; with `agent.voice`, press and hold records and a slide off cancels. Absent without `agent`. */
export function AgentTrigger({ className, children }: { readonly className?: string; readonly children?: ReactNode }) {
  const layer = useInternal();
  const { agent, voice } = layer;
  const text = appShellText(layer.locale ?? agent?.chatProps?.locale);
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
    // Peek is the collapsed coach: a tap reveals it. Every other open state closes.
    if (layer.showing === 'agent' && layer.state !== 'closed' && layer.state !== 'peek') layer.close();
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
  const exposed = layer.showing === 'agent' && (layer.state === 'half' || layer.state === 'full');
  return <Button variant="ghost" size="icon" data-agent-trigger="" data-testid="agent-trigger" aria-label={name} title={name} aria-expanded={layer.state !== 'closed'}
    // Base UI 1.9.0 markOthers (FloatingFocusManager) skips an [aria-live] element and its ancestors in its aria-hidden pass: while the agent's own sheet is
    // modal (half, full) that keeps the trigger a reachable button; "off" announces nothing. Never otherwise: another modal (a Dialog) must hide it.
    aria-live={exposed ? 'off' : undefined}
    onPointerDown={down} onPointerUp={release} onPointerCancel={release} onPointerMove={move} onContextMenu={event => event.preventDefault()}
    onClick={event => { if (event.detail === 0) toggle(); }}
    className={cn('touch-none', className)}>
    {children ?? (Icon ? <Icon className="size-5" /> : <SparklesIcon data-icon="inline-start" aria-hidden="true" />)}
  </Button>;
}

/** Tap to start; while active, this same control is the composer's replacement recording row. In the bar it stands in Send's place, named « Dicter ». */
function TalkButton({ label, primary = false }: { readonly label?: string; readonly primary?: boolean }) {
  const { voice } = useInternal();
  const busy = voice.phase === 'transcribing';
  return <VoiceMessageButton testId="agent-talk" primary={primary} {...(label ? { label } : {})} disabled={busy || (voice.phase === 'idle' && voice.canStart === false)} voice={{
    ...voice, phase: busy ? 'processing' : voice.phase, canStart: voice.canStart !== false,
    pending: voice.pending ?? [], captureSequence: voice.captureSequence ?? 0,
  }} />;
}

/** What went wrong with the microphone, in the flow under the title row (never over the messages). */
function VoiceProblem() {
  const { voice } = useInternal();
  return voice.problem ? <p role="alert" data-testid="agent-voice-problem" className="m-0 shrink-0 px-3 pb-1 text-xs leading-4 text-destructive">{voice.problem}</p> : null;
}

/** `composer: 'bar'`: the chevron at the start of the field. It unfolds the conversation above the field and folds it back; a dot while a reply is unread. */
function ConversationChevron({ unread }: { readonly unread: { readonly label: string } | undefined }) {
  const layer = useInternal();
  const text = appShellText(layer.locale ?? layer.agent?.chatProps?.locale);
  const open = layer.trayOpen || layer.dockOpen;
  return <span className="relative inline-flex shrink-0">
    <Button type="button" variant="ghost" size="icon" data-testid="agent-bar-conversation" aria-label={text.conversation} title={text.conversation} aria-expanded={open}
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

function FoldedCard({ bar, onOpenFile }: { readonly bar: AgentBarChat; readonly onOpenFile: ((path: string) => void) | undefined }) {
  const layer = useInternal();
  const text = appShellText(layer.locale ?? layer.agent?.chatProps?.locale);
  const { question, status, reply } = bar;
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
        <p data-testid="agent-card-reply" className="m-0 line-clamp-3 whitespace-pre-line">{readable(reply.text)}</p>
        {reply.files.length > 0 && <div role="list" data-testid="agent-card-files" className="flex flex-wrap gap-1.5">
          {reply.files.map(path => <span role="listitem" key={path}><Button type="button" variant="outline" size="sm" data-testid="agent-card-file" data-path={path} disabled={!onOpenFile} onClick={() => onOpenFile?.(path)}>
            <FileTextIcon data-icon="inline-start" aria-hidden="true" />{path.split('/').at(-1)}</Button></span>)}
        </div>}
      </>}
    </section>
    <Separator />
  </>;
}

/** One agent's PiChat. It stays mounted while hidden, so its scroll, focus and drafts survive a swap with the other spec. */
function SpecChat({ spec, visible, role }: { readonly spec: AgentSpec; readonly visible: boolean; readonly role: Which }) {
  const layer = useInternal();
  const locale = layer.locale ?? spec.chatProps?.locale;
  const words = appShellText(locale);
  // `composer: 'bar'`: the folded card and the chevron's dot read the same chat as the thread, through the agent bar's own adapter.
  const barChat = useAgentBarChat(spec.controller, { actions: spec.chatProps?.actions, toolLabels: chatTextFor(locale).labels,
    labels: { working: words.working, done: words.done, unread: words.unread, step: (index, count) => `${index} ${words.of} ${count}` } });
  const barred = role === 'agent' && layer.bar && layer.contentComposer;
  const { markRead } = barChat;
  const unfolded = barred && !layer.folded;
  useEffect(() => { if (unfolded) markRead(); }, [unfolded, markRead]);
  // Docked, the bar's field goes with the thread: nothing stays at the bottom.
  const hosted = role === 'agent' && layer.contentComposer && !(barred && layer.dockOpen);
  const openFile = spec.chatProps?.onOpenFile ?? spec.chatProps?.mentions?.open;
  const barProps = barred ? {
    composerLayout: 'pill' as const, composerBarActions: 'attach' as const, composerFileChips: true, composerStart: <ConversationChevron unread={barChat.historyBadge} />,
    // While the agent's question waits, the field says so; a typed message answers it (PiChat's own rule).
    ...(barChat.question ? { labels: { ...spec.chatProps?.labels, placeholder: words.answerHere } } : {}),
    ...(spec.voice ? { composerWhenEmpty: <TalkButton label={words.dictate} primary /> } : {}),
  } : {};
  // One annotate toggle: pins on desktop, point mode (which hides the layer while the person taps the app) on touch and compact screens.
  const feedback = useComposerFeedback(spec.feedback);
  const pointing = usePointing(spec.feedback);
  // The pin's mic uses the shell's transcription: this agent's own, else the coach's.
  const transcribe = (spec.voice ?? layer.agent?.voice)?.transcribe;
  const fr = locale === 'fr';
  return <div data-spec={role} hidden={!visible} className={cn('min-h-0 min-w-0 flex-1', visible ? 'flex flex-col' : 'hidden')}>
    <PiChat {...withChatPlugins(spec.chatProps ?? {})} {...barProps} {...(locale ? { locale } : {})} controller={spec.controller} keyboardInset={false} {...(hosted ? { composerHost: layer.composerSlot, dropZone: layer.dropZone, onSent: layer.onSent } : role === 'agent' && layer.contentComposer ? { onSent: layer.onSent } : {})} placement={layer.expanded && !layer.dockFloating ? 'docked' : 'floating'} {...(feedback ? { feedback } : {})} {...(spec.feedback && !spec.chatProps?.sentContent ? { sentContent: sentFeedbackContent } : {})}
      {...(role === 'agent' && spec.voice ? { voiceMessage: { transcribe: spec.voice.transcribe, Bubble: PendingVoiceBubble }, tools: barred ? spec.chatProps?.tools : <>{spec.chatProps?.tools}<TalkButton /></>, composerRecording: layer.voice.phase === 'starting' || layer.voice.phase === 'recording' ? <TalkButton /> : undefined, pendingVoice: layer.voice.pending } : {})} />
    {barred && layer.folded && layer.cardSlot && createPortal(<FoldedCard bar={barChat} onOpenFile={openFile} />, layer.cardSlot)}
    {/* The note editor of ordinary feedback lives inside the layer, in the modal's focus tree; while pointing the layer steps aside and AgentLayer renders it. */}
    {/* In the flow, inside the visible content box: the popup is transformed (a fixed element would be placed against its off-screen bottom). */}
    {spec.feedback && visible && !pointing && <div className="shrink-0 px-2 pb-2 empty:hidden">
      <NoteBubble session={spec.feedback} {...(transcribe ? { transcribe } : {})} {...(fr ? { labels: feedbackLabelsFr } : {})} /></div>}
  </div>;
}

/** Where the chats show: the persistent host element is moved in once, when the drawer or panel mounts. */
function ChatSlot({ live = true }: { readonly live?: boolean }) {
  const { host } = useInternal();
  const slot = useRef<HTMLDivElement | null>(null);
  const place = useCallback((element: HTMLDivElement | null) => { slot.current = element; if (element && host) element.appendChild(host); }, [host]);
  // A slot that was mounted while the chats were shown elsewhere (the dock beside a tray) takes them back when it goes live.
  useLayoutEffect(() => { if (live && slot.current && host && host.parentElement !== slot.current) slot.current.appendChild(host); }, [live, host]);
  // Coarse pointers: the chat's own transcript buttons (copy, show earlier) get the layer's 44px rule from here, without touching pi-chat.
  return <div ref={place} className="flex min-h-0 flex-1 flex-col [&_[data-testid=transcript]_button]:pointer-coarse:min-h-11 [&_[data-testid=transcript]_button]:pointer-coarse:min-w-11" />;
}

/** Both specs, each mounted once it has been shown. */
function Chats({ showing }: { readonly showing: Which }) {
  const { agent, contentComposer } = useInternal();
  const seen = useRef(new Set<Which>());
  // eslint-disable-next-line react-hooks/refs -- a monotonic "ever shown" set filled during render: no setState, no re-render
  seen.current.add(showing);
  // With the field under the page (`composer: 'content'`, wide) the agent's chat is mounted at rest even while the PM is the view shown: its composer is portaled into the slot, its thread stays hidden (D-2026).
  // eslint-disable-next-line react-hooks/refs -- reads the "ever shown" set filled above in this same render
  const seenAgent = seen.current.has('agent') || contentComposer;
  return <>
    {agent && seenAgent && <SpecChat spec={agent} visible={showing === 'agent'} role="agent" />}
  </>;
}

/** Title row: « ← » when the improve view has an agent to go back to, the title, then Expand or Collapse (compact only), the dock controls (expanded only) and Close. */
function Header({ text, title, compactSnap, closeRef, controls, className, ...rest }: { readonly text: AppShellText; readonly title: string; readonly compactSnap?: Snap; readonly closeRef?: Ref<HTMLButtonElement>; readonly controls?: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'title'>) {
  const layer = useInternal();
  const back = layer.showing === 'improve' && layer.agent;
  const actions = layer.showing === 'improve' ? [] : layer.agent?.headerActions ?? [];
  // A file stacked on the docked conversation takes the header: « ← <file> » goes back to the thread.
  const file = layer.previewStacked && layer.showing === 'agent' && compactSnap === undefined ? layer.shownPreview : null;
  const library = layer.bar && layer.showing === 'agent' ? layer.openLibrary : undefined;
  return <div data-testid="agent-layer-header" {...rest} className={cn('flex shrink-0 items-center gap-1 px-2 pb-1', className)}>
    {back && <Button variant="ghost" size="icon" data-testid="agent-layer-back" aria-label={text.back} title={text.back} onClick={layer.showAgent}><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    {file && <Button variant="ghost" size="icon" data-testid="agent-preview-back" aria-label={text.backToAssistant} title={text.backToAssistant} onClick={() => layer.preview(null)}><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    <h2 data-testid={file ? 'agent-preview-title' : 'agent-layer-title'} className="m-0 min-w-0 flex-1 truncate px-1 text-sm font-semibold">{file ? file.title : title}</h2>
    <LibraryButton open={library} text={text} testId="agent-layer-library" />
    {actions.length > 0 && <HeaderActions actions={actions} compact={compactSnap !== undefined} text={text} prefix="agent-layer" run={id => actions.find(action => action.id === id)?.onSelect()} />}
    {compactSnap === 'half' && <Button variant="ghost" size="icon" data-testid="agent-layer-expand" aria-label={text.expand} title={text.expand} onClick={() => layer.setSnap('full')}><ChevronUpIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    {compactSnap === 'full' && <Button variant="ghost" size="icon" data-testid="agent-layer-collapse" aria-label={text.collapse} title={text.collapse} onClick={() => layer.setSnap('half')}><ChevronDownIcon data-icon="inline-start" aria-hidden="true" /></Button>}
    {controls}
    <Button variant="ghost" size="icon" ref={closeRef} data-testid="agent-layer-close" aria-label={text.close} title={text.close} onClick={layer.close}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
  </div>;
}

function useTitle(): { text: AppShellText; title: string } {
  const layer = useInternal();
  const improve = layer.showing === 'improve' ? layer.improve : undefined;
  const spec = improve ? undefined : layer.agent;
  const text = appShellText(layer.locale ?? (improve ? (improve.locale as AppShellLocale | undefined) : undefined) ?? layer.agent?.chatProps?.locale);
  const title = improve ? improve.label ?? text.improve : (spec?.chatProps?.labels?.title ?? text.assistant);
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
  const open = snap !== 'closed' && layer.showing !== 'improve' && !pointing;
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

  // At half and full the sheet is modal: the page, the trigger included, is inert, so a tap on the trigger lands elsewhere and would count as an
  // outside press (down to peek). It still means what the trigger means: close. A trigger that gets its own press, or one under the sheet, is left alone.
  const { close, triggerUntil } = layer;
  useEffect(() => {
    if (!open || peek) return;
    const triggerAt = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-agent-trigger], [data-slot=drawer-popup], [data-boring-overlay]')) return null;
      return [...document.querySelectorAll('[data-agent-trigger]')].find(trigger => {
        const box = trigger.getBoundingClientRect();
        return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      }) ?? null;
    };
    let press: { readonly trigger: Element; readonly id: number; readonly at: number } | null = null;
    const down = (event: PointerEvent) => {
      if (press) return;
      const trigger = triggerAt(event);
      if (!trigger) return;
      press = { trigger, id: event.pointerId, at: Date.now() };
      triggerUntil.current = press.at + 500;
    };
    const up = (event: PointerEvent) => {
      if (press?.id !== event.pointerId) return;
      const { trigger, at } = press;
      press = null;
      // A tap, on the trigger it began on. A long press is not one: this trigger records only from a closed or peek layer.
      if (triggerAt(event) === trigger && Date.now() - at < HOLD_MS) close();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
    };
  }, [open, peek, close, triggerUntil]);

  // The sheet stops under the page header it opens over, so the trigger there is not covered: at full the sheet would otherwise reach 1.5rem from the top and sit on it.
  const [measuredClear, setTriggerClear] = useState(0);
  const triggerClear = open && !peek ? measuredClear : 0;
  useLayoutEffect(() => {
    if (!open || peek) return;
    // Follows the real geometry while open: a header that grows later (an async leading control) moves the trigger down. The lowest of the triggers in the top half counts.
    // State is set only from the callbacks below (the first call is the observer's initial one), never synchronously in this effect.
    const measure = () => {
      let bottom = 0;
      for (const trigger of document.querySelectorAll('[data-agent-trigger]')) {
        const box = trigger.getBoundingClientRect();
        if (box.bottom > 0 && box.bottom < window.innerHeight / 2) bottom = Math.max(bottom, box.bottom);
      }
      setTriggerClear(bottom ? Math.ceil(bottom + 4) : 0);
    };
    const size = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
    const first = requestAnimationFrame(measure);
    // The header can change without the trigger's own box changing: watch the header's size and its subtree's attributes and children, and the page.
    for (const trigger of document.querySelectorAll('[data-agent-trigger]')) {
      const header = trigger.closest('header, [role=banner]');
      for (const node of [trigger, trigger.parentElement, header]) if (node) size?.observe(node);
      if (header) mutation?.observe(header, { attributes: true, childList: true, subtree: true });
    }
    size?.observe(document.body);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    document.addEventListener('transitionend', measure, true);
    return () => {
      cancelAnimationFrame(first); size?.disconnect(); mutation?.disconnect();
      window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure);
      document.removeEventListener('transitionend', measure, true);
    };
  }, [open, peek, vv?.height]);

  // While « Améliorer l'app » shows, the PM panel owns the layer's Back entry (AgentLayerProvider).
  useBackLayer((snap === 'half' || snap === 'full') && layer.showing !== 'improve', layer.close, 'agent');

  // The popup is taller than what shows and slides down by `--drawer-snap-point-offset` (a registered, non-inheriting property, so only the
  // popup itself can read it): padding the popup by that offset makes its content box exactly the visible part. At peek the tab bar below is left out too.
  // The popup is portalled to the body, outside the shell root: it is given the measured tab bar height and the z-values explicitly.
  const style = { '--app-shell-trigger-clear': `${triggerClear}px`, '--app-shell-vv-height': vv ? `${vv.height}px` : '100dvh', '--app-shell-tabbar': `${layer.tabbar}px`, '--app-shell-peek-height': `${PEEK_REM}rem`, '--app-shell-z-layer': Z.layer,
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
      className={cn('app-shell box-border z-(--app-shell-z-layer) data-[swipe-direction=down]:bottom-(--drawer-keyboard-inset,0px) data-[swipe-axis=y]:[--drawer-content-max-height:calc(var(--app-shell-vv-height,100dvh)_-_max(1.5rem,var(--app-shell-trigger-clear,0px)))]',
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

/** Folded (`composer: 'bar'`): the card on the field says what the agent does, so the chat's own status line and its files list above the field step aside. */
const FOLDED_FIELD = '[&_[data-testid=preparing]]:hidden [&_[data-testid=composer-dock]_p[data-testid=agent-status]]:hidden [&_[data-testid=conversation-files]]:hidden';

/** The panel inside the dock: the same element docked or floating, so a placement change keeps focus and the chats where they are. */
function DockPanel({ api, side }: { readonly api: DockApi; readonly side: DockSide }) {
  const layer = useInternal();
  const { text, title } = useTitle();
  const open = layer.dockOpen;
  const floating = api.floating;
  const { registerDock } = layer;
  useLayoutEffect(() => { registerDock(api); return () => registerDock(null); }, [api, registerDock]);
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
  // Only a change of placement or side can strand focus: the first run (the dock opened at load) leaves focus alone, so no header button shows a ring on page load (D-1968).
  const placed = useRef({ placement: api.placement, side });
  useLayoutEffect(() => {
    // Opening from `closed` (the URL or a remembered state opening the dock after its first render) is not a move: only docked, float or a side change while already open is.
    const changed = placed.current.placement !== 'closed' && (placed.current.placement !== api.placement || placed.current.side !== side);
    placed.current = { placement: api.placement, side };
    const lost = !document.activeElement || document.activeElement === document.body;
    const wanted = restoreFocusRef.current || (changed && openRef.current && lost && api.placement !== 'closed');
    restoreFocusRef.current = false;
    if (wanted) box.current?.querySelector<HTMLElement>('[data-dock-control]')?.focus({ preventScroll: true });
  }, [api.placement, side, restoreFocusRef]);
  const drag = useDraggable({ box, position: open ? pos : null, onPositionChange: setPos, enabled: floating });
  const act = (run: () => void) => () => { restoreFocusRef.current = true; run(); };
  const control = (id: string, label: string, Icon: ComponentType<{ className?: string }>, run: () => void) =>
    <Button variant="ghost" size="icon" key={id} data-testid={`agent-layer-${id}`} data-dock-control="" aria-label={label} title={label} onClick={act(run)}><Icon data-icon="inline-start" aria-hidden="true" /></Button>;
  // `composer: 'bar'`: one way out besides Fermer, back to the bottom (Ouvert); the field goes back under the page with the thread.
  const undock = () => {
    layer.setMode('tray');
    requestAnimationFrame(() => layer.composerSlot?.querySelector<HTMLElement>('[data-testid=composer-input]')?.focus({ preventScroll: true }));
  };
  const controls = layer.bar ? <Button variant="ghost" size="icon" data-testid="agent-layer-undock" data-dock-control="" aria-label={text.undock} title={text.undock} onClick={undock}><PanelBottomIcon data-icon="inline-start" aria-hidden="true" /></Button> : <>
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
    {layer.previewStacked && layer.shownPreview && <PreviewStack preview={layer.shownPreview} />}
    <div className={cn('flex min-h-0 flex-col overflow-hidden', layer.previewStacked ? cn('shrink-0 [&_[data-testid=conversation-content]]:hidden', FOLDED_FIELD) : 'flex-1')}><VoiceProblem /><ChatSlot live={open} /></div>
  </div>;
}

/** D7, docked: the opened file sits on top of the conversation in its column, under « ← Assistant / <name> »; the arrow goes back to the thread. */
function PreviewStack({ preview }: { readonly preview: AgentPreview }) {
  const layer = useInternal();
  const text = appShellText(layer.locale ?? layer.agent?.chatProps?.locale);
  return <section data-testid="agent-preview" data-placement="stacked" aria-label={`${text.preview} · ${preview.title}`} className="flex min-h-0 flex-1 flex-col"
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); layer.preview(null); } }}>
        <div data-testid="agent-preview-body" className="flex min-h-0 flex-1 flex-col overflow-auto">{preview.content}</div>
  </section>;
}

function AgentDock({ side }: { readonly side: DockSide }) {
  const layer = useInternal();
  const { title } = useTitle();
  return <Dock id="agent" side={side} floatable defaultWidth={384} minWidth={320} dragBelow={260} open={layer.dockOpen} onOpenChange={next => { if (!next) layer.close(); }} labels={{ region: title }}>
    {api => <DockPanel api={api} side={side} />}
  </Dock>;
}


/** `composer: 'bar'`: the thread (Ouvert), the folded card and the field in one frame at the field's width, never the page's (AC-16). The inner input group's own frame is cleared by the block's CSS (`.app-shell [data-one-composer]`). */
function OneBox({ children }: { readonly children: ReactNode }) {
  return <div className="shrink-0 bg-card px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
    <div data-one-composer="" data-testid="agent-composer-box" className="mx-auto flex w-full max-w-[720px] min-w-0 flex-col overflow-hidden rounded-(--radius-xl) bg-card text-card-foreground ring-1 ring-border has-focus-visible:ring-2 has-focus-visible:ring-ring">{children}</div>
  </div>;
}

/** `composer: 'content'`: the page content, then the field's slot at the bottom; a file dropped anywhere on the column goes to that field. */
function ContentColumn({ children }: { readonly children: ReactNode }) {
  const { setComposerSlot, setDropZone, trayOpen, grown, anchored, setCardSlot, bar: barMode, contentComposer, folded } = useInternal();
  // The box only on a wide screen: on a phone the field lives in the drawer.
  const bar = barMode && contentComposer;
  // The page keeps one wrapper whether the tray is open or not, so opening it never remounts the screen; Agrandir only hides it.
  return <div ref={setDropZone} data-testid="agent-content" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div data-testid="agent-page" className={cn('flex min-h-0 min-w-0 flex-1 flex-col', trayOpen && grown && !anchored && !bar && 'hidden')}>{children}</div>
    {bar ? <OneBox>
      {trayOpen && !anchored && <ContentTray />}
      <div ref={setCardSlot} data-testid="agent-card-slot" className="shrink-0 empty:hidden" />
      <div ref={setComposerSlot} data-testid="agent-content-composer" className={cn('shrink-0', folded && FOLDED_FIELD)} />
    </OneBox> : <>
      {trayOpen && !anchored && <ContentTray />}
      <div ref={setComposerSlot} data-testid="agent-content-composer" className="shrink-0" />
    </>}
  </div>;
}

/**
 * Where the app wants the assistant's field: place it in the column the field belongs under (for a page with an aside, the main column).
 * While mounted, `composer: 'content'` draws the field and the reply tray here instead of across the whole content column; a file drop stays on the whole column.
 * Absent, nothing changes. Still one controller and one composer; the page is not remounted. Renders nothing visible without a content composer.
 */
export function AgentComposerAnchor({ className }: { readonly className?: string }) {
  const layer = useContext(LayerContext);
  const [tray, setTray] = useState<HTMLElement | null>(null);
  const [field, setField] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const setAnchor = layer?.setAnchor;
  useLayoutEffect(() => {
    if (!setAnchor || !tray || !field || !card) return;
    setAnchor({ tray, field, card });
    return () => setAnchor(null);
  }, [setAnchor, tray, field, card]);
  if (!layer) return null;
  const slots = <>
    <div ref={setTray} data-testid="agent-anchor-tray" className="flex min-w-0 flex-col">{layer.trayOpen && layer.anchored && <ContentTray />}</div>
    <div ref={setCard} data-testid="agent-anchor-card" className="shrink-0 empty:hidden" />
    <div ref={setField} data-testid="agent-anchor-composer" className={cn('shrink-0', layer.folded && FOLDED_FIELD)} />
  </>;
  return <div data-testid="agent-composer-anchor" className={cn('flex min-w-0 shrink-0 flex-col', className)}>{layer.bar && layer.contentComposer ? <OneBox>{slots}</OneBox> : slots}</div>;
}

/**
 * The reply as a tray just above the field (`composer: 'content'`, wide, the person's default): the desktop twin of the phone's peek to half.
 * The same thread and controller as the dock and the drawer, moved here; its width is the field's, its height min(35%, 360px) of the column,
 * and the page above it shrinks instead of being covered. No second composer: the field below stays the only input.
 */
function ContentTray() {
  const layer = useInternal();
  const { text, title } = useTitle();
  const { grown, setGrown, side, moveToDock } = layer;
  const reduce = useCallback(() => {
    layer.close();
    layer.composerSlot?.querySelector<HTMLElement>('[data-testid=composer-input]')?.focus({ preventScroll: true });
  }, [layer]);
  const reduceRef = useRef(reduce);
  useLayoutEffect(() => { reduceRef.current = reduce; });
  // Esc goes back to the bare field, unless something else owns it: an open menu, dialog or popup, an IME composition, a handled key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      // Only a key pressed in the tray or in the one field is the tray's; a host dock beside the content, a menu or a dialog keep their own Esc.
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid=agent-tray], [data-testid=agent-content-composer], [data-testid=agent-composer-anchor]')) return;
      if (document.querySelector('[role=menu],[role=listbox],[role=dialog],[role=alertdialog],[data-boring-overlay]')) return;
      if (event.target instanceof Element && event.target.closest('[aria-expanded=true]')) return;
      reduceRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const DockIcon = side === 'left' ? PanelLeftIcon : PanelRightIcon;
  const dockLabel = side === 'left' ? text.dockLeft : text.dockRight;
  // In an anchor the tray sits in the app's column, whose height is not the content column's: a share of the viewport, and Agrandir takes more of it instead of hiding the page.
  const boxed = layer.bar && layer.contentComposer;
  const height = boxed ? (grown ? '70dvh' : '30dvh') : layer.anchored ? (grown ? 'min(70dvh, 720px)' : `min(35dvh, ${TRAY_MAX}px)`) : grown ? undefined : `min(35%, ${TRAY_MAX}px)`;
  return <section data-testid="agent-tray" aria-label={title} style={height ? { height } : undefined}
    className={cn('relative flex min-h-0 min-w-0 flex-col', boxed ? 'shrink-0 bg-card px-3 text-card-foreground' : 'bg-card px-4 text-card-foreground', !boxed && (grown && !layer.anchored ? 'flex-1' : 'shrink-0'))}>
    {boxed ? null : <Separator className="absolute inset-x-0 top-0" />}
    <div data-testid="agent-tray-body" className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col">
      <div data-testid="agent-tray-header" className="flex shrink-0 items-center gap-1 pt-1">
        <h2 data-testid="agent-tray-title" className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {layer.bar && <LibraryButton open={layer.openLibrary} text={text} testId="agent-layer-library" />}
        <Button variant="ghost" size="icon" data-testid="agent-tray-dock" aria-label={dockLabel} title={dockLabel}
          onClick={moveToDock}><DockIcon data-icon="inline-start" aria-hidden="true" /></Button>
        <Button variant="ghost" size="icon" data-testid="agent-tray-grow" aria-label={text.expand} title={text.expand} aria-pressed={grown}
          onClick={() => setGrown(!grown)}>{grown ? <ChevronDownIcon data-icon="inline-start" aria-hidden="true" /> : <ChevronUpIcon data-icon="inline-start" aria-hidden="true" />}</Button>
        <Button variant="ghost" size="icon" data-testid="agent-tray-reduce" aria-label={text.collapse} title={text.collapse} onClick={reduce}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
      </div>
      <VoiceProblem />
      <ChatSlot />
    </div>
    {boxed && <Separator />}
  </section>;
}

/**
 * Wraps the app's content (placed once by the shell): on a wide screen the agent dock sits on its left or right and the content reflows,
 * or it floats over the content; on a phone this is only the content (the layer is the bottom drawer). Host concern: Pi has no layout.
 */
export function AgentDockLayout({ children }: { readonly children: ReactNode }): ReactElement {
  const layer = useInternal();
  const dock = layer.expanded && (layer.agent || layer.improve) ? <AgentDock side={layer.side} /> : null;
  // The PM column sits inside the main content: while it is open beside the dock, the dock leaves the screen its least width beside it.
  return <DockLayout storageKey={DOCK_KEY} persist="local" minMain={MIN_MAIN + (layer.besidePanel ? PM_COLUMN : 0)}>
    {layer.side === 'left' && dock}
    <DockMain>{layer.contentColumn ? <ContentColumn>{children}</ContentColumn> : children}</DockMain>
    {layer.bar && layer.expanded && layer.shownPreview && !layer.previewStacked && <PreviewPane preview={layer.shownPreview} />}
    {layer.side === 'right' && dock}
  </DockLayout>;
}

/**
 * `useAgentLayer().preview`: the app's view of a file, in the right column on a wide screen (the conversation waits above the field) and over
 * the whole screen on a phone. Fermer l'aperçu (or Escape inside it) closes it; the app draws the content.
 */
function PreviewPane({ preview }: { readonly preview: AgentPreview }) {
  const layer = useInternal();
  const text = appShellText(layer.locale ?? layer.agent?.chatProps?.locale);
  const close = () => layer.preview(null);
  return <aside data-testid="agent-preview" aria-label={`${text.preview} · ${preview.title}`}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); } }}
    className={cn('flex min-h-0 min-w-0 flex-col bg-background text-foreground', layer.expanded ? 'relative w-[min(32rem,45%)] shrink-0 border-l' : 'fixed inset-0 z-(--app-shell-z-sheet)')}>
    <div className="flex shrink-0 items-center gap-1 px-2 py-2">
      <h2 data-testid="agent-preview-title" className="m-0 min-w-0 flex-1 truncate px-1 text-sm font-semibold">{preview.title}</h2>
      <LibraryButton open={preview.title === text.library ? undefined : layer.openLibrary} text={text} />
      <Button variant="ghost" size="icon" data-testid="agent-preview-close" aria-label={text.closePreview} title={text.closePreview} onClick={close}><XIcon data-icon="inline-start" aria-hidden="true" /></Button>
    </div>
    <div data-testid="agent-preview-body" className="flex min-h-0 flex-1 flex-col overflow-auto">{preview.content}</div>
  </aside>;
}

/** The layer itself: the drawer on a phone (the wide dock is `AgentDockLayout`). Placed once by the shell, for point mode on both. */
export function AgentLayer(): ReactElement | null {
  const layer = useInternal();
  const pointingAgent = usePointing(layer.agent?.feedback);
  const session = pointingAgent ? layer.agent?.feedback : undefined;
  const commentingAgent = useCommenting(layer.agent?.feedback);
  const commenting = commentingAgent ? layer.agent?.feedback : undefined;
  // Back ends pointing first (the `point` priority), like Done: the notes wait for the next message. The layer keeps its own history entry underneath.
  useBackLayer(session !== undefined, () => { void session?.done(); }, 'point');
  if (!layer.agent && !layer.improve) return null;
  const pointed = layer.agent;
  const transcribe = (pointed?.voice ?? layer.agent?.voice)?.transcribe;
  const locale = layer.locale ?? pointed?.chatProps?.locale;
  // Comment mode shows its banner either way: on a phone (point mode) above the tab bar, outside the layer, while the compact sheet steps
  // aside; on a wide screen at the top, the dock beside the app. The note bubble is here only while pointing (else inside the layer).
  return <>
    {!layer.expanded && <CompactSheet pointing={session !== undefined} />}
    {layer.bar && !layer.expanded && layer.shownPreview && <PreviewPane preview={layer.shownPreview} />}
    {commenting && <CommentBanner session={commenting} bottomOffset={`${layer.tabbar}px`} className="z-[60]" {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />}
    {session && <NoteBubble session={session} {...(transcribe ? { transcribe } : {})} {...(locale === 'fr' ? { labels: feedbackLabelsFr } : {})} />}
  </>;
}

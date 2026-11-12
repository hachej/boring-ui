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
import type { CSSProperties, ReactElement, ReactNode, RefObject } from 'react';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { useChatVoice } from '@hachej/boring-ui-kit/chat-react/voice';
import type { ChatVoiceHandle as Voice } from '@hachej/boring-ui-kit/chat-react/voice';
import { appendToDraft, mentionToken, pieces, removeMention } from '@hachej/boring-ui-kit/chat-text';
import { useMedia, usePhone } from '../utils/use-media';
import type { DockApi } from '../dock/dock';
import { useRecordingCancellation } from '../pi-chat-voice/use-hold-to-record';
import { chatTextFor } from '../pi-chat/locale';
import { useBackLayer } from '../utils/back';
import { parseAgentLink } from './agent-link';
import { sidebarKey } from './sidebar-resize';
import { closeShellLayer, registerAgentLayerCloser } from './shell-layer';
import type { AppShellLocale } from './text';
import { AgentContextProvider } from './agent-context';
import type { ShellPanel } from './shell-panel';
import { LayerContext, PEEK_BAR_REM, PEEK_REM, SIDE_KEY, TOGETHER_QUERY, Z, useInternal } from './layer-context';
import type { AgentComposer, AgentLayerApi, AgentLayerState, AgentMode, AgentPreview, AgentSpec, DockSide, Internal, Snap, Which } from './layer-context';
import { Chats } from './agent-chats';
import { usePane } from './agent-pane';
export { AgentTrigger } from './agent-trigger';
export { AgentComposerAnchor, AgentDockLayout, AgentLayer } from './agent-placements';
export { isOverlayEvent, nextSnapOnClose } from './agent-compact';
export type { AgentComposer, AgentLayerApi, AgentLayerState, AgentPreview, AgentSpec, AgentWords } from './layer-context';

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
  const { state, showing, open, closeShowing: close, talkAbout, expanded, agent: spec, preview, pane } = useInternal();
  const agent = spec?.controller;
  return useMemo(() => ({ state, showing, open, close, talkAbout, expanded, agent, preview, pane }), [state, showing, open, close, talkAbout, expanded, agent, preview, pane]);
}

/** Push-to-talk uses the same dictation lifecycle as page targeting, over the existing composer/controller. */
function useVoice(agent: AgentSpec | undefined, locale: AppShellLocale | undefined, done: (outcome: 'sent' | 'drafted') => void): Voice {
  return useChatVoice({ controller: agent?.controller, voice: agent?.voice, attachments: agent?.chatProps?.attachments,
    labels: chatTextFor(locale ?? agent?.chatProps?.locale).labels, onDone: done });
}

/** The height in px of the tab bar the peek sits above (`--app-shell-tabbar` on the shell root), and one rem. */
function useMeasuredPeek(probe: RefObject<HTMLDivElement | null>, peekRem: number, extra = 0): { readonly peekPoint: string; readonly tabbar: number } {
  const [px, setPx] = useState(peekRem * 16);
  const [tabbar, setTabbar] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const tab = probe.current?.offsetHeight ?? 0;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setPx(Math.round(peekRem * rem + tab + extra));
      setTabbar(tab);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' || !probe.current ? undefined : new ResizeObserver(measure);
    if (observer && probe.current) observer.observe(probe.current);
    return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
  }, [probe, peekRem, extra]);
  return { peekPoint: `${px}px`, tabbar };
}
/** Places the layer in the app. `agent` is the one assistant; `panel` sits beside the app (the product manager). Either may be absent. */
export function AgentLayerProvider({ agent: own, panel: improve, locale, agentLink, appName, composer = 'dock', modeIdentity, children }: { readonly modeIdentity?: { readonly app?: string | undefined; readonly person?: string | undefined; readonly screen?: boolean | undefined } | undefined; readonly composer?: AgentComposer | undefined; readonly agent?: AgentSpec | undefined; readonly panel?: ShellPanel | undefined; readonly locale?: AppShellLocale | undefined; readonly agentLink?: false | undefined; readonly appName?: string | undefined; readonly children: ReactNode }): ReactElement {
  const compact = usePhone();
  const expanded = !compact;
  const together = useMedia(TOGETHER_QUERY) && expanded;
  const [snapState, setSnapState] = useState<Snap>('closed');
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
  // `bar` on a phone (AC-20): the one composer is never closed away; at rest it is the peek, the field right above the tabs. Close and Échap come back here.
  const snap: Snap = composer === 'bar' && compact && agent !== undefined && shown === 'agent' && snapState === 'closed' ? 'peek' : snapState;
  // The phone's peek grows by the card's height, so the card shows above the field and the field stays where it was relative to the tabs.
  const [cardPx, setCardPx] = useState(0);
  const probe = useRef<HTMLDivElement>(null);
  const { peekPoint, tabbar } = useMeasuredPeek(probe, composer === 'bar' && own !== undefined ? PEEK_BAR_REM : PEEK_REM, compact ? cardPx : 0);
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
  const [phoneCard, setPhoneCard] = useState<HTMLElement | null>(null);
  const cardSlot = anchor?.card ?? columnCard ?? (composer === 'bar' ? phoneCard : null);
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

  const holdSend = useRef(false);
  const voice = useVoice(agent, locale, outcome => {
    if (outcome !== 'drafted') return;
    // A hold in the one composer: release sends the words, and like any send it opens nothing (AC-11, AC-25).
    if (holdSend.current) { holdSend.current = false; void specs.current.agent?.controller.send().catch(() => {}); return; }
    // A tap in the one composer: the words wait in the field for review, where the person is.
    if (bar) return;
    toAgent(); setSnapState('half');
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
  // `bar` on a wide screen: a send never opens the conversation; the work and then the reply show on the field (Julien). The chevron opens it.
  const onSent = useCallback(() => {
    if (bar && specs.current.expanded) return;
    if (specs.current.snap === 'closed' || specs.current.shown !== 'agent') open('agent');
  }, [open, bar]);
  // On a wide content composer the reply is a tray above the field unless the person chose the dock; elsewhere the dock (or the phone's drawer) as before.
  // `bar`: the right column holds one thing at a time (D7). Docked, the pane stacks on top of the conversation in that column; otherwise it takes the column itself.
  const trayOpen = contentComposer && snap !== 'closed' && shown === 'agent' && mode === 'tray';
  const dockOpen = snap !== 'closed' && shown !== 'improve' && (!contentComposer || mode === 'dock');
  // Folded: the card of the work and the reply sits on the field: above it in the column on a wide screen, in the drawer's peek on a phone.
  const folded = bar && (contentComposer ? !trayOpen && !dockOpen : snap === 'peek' && shown === 'agent');
  const uncover = useCallback(() => { if (specs.current.snap === 'half' || specs.current.snap === 'full') setSnapState('peek'); }, []);
  const field = useCallback(() => composerSlotRef.current?.querySelector<HTMLElement>('[data-testid=composer-input]') ?? host?.querySelector<HTMLElement>('[data-spec=agent] [data-testid=composer-input]'), [host]);
  // The right pane and its back stack (agent-pane.tsx): `preview` is a push, `preview(null)` closes it.
  const { stack, pane, openLibrary, openFile, step, presented } = usePane({ agent, bar, compact, locale: locale ?? agent?.chatProps?.locale, field, uncover,
    storageKey: sidebarKey('agent-pane', modeIdentity?.app, modeIdentity?.person) });
  const preview = useCallback((next: AgentPreview | null) => { if (next) return pane.push(next); if (!bar) return false; pane.close(); return true; }, [pane, bar]);
  const paneStacked = bar && expanded && stack.length > 0 && dockOpen && shown === 'agent';
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the tray is gone with the content composer (a phone width, a lost agent): the fill state goes with it
  useEffect(() => { if (!trayOpen && grown) setGrown(false); }, [trayOpen, grown]);
  const value = useMemo<Internal>(() => ({
    state, showing: snap !== 'closed' ? shown : improveOpen ? 'improve' : null, open, close, closeShowing, talkAbout, talkRecording, expanded, agent, improve, snap, setSnap, dockFloating, setDockFloating, showAgent, besidePanel, triggerUntil, voice, peekPoint, tabbar, host, locale, side, setSide, restoreFocus, contentComposer, contentColumn, composerSlot, dropZone, setComposerSlot: setSlot, anchored: anchor !== null, setAnchor, setDropZone, onSent, mode, setMode, moveToDock, registerDock, grown, setGrown, trayOpen, dockOpen,
    bar, folded, cardSlot, setCardSlot, setPhoneCard, cardPx, setCardPx, stack, paneStacked, preview, pane, openLibrary, openFile, step, presented, holdSend,
  }), [state, snap, shown, improveOpen, open, close, closeShowing, talkAbout, talkRecording, expanded, agent, improve, setSnap, dockFloating, showAgent, besidePanel, triggerUntil, voice, peekPoint, tabbar, host, locale, side, setSide, contentComposer, contentColumn, composerSlot, dropZone, setSlot, anchor, onSent, mode, setMode, moveToDock, registerDock, grown, trayOpen, dockOpen, bar, folded, cardSlot, stack, paneStacked, preview, pane, openLibrary, openFile, step, presented, cardPx]);

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

'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { BellIcon, ChevronDownIcon, CircleAlertIcon, CircleCheckIcon, ExternalLinkIcon, GripVerticalIcon, Loader2Icon, MessageCircleQuestionIcon, MinusIcon, PanelLeftIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageScroller, MessageScrollerProvider, MessageScrollerViewport, MessageScrollerContent, MessageScrollerButton } from '@/components/ui/message-scroller';
import { Toggle } from '@/components/ui/toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { BlockActions } from '../button/actions';
import type { BlockAction, BlockIcon } from '../button/actions';
import { useChatPlacement } from '../pi-chat/use-remote-chat';
import { CopyButton } from '../pi-chat/code-block';
import { Composer } from '../pi-chat/composer';
import type { ComposerFeedback, ComposerProps } from '../pi-chat/composer';
import { ConversationFiles } from '../pi-chat/conversation-files';
import type { ConversationsConfig } from '../pi-chat/config';
import { notifyPermission, requestNotifyPermission } from './browser-notify';
import type { NotifyPermission } from './browser-notify';
import { ConversationHistory, TranscriptHistory } from '../pi-chat/history';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';
import { TranscriptChunk } from '../pi-chat/message';
import type { RowContext } from '../pi-chat/message';
import { ChatNotices, Notice, PreparingStatus, preparing } from '../pi-chat/notice';
import { AgentNotifications, KindIcon, createNotificationStore, defaultNotificationLabels, finishNotice, noticeTextOf, pendingQuestion, useNotifications } from './notifications';
import type { AgentNotification, NotificationLabels, NotificationStore } from './notifications';
import { ChatTextProvider, defaultChatIcons, defaultChatLabels, useMergedText } from '../pi-chat/labels';
import type { ChatIcons, ChatLabels } from '../pi-chat/labels';
import { MessageQueue } from '../pi-chat/queue';
import { artifactKey, collectArtifacts } from '../pi-artifacts/artifact';
import type { ArtifactDescriptor, ArtifactsConfig } from '../pi-artifacts/artifact';
import { artifactCards } from '../pi-artifacts/artifact-card';
import { PAGE_FIRST, PAGE_MORE, useChatSession, useRowChunks, useTranscript } from '../pi-chat/session';
import type { ChatFeatureProps, ChatSession } from '../pi-chat/session';
import { ArtifactWorkspace } from '../pi-workspace/workspace';
import type { WorkspacePanelApi } from '../pi-workspace/workspace';
import { cn, PHONE_BELOW } from '../utils/utils';

export { AgentNotifications, createNotificationStore, defaultNotificationLabels, frenchNotificationLabels, noticeTextOf, summaryOf, useNotifications, watchConversation } from './notifications';
export type { AgentNotification, AgentNotificationsProps, NewNotification, NotificationKind, NotificationLabels, NotificationStore } from './notifications';

const elapsedText = (seconds: number) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;

/** The floating window's own words, over the chat's (`defaultChatLabels`) and the toasts' (`defaultNotificationLabels`). */
export const defaultAmbientLabels = {
  ...defaultChatLabels,
  ...defaultNotificationLabels,
  /** Shown while the conversation has no title of its own (the active item of `conversations` provides one). */
  title: 'Agent',
  /** The input's placeholder while idle. */
  placeholder: 'Do anything',
  /** The input's placeholder while the agent works. */
  working: (seconds: number) => `Working for ${elapsedText(seconds)}`,
  region: (title: string) => `Agent: ${title}`,
  openAgent: (title: string, unread: boolean) => `Open agent: ${title}${unread ? ' (new activity)' : ''}`,
  openChat: (title: string) => `Open chat: ${title}`,
  minimize: 'Minimise',
  switchConversation: 'Switch conversation',
  statusWorking: 'Working',
  enableNotifications: 'Notify me when the page is in the background',
  dock: 'Dock chat',
  dockHint: 'Dock chat beside the panel',
  move: 'Move the agent window (arrow keys, Home resets)',
  moveHint: 'Drag to move',
  goodResponse: 'Good response',
  badResponse: 'Bad response',
  openFull: 'Open in full chat',
  empty: 'Ask the agent to do something.',
  loadFailedShort: 'Could not load the conversation.',
  disconnectedShort: 'Disconnected.',
  artifactPanel: 'Artifact panel',
};
export type AmbientLabels = ChatLabels & NotificationLabels & typeof defaultAmbientLabels;

/** The floating window's icons, over the chat's. */
export const defaultAmbientIcons = {
  ...defaultChatIcons,
  minimize: MinusIcon as BlockIcon,
  dock: PanelLeftIcon as BlockIcon,
  grip: GripVerticalIcon as BlockIcon,
  switchConversation: ChevronDownIcon as BlockIcon,
  notify: BellIcon as BlockIcon,
  openFull: ExternalLinkIcon as BlockIcon,
  goodResponse: ThumbsUpIcon as BlockIcon,
  badResponse: ThumbsDownIcon as BlockIcon,
};
export type AmbientIcons = ChatIcons & typeof defaultAmbientIcons;
const AMBIENT_TEXT = { labels: defaultAmbientLabels as AmbientLabels, icons: defaultAmbientIcons as AmbientIcons };

/** `bar` is the compact bar, `expanded` the same window grown into a chat, `minimized` a small pill. */
export type AmbientState = 'bar' | 'expanded' | 'minimized';

/** What the artifact panel inside the window gets besides the full-screen and close controls: the versions of the open artifact and how to switch. */
export interface AmbientArtifactPanelApi extends WorkspacePanelApi {
  /** Every known version of the open artifact in this conversation, newest first. */
  readonly versions: readonly ArtifactDescriptor[];
  /** True while the panel follows the newest version; false when one older version is pinned. */
  readonly follow: boolean;
  /** `'latest'` follows the newest version; a descriptor from `versions` pins that one. */
  readonly select: (version: ArtifactDescriptor | 'latest') => void;
}

export interface AmbientChatProps extends Omit<ChatFeatureProps, 'artifacts'> {
  readonly controller: NativeChatController;
  /** Artifact cards (`ArtifactsConfig` of `pi-artifacts`); the ambient bar plugs in their card itself. */
  readonly artifacts?: ArtifactsConfig | undefined;
  /** Embed the expanded conversation in a host workspace. Switching this flag changes layout without remounting the transcript or composer. The host supplies the header. */
  readonly embedded?: boolean;
  /**
   * Every word the window shows, over `defaultAmbientLabels` (the chat's labels, the toasts' and its own): `title` while the conversation has
   * none of its own, `placeholder` while idle, `working(seconds)` while the agent works.
   */
  readonly labels?: Partial<AmbientLabels> | undefined;
  /** The window's icons (minimise, dock, grip, …) and the chat's, over `defaultAmbientIcons`. */
  readonly icons?: Partial<AmbientIcons> | undefined;
  /** The agent's avatar before the title in the bar. */
  readonly avatar?: ReactNode;
  /** Host actions in the bar, before Dock: `header` ones as buttons, `menu` ones in a "…" menu. Test ids `ambient-action-<id>`, the menu `ambient-action-more`. */
  readonly headerActions?: readonly BlockAction[] | undefined;
  /** Host-owned header controls, such as icon-anchored popovers, before the actions and Dock button. */
  readonly headerTools?: ReactNode;
  /** `contrast` is a dark window on any page: the root carries `.dark`, so it shows the host's own dark tokens; `surface` follows the host's theme. */
  readonly variant?: 'contrast' | 'surface';
  /** Controlled window state; otherwise `defaultState` starts it and the window keeps it. */
  readonly state?: AmbientState;
  readonly defaultState?: AmbientState;
  readonly onStateChange?: (state: AmbientState) => void;
  /** Where the bar was dragged is remembered under this key. */
  readonly storageKey?: string;
  /** `session` (default) remembers the position for this browser tab's session; `local` keeps it in `localStorage` across sessions. */
  readonly storage?: 'session' | 'local';
  /** Host controls in the composer row, between the effort picker and Send (for example a voice button the host guards itself). Absent: nothing is shown. */
  readonly tools?: ReactNode;
  /** Host content under the composer (for example a collapsed list of the person's requests). Absent: nothing is shown. */
  readonly belowComposer?: ReactNode;
  /** Two-row reference composer by default; older layouts require an explicit choice. */
  readonly composerLayout?: ComposerProps['layout'];
  /** Hand the conversation to a full `PiChat` or `ArtifactWorkspace`. Adds an "Open in full chat" action to replies. */
  readonly onOpenFull?: (conversationId: string) => void;
  /** Adds thumbs up and down to replies. `value` is `null` when the person takes the rating back. */
  readonly onFeedback?: (reply: { readonly key: string; readonly text: string }, value: 'up' | 'down' | null) => void;
  /** Toasts for finished, failed and waiting tasks. Pass a store to feed it for background conversations too; `false` turns them off. */
  readonly notifications?: NotificationStore | false;
  readonly autoDismissMs?: number;
  readonly maxToasts?: number;
  /** System notifications while the page is hidden. A bell in the header asks for permission when the person chooses to; nothing is asked on load. */
  readonly systemNotifications?: boolean;
  /**
   * The viewer shown inside the window when an artifact card is opened: the window widens into chat on the left and this panel on the right
   * (`ArtifactWorkspace`: draggable divider, full screen, a full-screen sheet on a phone). Build it from the viewer registry (`ViewerFrame`, ...),
   * wrapped in `ViewerWindowProvider` with `api.fullscreen` / `api.onFullscreenChange` so its bar shows the full screen button.
   */
  readonly artifactPanel?: (artifact: ArtifactDescriptor, api: AmbientArtifactPanelApi) => ReactNode;
  /** `window` (default when `artifactPanel` is given) opens artifacts inside the window; `host` calls `artifacts.open` instead, for hosts that show them in their own viewer. */
  readonly artifactTarget?: 'window' | 'host';
  /** The title's ⌄ opens this list to switch conversations or tasks. */
  readonly conversations?: ConversationsConfig;
  /** Adds a "Dock chat" action to the header, for a host that floats this window out of a docked chat (`ArtifactWorkspace` with `floatBelow`). It shares the controller with the docked `PiChat`, so nothing is lost. */
  readonly onDock?: () => void;
  /** The optional annotate toggle and notes chip in the composer (the registry `feedback` item's `useComposerFeedback`). Omit it and nothing changes. */
  readonly feedback?: ComposerFeedback;
  readonly className?: string;
}

interface Position { readonly right: number; readonly bottom: number }
const MARGIN = 8, DEFAULT_POSITION: Position = { right: 16, bottom: 16 };

function storageFor(persist: 'session' | 'local'): Storage | undefined { try { return persist === 'local' ? globalThis.localStorage : globalThis.sessionStorage; } catch { return undefined; } }
function readPosition(key: string, persist: 'session' | 'local'): Position | undefined {
  try {
    const value: unknown = JSON.parse(storageFor(persist)?.getItem(key) ?? 'null');
    const { right, bottom } = (value ?? {}) as { right?: unknown; bottom?: unknown };
    return typeof right === 'number' && typeof bottom === 'number' && Number.isFinite(right) && Number.isFinite(bottom) ? { right, bottom } : undefined;
  } catch { return undefined; }
}
function writePosition(key: string, persist: 'session' | 'local', position: Position) {
  try { storageFor(persist)?.setItem(key, JSON.stringify(position)); } catch { /* the position is a convenience */ }
}
const clamp = (position: Position, size: { w: number; h: number }, viewport: { w: number; h: number }): Position => ({
  right: Math.round(Math.min(Math.max(MARGIN, position.right), Math.max(MARGIN, viewport.w - size.w - MARGIN))),
  bottom: Math.round(Math.min(Math.max(MARGIN, position.bottom), Math.max(MARGIN, viewport.h - size.h - MARGIN))),
});

// The layout viewport that fixed positioning uses (without scrollbars), not the window's outer size.
const viewportSize = () => { const root = globalThis.document?.documentElement; return { w: root?.clientWidth || globalThis.innerWidth || 1024, h: root?.clientHeight || globalThis.innerHeight || 768 }; };
export function usePhone(): boolean {
  const query = `(max-width: ${PHONE_BELOW - 1}px)`;
  const [phone, setPhone] = useState(() => globalThis.matchMedia?.(query).matches === true);
  useEffect(() => {
    const list = globalThis.matchMedia?.(query);
    if (!list) return;
    const update = () => setPhone(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return phone;
}

/** Whole seconds since `active` became true; 0 while inactive. */
function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the count restarts at 0 whenever `active` flips; the interval below owns it after that
    if (!active) { setSeconds(0); return; }
    const started = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

/** Pushes a toast when a run finishes or fails and when a question starts waiting; takes it back when the question is answered or a new run starts. */
function useRunFeed({ enabled, store, conversationId, title, session, suppress, onOutcome, waiting, notice }: {
  readonly enabled: boolean; readonly store: NotificationStore; readonly conversationId: string; readonly title: string; readonly session: ChatSession; readonly waiting: string; readonly notice: NoticeText;
  readonly suppress: () => boolean; readonly onOutcome: (outcome: 'done' | 'error' | null) => void;
}) {
  const { working, waitingForAnswer, rows, connected } = session;
  const before = useRef({ working, waiting: waitingForAnswer });
  const latest = useRef({ rows, title, suppress, onOutcome, connected, waiting, notice });
  useLayoutEffect(() => { latest.current = { rows, title, suppress, onOutcome, connected, waiting, notice }; });
  useEffect(() => {
    const was = before.current;
    before.current = { working, waiting: waitingForAnswer };
    const now = latest.current;
    if (working && !was.working) { now.onOutcome(null); store.dismiss(`${conversationId}:done`); }
    if (!enabled) return;
    if (waitingForAnswer && !was.waiting && !now.suppress()) store.push({ id: `${conversationId}:input`, kind: 'input', title: now.title, summary: pendingQuestion(now.rows, now.notice) ?? now.waiting, conversationId });
    if (!waitingForAnswer && was.waiting) store.dismiss(`${conversationId}:input`);
    if (was.working && !working && now.connected) {
      const finished = finishNotice(now.rows, now.notice);
      if (!finished) return;
      now.onOutcome(finished.kind);
      if (!now.suppress()) store.push({ id: `${conversationId}:done`, kind: finished.kind, title: now.title, summary: finished.summary, conversationId });
    }
  }, [working, waitingForAnswer, enabled, store, conversationId]);
}

/** A compact floating agent bar over an existing page; it grows into a chat window in place. Borrows a concrete native controller like `PiChat`. */
/** The ambient bar comes with every composer feature item (`withChatPlugins`); a component the host passes is kept. */
export function AmbientChat(given: AmbientChatProps) {
  const props = withChatPlugins(given);
  // eslint-disable-next-line react-hooks/refs -- the session's async callbacks compare against the controller of the latest render; assigned in render so a child's effects never see the previous one
  const active = useRef(props.controller); active.current = props.controller;
  const [mount, setMount] = useState({ controller: props.controller, sequence: 0 });
  if (mount.controller !== props.controller) setMount({ controller: props.controller, sequence: mount.sequence + 1 });
  // The window state and the toasts belong to the bar, not to one conversation: they survive switching conversations.
  const [local, setLocal] = useState<AmbientState>(props.defaultState ?? 'bar');
  if (props.embedded && local !== 'expanded') setLocal('expanded');
  const internalStore = useMemo(() => createNotificationStore(), []);
  const text = useMergedText<AmbientLabels, AmbientIcons>(props.labels, props.icons, AMBIENT_TEXT);
  return <ChatTextProvider value={text}><MessageScrollerProvider key={mount.sequence} autoScroll><AmbientSession {...props} labels={text.labels} icons={text.icons} activeController={active} windowState={props.embedded ? 'expanded' : props.state ?? local} store={props.notifications || internalStore}
    onWindowState={next => { if (props.state === undefined) setLocal(next); props.onStateChange?.(next); }} /></MessageScrollerProvider></ChatTextProvider>;
}

type SessionProps = Omit<AmbientChatProps, 'labels' | 'icons'> & { readonly labels: AmbientLabels; readonly icons: AmbientIcons; readonly activeController: { readonly current: NativeChatController }; readonly windowState: AmbientState; readonly store: NotificationStore; readonly onWindowState: (state: AmbientState) => void };

function AmbientSession({ controller, embedded = false, labels, icons, avatar, headerActions, headerTools, messageActions, variant = 'contrast', mode = 'expert', presentation, voiceReplay, actions,
  windowState, onWindowState, store, storageKey = 'boring.ambient.position', storage = 'session', tools, belowComposer, composerChips, composerLayout = 'card', onOpenFull, onFeedback, notifications, autoDismissMs, maxToasts, systemNotifications = false,
  renderEntry, hideLine, displayLimit, paging, historicalMessageActions, unread: replyUnread, replyError, renderTool, toolRenderers, renderText, cards, groupTool, commandMentions, onOpenImage, onCopy, onComposerKeyDown, fileAccept = 'image/*', slash, mentions, attachments, onOpenFile, fileChanges, pasteToFile, model, effort, replyFooter, artifacts: hostArtifacts, artifactPanel, artifactTarget, conversations, onDock, feedback: composerFeedback, className,
  activeController }: SessionProps) {
  const { title } = labels;
  useChatPlacement(controller, embedded ? 'docked' : 'floating');
  const stateRef = useRef(windowState);
  useLayoutEffect(() => { stateRef.current = windowState; });
  // The artifact open inside the window, and whether it follows the newest version. It belongs to the expanded window: leaving that state closes it.
  const [opened, setOpened] = useState<{ readonly descriptor: ArtifactDescriptor; readonly follow: boolean } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const setWindowState = (next: AmbientState) => {
    if (next !== 'expanded') { setOpened(null); setFullscreen(false); }
    if (next !== stateRef.current) onWindowState(next);
  };
  const expanded = windowState === 'expanded', minimized = windowState === 'minimized';
  const phone = usePhone();
  const root = useRef<HTMLDivElement>(null), titleButton = useRef<HTMLButtonElement>(null), pill = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const [feedback, setFeedback] = useState<Readonly<Record<string, 'up' | 'down'>>>({});
  const [outcome, setOutcome] = useState<'done' | 'error' | null>(null);
  const [permission, setPermission] = useState<NotifyPermission>('unsupported');
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's permission is read once after mount, so the server render and hydration agree on 'unsupported'
  useEffect(() => { setPermission(notifyPermission()); }, []);
  useEffect(() => { if (!outcome) return; const timer = setTimeout(() => setOutcome(null), 8000); return () => clearTimeout(timer); }, [outcome]);

  // Replies get copy, optional feedback and the time; the host may hand the conversation to its full chat.
  const conversationRef = useRef('');
  const replyActions = useMemo<NonNullable<RowContext['replyActions']>>(() => (reply, host) => <div data-testid="reply-actions" className="mt-2 -ml-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 max-sm:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none">
    <CopyButton text={reply.text} label={labels.copyResponse} iconOnly {...(onCopy ? { onCopy } : {})} />
    {onFeedback && <>
      {(['up', 'down'] as const).map(value => <Toggle key={value} data-testid={`feedback-${value}`} pressed={feedback[reply.key] === value} aria-label={value === 'up' ? labels.goodResponse : labels.badResponse}
        title={value === 'up' ? labels.goodResponse : labels.badResponse}
        onPressedChange={pressed => { const next = pressed ? value : null; setFeedback(current => { const { [reply.key]: _removed, ...rest } = current; return next ? { ...rest, [reply.key]: next } : rest; }); onFeedback({ key: reply.key, text: reply.text }, next); }}>
        {value === 'up' ? <icons.goodResponse data-icon="inline-start" aria-hidden="true" /> : <icons.badResponse data-icon="inline-start" aria-hidden="true" />}</Toggle>)}
    </>}
    {onOpenFull && <Button variant="ghost" size="icon" data-testid="open-full" aria-label={labels.openFull} title={labels.openFull} onClick={() => onOpenFull(conversationRef.current)}><icons.openFull data-icon="inline-start" aria-hidden="true" /></Button>}
    {host}
    {reply.timestamp !== undefined && <time dateTime={new Date(reply.timestamp).toISOString()} data-testid="reply-time" className="ml-1.5 text-xs tabular-nums text-muted-foreground">{new Date(reply.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>}
  </div>, [onCopy, onFeedback, onOpenFull, feedback, labels, icons]);
  const scrollToBottom = useRef<() => void>(() => {});
  const rowExtras = useMemo(() => ({ replyActions }), [replyActions]);
  const inWindow = Boolean(artifactPanel) && artifactTarget !== 'host';
  const detect = hostArtifacts?.detect;
  const versionsRef = useRef<readonly ArtifactDescriptor[]>([]);
  const artifacts = useMemo<ArtifactsConfig | undefined>(() => !inWindow ? hostArtifacts : {
    open: descriptor => { const newest = versionsRef.current.filter(version => artifactKey(version) === artifactKey(descriptor)).reduce((top, version) => Math.max(top, version.ordinal ?? 0), 0); setOpened({ descriptor, follow: (descriptor.ordinal ?? 0) >= newest }); },
    isOpen: descriptor => opened !== null && artifactKey(opened.descriptor) === artifactKey(descriptor) && (opened.follow ? (descriptor.ordinal ?? 0) >= (versionsRef.current.find(version => artifactKey(version) === artifactKey(descriptor))?.ordinal ?? 0) : descriptor.revision === opened.descriptor.revision),
    ...(detect ? { detect } : {}),
    ...(hostArtifacts?.kinds ? { kinds: hostArtifacts.kinds } : {}),
    recognise: hostArtifacts?.recognise ?? artifactCards.recognise, Card: hostArtifacts?.Card ?? artifactCards.Card,
  }, [inWindow, hostArtifacts, opened, detect]);
  const session = useChatSession({ controller, activeController, mode, presentation, voiceReplay, actions, renderEntry, hideLine, historicalMessageActions, unread: replyUnread, replyError, renderTool, toolRenderers, renderText, cards, groupTool, commandMentions, onOpenImage, onCopy, onComposerKeyDown, fileAccept,
    slash, mentions, attachments, model, effort, artifacts, messageActions, replyFooter, afterSend: () => scrollToBottom.current(), rowExtras, feedback: composerFeedback, onOpenFile, fileChanges, pasteToFile, composerChips });
  const { state, derived, rows, queued, queueActions, working, waitingForAnswer, connected, error, act, textarea, rowContext, composer, files, loading } = session;
  const empty = session.empty;
  const transcript = useTranscript(rows, displayLimit ?? paging?.first ?? PAGE_FIRST, paging?.more ?? PAGE_MORE, { state: state.history, connected: !state.disposed && connected, load: controller.loadEarlier }, displayLimit === undefined);
  const { stick: { scrollRef, isAtBottom, scrollToBottom: stickToBottom }, hidden } = transcript;
  const chunks = useRowChunks(useMemo(() => hidden ? rows.slice(hidden) : rows, [rows, hidden]));
  const versions = useMemo(() => inWindow ? collectArtifacts(state.view, detect).sort((a, b) => (b.ordinal ?? 0) - (a.ordinal ?? 0)) : [], [inWindow, state.view, detect]);
  // eslint-disable-next-line react-hooks/refs -- the artifact config reads the versions of the latest render; a ref keeps it from rebuilding on every streamed token
  versionsRef.current = versions;
  const known = opened ? versions.filter(version => artifactKey(version) === artifactKey(opened.descriptor)) : [];
  const shownArtifact = opened ? (opened.follow ? known[0] ?? opened.descriptor : opened.descriptor) : undefined;
  const { reset } = transcript;
  useLayoutEffect(() => { scrollToBottom.current = () => { reset(); void stickToBottom('instant'); }; });
  const { barStart, barNote } = session.pickers();

  const conversationId = String(conversations?.activeId ?? state.conversationId);
  useLayoutEffect(() => { conversationRef.current = conversationId; });
  const activeItem = conversations?.items.find(item => item.id === conversations.activeId);
  const shownTitle = activeItem?.title?.trim() || title;
  const toasts = useNotifications(store);
  useRunFeed({ enabled: notifications !== false, store, conversationId, title: shownTitle, session, onOutcome: setOutcome, waiting: labels.waitingForAnswer, notice: noticeTextOf(labels),
    suppress: () => stateRef.current === 'expanded' && globalThis.document?.visibilityState !== 'hidden' });
  const unread = !expanded && toasts.length > 0;
  const seconds = useElapsed(working);

  // Position: offsets from the bottom right corner, remembered for the session, clamped to the viewport at render so a smaller window restores them.
  const [position, setPosition] = useState<Position>(() => readPosition(storageKey, storage) ?? DEFAULT_POSITION);
  const [viewport, setViewport] = useState(viewportSize);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const onResize = () => setViewport(viewportSize());
    globalThis.addEventListener('resize', onResize);
    return () => globalThis.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSize({ w: element.offsetWidth, h: element.offsetHeight }));
    observer.observe(element);
    setSize({ w: element.offsetWidth, h: element.offsetHeight });
    return () => observer.disconnect();
  }, [minimized, expanded]);
  // The size and the viewport also follow every render, so the clamp below never works from a stale measurement (the title or status icon can change the pill's width; a scrollbar can appear without a resize event).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- measures after every commit on purpose; both setters return the current value when nothing changed, so it settles
  useLayoutEffect(() => {
    const element = root.current;
    const fresh = viewportSize();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- layout reads (viewport, own size) exist only after commit and must land before paint
    setViewport(current => current.w === fresh.w && current.h === fresh.h ? current : fresh);
    if (element) setSize(current => current.w === element.offsetWidth && current.h === element.offsetHeight ? current : { w: element.offsetWidth, h: element.offsetHeight });
  });
  const placed = clamp(position, size, viewport);
  // Moves and the release are followed on the window, so a drag keeps working when the pointer leaves the handle (and when pointer capture is unavailable).
  // `threshold` is how far the pointer must travel before it is a drag: a click on the pill (threshold > 0) still restores it.
  const dragged = useRef(false);
  const beginDrag = (event: PointerEvent<HTMLElement>, threshold: number) => {
    if (phone || event.button !== 0) return;
    dragged.current = false;
    const origin = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: placed };
    let last = origin.start, moving = threshold === 0;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== origin.pointer) return;
      if (!moving) { if (Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < threshold) return; moving = true; dragged.current = true; }
      last = clamp({ right: origin.start.right - (next.clientX - origin.x), bottom: origin.start.bottom - (next.clientY - origin.y) }, size, viewport);
      setPosition(last);
    };
    const end = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== origin.pointer) return;
      globalThis.removeEventListener('pointermove', move); globalThis.removeEventListener('pointerup', end); globalThis.removeEventListener('pointercancel', end);
      if (moving) writePosition(storageKey, storage, last);
    };
    globalThis.addEventListener('pointermove', move); globalThis.addEventListener('pointerup', end); globalThis.addEventListener('pointercancel', end);
  };
  const onGripDown = (event: PointerEvent<HTMLButtonElement>) => { event.preventDefault(); beginDrag(event, 0); };
  // Arrow keys move the window (Shift for big steps); Home puts it back in the default corner.
  const onGripKey = (event: KeyboardEvent<HTMLElement>) => {
    if (phone) return;
    const step = event.shiftKey ? 64 : 16;
    const delta = event.key === 'ArrowLeft' ? { right: step, bottom: 0 } : event.key === 'ArrowRight' ? { right: -step, bottom: 0 } : event.key === 'ArrowUp' ? { right: 0, bottom: step } : event.key === 'ArrowDown' ? { right: 0, bottom: -step } : undefined;
    if (!delta && event.key !== 'Home') return;
    event.preventDefault();
    const next = delta ? clamp({ right: placed.right + delta.right, bottom: placed.bottom + delta.bottom }, size, viewport) : clamp(DEFAULT_POSITION, size, viewport);
    setPosition(next); writePosition(storageKey, storage, next);
  };
  const grip = (className?: string) => <Button variant="ghost" size="icon" data-testid="ambient-grip" aria-label={labels.move} title={labels.moveHint} onPointerDown={onGripDown} onKeyDown={onGripKey}
    className={cn('touch-none', className)}><icons.grip data-icon="inline-start" aria-hidden="true" /></Button>;

  const expand = () => { setOutcome(null); store.dismissConversation(conversationId); setWindowState('expanded'); };
  const latestExpand = useRef(expand);
  useLayoutEffect(() => { latestExpand.current = expand; });
  useEffect(() => {
    if (expanded && !globalThis.matchMedia?.('(pointer: coarse)').matches) textarea.current?.focus();
  }, [expanded, textarea]);
  // The title is disabled while the window is open, so focus goes back to it once the bar is showing again.
  const refocusTitle = useRef(false);
  useEffect(() => { if (!expanded && refocusTitle.current) { refocusTitle.current = false; titleButton.current?.focus(); } }, [expanded]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (embedded || event.key !== 'Escape' || event.defaultPrevented || !expanded || picking) return;
    event.preventDefault();
    // Escape steps back: full screen, then the artifact, then the window.
    if (fullscreen) return setFullscreen(false);
    if (opened) return setOpened(null);
    refocusTitle.current = true;
    setWindowState('bar');
  };
  const onActivate = useCallback((item: AgentNotification) => {
    if (item.conversationId !== undefined && item.conversationId !== conversationId) conversations?.onSelect(item.conversationId);
    latestExpand.current();
  }, [conversationId, conversations]);

  const connectionKind = state.connection.kind;
  const status = waitingForAnswer ? 'input' : working ? 'working' : outcome;
  const label = waitingForAnswer ? labels.waitingForAnswer : labels.working(seconds);
  const panelOpen = expanded && shownArtifact !== undefined && artifactPanel !== undefined;
  // The floating window is drawn by the host's Card behind it (a sibling layer, so switching placement never remounts the chat);
  // embedded and full-screen phone windows are plain page regions.
  const card = !embedded && !(phone && expanded);
  const surface = embedded ? 'relative flex min-h-0 flex-1 flex-col overflow-clip bg-transparent text-foreground' : cn('relative flex flex-col', card ? 'isolate' : 'h-dvh bg-background pt-[env(safe-area-inset-top)] text-foreground',
    !phone && expanded && (panelOpen ? 'h-full overflow-hidden' : 'max-h-[70dvh]'));
  // With an artifact open the window widens (most of the viewport, at most 72rem) and takes a fixed height so the panel fills it.
  const rootClass = embedded ? cn('pi-chat relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className) : cn('pi-chat pi-ambient fixed z-50', variant === 'contrast' && 'dark scheme-dark', phone ? (expanded ? 'inset-0' : 'inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))]')
    : cn('transition-[width] motion-reduce:transition-none', minimized ? 'w-auto' : panelOpen ? 'h-[min(46rem,calc(100dvh-1rem))] w-[min(72rem,calc(100vw-1rem))]' : expanded ? 'w-[min(35rem,calc(100vw-1rem))]' : 'w-[min(26rem,calc(100vw-1rem))]'), className);
  const rootStyle = phone || embedded ? undefined : { right: placed.right, bottom: placed.bottom };

  if (minimized) return <div ref={root} data-boring="ambient-chat" data-state="minimized" data-variant={variant} className={cn(rootClass, phone && 'flex justify-end')} style={rootStyle} onKeyDown={onKeyDown}>
    {notifications !== false && <AgentNotifications store={store} variant={variant} placement="inline" systemNotifications={systemNotifications} onActivate={onActivate} labels={labels}
      {...(autoDismissMs !== undefined ? { autoDismissMs } : {})} {...(maxToasts !== undefined ? { max: maxToasts } : {})} className="absolute right-0 bottom-full mb-3 w-[min(26rem,calc(100vw-1rem))]" />}
    <div data-testid="ambient-pill-box" onPointerDown={event => beginDrag(event, 4)} onKeyDown={onGripKey} onClickCapture={event => { if (dragged.current) { dragged.current = false; event.stopPropagation(); event.preventDefault(); } }}
      className={cn('relative flex max-w-[min(20rem,calc(100vw-1rem))] items-center gap-0.5', !phone && 'cursor-grab touch-none select-none active:cursor-grabbing')}>
      {!phone && grip('ml-1.5')}
      <Button ref={pill} variant="outline" size="lg" data-testid="ambient-pill" onClick={() => setWindowState('bar')} aria-label={labels.openAgent(shownTitle, unread)}
        className="relative min-w-0 gap-2.5">
        {status === 'working' ? <Loader2Icon data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          : status === 'input' ? <MessageCircleQuestionIcon data-icon="inline-start" aria-hidden="true" />
          : status === 'done' ? <CircleCheckIcon data-icon="inline-start" aria-hidden="true" />
          : status === 'error' ? <CircleAlertIcon data-icon="inline-start" aria-hidden="true" /> : null}
        <span className="min-w-0 truncate">{shownTitle}</span>
        {unread && <Badge data-testid="ambient-unread" aria-hidden="true" className="absolute -top-1.5 -right-1.5" />}
      </Button>
    </div>
  </div>;

  const conversation = <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header hidden={embedded} data-testid="ambient-header" className={cn(embedded && '!hidden','flex h-12 shrink-0 items-center gap-0.5 px-2 max-sm:h-14 max-sm:px-3')}>
        <Button variant="ghost" size="icon" data-testid="ambient-minimize" aria-label={labels.minimize} title={labels.minimize} onClick={() => { setPicking(false); setWindowState(expanded ? 'bar' : 'minimized'); }}><icons.minimize data-icon="inline-start" aria-hidden="true" /></Button>
        <span data-testid="ambient-status" data-status={status ?? 'idle'} role="img" aria-label={status === 'working' ? labels.statusWorking : status === 'input' ? labels.needsInput : status === 'done' ? labels.finished : status === 'error' ? labels.failedRun : undefined}
          aria-hidden={status ? undefined : 'true'} className={cn('flex shrink-0 items-center justify-center', status ? 'mx-1.5 w-5' : 'w-1.5')}>
          {status === 'working' ? <Loader2Icon className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" /> : status ? <KindIcon kind={status === 'input' ? 'input' : status} className="size-[1.125rem]" /> : null}
        </span>
        {avatar && <Avatar size="sm" data-testid="ambient-avatar" className="overflow-hidden"><AvatarFallback className="*:max-h-full *:max-w-full">{avatar}</AvatarFallback></Avatar>}
        <Button ref={titleButton} variant="ghost" data-testid="ambient-title" onClick={expand} disabled={expanded} aria-label={expanded ? shownTitle : labels.openChat(shownTitle)}
          className="min-w-0 max-w-full shrink"><span className="truncate">{shownTitle}</span></Button>
        {conversations && <Button variant="ghost" size="icon" data-testid="ambient-switch" aria-label={labels.switchConversation} aria-haspopup="dialog" aria-expanded={picking} title={labels.switchConversation} onClick={() => setPicking(open => !open)}>
          <icons.switchConversation data-icon="inline-start" aria-hidden="true" /></Button>}
        {expanded ? <span className="flex-1" /> : <Button variant="ghost" tabIndex={-1} aria-hidden="true" data-testid="ambient-header-fill" onClick={expand} className="min-w-2 flex-1" />}
        {systemNotifications && permission === 'default' && <Button variant="ghost" size="icon" data-testid="ambient-enable-notifications" aria-label={labels.enableNotifications} title={labels.enableNotifications}
          onClick={() => { void requestNotifyPermission().then(setPermission); }}><icons.notify data-icon="inline-start" aria-hidden="true" /></Button>}
        {headerTools}
        <BlockActions actions={headerActions} testId="ambient-action" menuLabel={labels.moreActions} />
        {onDock && !phone && <Button variant="ghost" size="icon" data-testid="ambient-dock" aria-label={labels.dock} title={labels.dockHint} onClick={() => { setPicking(false); onDock(); }}><icons.dock data-icon="inline-start" aria-hidden="true" /></Button>}
        {!phone && grip()}
      </header>

      {expanded && <div className="flex min-h-0 flex-1 flex-col">
        {(connectionKind === 'error' || connectionKind === 'closed') && <div className="px-4 pb-2"><Notice tone={connectionKind === 'error' ? 'error' : 'info'} testid="connection-notice">
          <span className="flex-1">{connectionKind === 'error' ? labels.loadFailed : labels.disconnected}</span>
          {!state.disposed && <Button size="sm" variant="outline" onClick={() => act(controller.connect)}><icons.reconnect data-icon="inline-start" aria-hidden="true" />{labels.reconnect}</Button>}</Notice></div>}
        {derived.pinned.length > 0 && <aside aria-label={labels.requiredActions} className="shrink-0 space-y-2 px-4 pb-2">{derived.pinned.map(card => <div key={card.key}>{card.content}</div>)}</aside>}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <MessageScroller>
            <MessageScrollerViewport ref={scrollRef} data-testid="transcript-scroll" aria-label={labels.messages} className="scrollbar-thumb-border scrollbar-track-transparent">
              {!empty && <TranscriptHistory history={state.history} connected={!state.disposed && connected} onLoad={transcript.reveal} sentinelRef={transcript.sentinelRef} hidden={hidden} loaded={transcript.loaded} />}
              <div className="px-4 pt-4 pb-6">
              <MessageScrollerContent aria-label={labels.messages} aria-live="polite" data-testid="transcript">
                {chunks.map(run => <TranscriptChunk key={run[0]!.key} rows={run} context={rowContext} />)}
                {loading && <p role="status" data-testid="loading" className="m-0 flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{labels.loading}</p>}
                {empty && !loading && <p data-testid="ambient-empty" className="m-0 max-w-sm py-8 text-sm leading-6 text-muted-foreground">{labels.empty}</p>}
              </MessageScrollerContent>
              </div>
            </MessageScrollerViewport>
            {!isAtBottom && <MessageScrollerButton data-testid="jump-latest" aria-label={labels.jumpToLatest} title={labels.jumpToLatest} onClick={transcript.reset}><icons.jumpToLatest aria-hidden="true" /></MessageScrollerButton>}
          </MessageScroller>
        </div>
      </div>}

      {(expanded || !embedded) && <Separator />}
      <div className={cn('shrink-0', phone && 'pb-[env(safe-area-inset-bottom)]')}>
        <div className="space-y-2 px-3 empty:hidden [&:has(*)]:pt-2">
          {preparing({ natural: session.natural, waitingForAnswer, run: derived.run, retry: derived.retry, compacting: derived.compacting, stop: state.stop }) && <PreparingStatus>{derived.stageStatus}</PreparingStatus>}
          <ChatNotices natural={session.natural} state={state} error={error} onReconcile={() => act(controller.reconcile)} onRetry={() => act(controller.retrySameRequest)} />
          {!expanded && (connectionKind === 'error' || connectionKind === 'closed') && <Notice tone="info" testid="connection-notice">
            <span className="flex-1">{connectionKind === 'error' ? labels.loadFailedShort : labels.disconnectedShort}</span>
            {!state.disposed && <Button size="sm" variant="outline" onClick={() => act(controller.connect)}>{labels.reconnect}</Button>}</Notice>}
        </div>
        <div className="px-3 pt-2 pb-3">
          <ConversationFiles files={files} />
          <MessageQueue items={queued} sending={state.outbox} withdraw={actions?.withdraw} actions={queueActions} />
          <Composer {...composer} layout={composerLayout} placeholder={working || waitingForAnswer ? label : labels.placeholder} barStart={barStart} barNote={barNote} barEnd={tools} />
          {belowComposer !== undefined && <div data-testid="below-composer" className="pt-2">{belowComposer}</div>}
        </div>
      </div>
      </section>;
  return <div ref={root} data-boring={embedded ? 'pi-chat' : 'ambient-chat'} data-state={windowState} data-variant={variant} data-phone={phone ? 'true' : undefined} role="region" aria-label={labels.region(shownTitle)}
    className={rootClass} style={rootStyle} onKeyDown={onKeyDown}>
    {!embedded && notifications !== false && !(phone && expanded) && <AgentNotifications store={store} variant={variant} placement="inline" systemNotifications={systemNotifications} onActivate={onActivate} labels={labels}
      {...(autoDismissMs !== undefined ? { autoDismissMs } : {})} {...(maxToasts !== undefined ? { max: maxToasts } : {})} className="absolute right-0 bottom-full mb-3 w-full" />}
    {picking && conversations && <ConversationHistory conversations={conversations} placement={expanded ? 'below' : 'above'} onClose={() => setPicking(false)} />}
    <div data-testid="ambient-surface" className={surface}>
      {card && <Card aria-hidden="true" data-boring="chrome" className="pointer-events-none absolute inset-0 -z-10" />}
      {artifactPanel ? <ArtifactWorkspace open={panelOpen} onClose={() => { setOpened(null); setFullscreen(false); }} fullscreen={fullscreen} onFullscreenChange={setFullscreen} storageKey="boring.ambient.panel-width" panelLabel={labels.artifactPanel}
        defaultWidth={600} minPanel={320} minChat={300} sheetBelow={720}
        panel={api => shownArtifact ? artifactPanel(shownArtifact, { ...api, versions: known, follow: opened?.follow ?? true,
          select: version => setOpened(current => current ? (version === 'latest' ? { descriptor: known[0] ?? current.descriptor, follow: true } : { descriptor: version, follow: false }) : current) }) : null}
        chat={conversation} /> : conversation}
    </div>
  </div>;
}

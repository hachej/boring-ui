'use client';

// `AmbientChat` over the one composer. The floating bar is the shell's composer (`FloatingComposer` of `app-shell`): the same bar, strip, conversation window, icon, grip and remembered place.
// This file keeps the old public props. A prop the one composer takes is delegated to it; a prop it does not take yet (`ambientGap`) keeps the whole bar on the old window (`ambient-window.tsx`)
// so no existing app changes. Background-conversation toasts become the composer's notices; `createNotificationStore` and `watchConversation` keep feeding them.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createNotificationStore, useRunNotifications } from '@hachej/boring-ui-kit/chat-react';
import { FloatingComposer } from '../app-shell/floating-composer';
import type { ScreenHeaderAction } from '../app-shell/header-actions';
import type { BlockAction } from '../button/actions';
import { CircleIcon } from '../_shared/icons';
import { useAgentLayer } from '../app-shell/agent-layer';
import type { AgentLayerApi, AgentSpec } from '../app-shell/layer-context';
import type { AppShellNotice } from '../app-shell/shell-notice';
import { useMergedText } from '../pi-chat/labels';
import type { PiChatProps } from '../pi-chat/pi-chat';
import { useNotifications, noticeTextOf } from './notifications';
import type { AgentNotification, NotificationStore } from './notifications';
import { AmbientWindow, AMBIENT_TEXT } from './ambient-window';
import { notifyPermission, notifyWhenHidden, requestNotifyPermission } from './browser-notify';
import type { NotifyPermission } from './browser-notify';
import type { AmbientChatProps, AmbientIcons, AmbientLabels, AmbientState } from './ambient-window';

export { usePhone, defaultAmbientLabels, defaultAmbientIcons } from './ambient-window';
export type { AmbientArtifactPanelApi, AmbientChatProps, AmbientIcons, AmbientLabels, AmbientState } from './ambient-window';
export { AgentNotifications, createNotificationStore, defaultNotificationLabels, frenchNotificationLabels, noticeTextOf, summaryOf, useNotifications, watchConversation } from './notifications';
export type { AgentNotification, AgentNotificationsProps, NewNotification, NotificationKind, NotificationLabels, NotificationStore } from './notifications';

/**
 * The props the one composer does not take yet: each keeps the bar on the old window. `undefined` means the composer takes every prop the app gave, so the bar is the one composer.
/**
 * The props the one composer does not take yet: each keeps the bar on the old window. None is left (the window content, the toast timing, `className`, `storage`, the old position and the system notifications are on the composer),
 * so `undefined` means the bar is the one composer: a prop added to `AmbientChatProps` that the composer lacks is returned here and listed in `features/ambient.md`.
 */
export function ambientGap(_props: AmbientChatProps): string | undefined {
  return undefined;
}
  return undefined;
}

/** The old header actions as the composer's: a `menu` one stays in « … », a label-only one shows its label. A disabled action does nothing. */
function headerActionsOf(actions: readonly BlockAction[] | undefined): readonly ScreenHeaderAction[] | undefined {
  if (!actions?.length) return undefined;
  return actions.map(action => ({ id: action.id, label: action.label, icon: (action.icon ?? CircleIcon) as ScreenHeaderAction['icon'], ...(action.icon ? {} : { showLabel: 'always' as const }),
    ...(action.placement === 'menu' ? { placement: 'menu' as const } : {}), onSelect: () => { if (!action.disabled) action.onSelect(); } }));
}

/** The window levels the one composer has: folded to its icon, the bar, the conversation open. */
function levelOf(layer: AgentLayerApi): AmbientState {
  return layer.place === 'icon' ? 'minimized' : layer.state === 'closed' || layer.state === 'peek' ? 'bar' : 'expanded';
}

interface BridgeProps {
  readonly state: AmbientState | undefined;
  readonly initial: AmbientState | undefined;
  readonly onChange: (state: AmbientState) => void;
  readonly layerRef: { current: AgentLayerApi | undefined };
}

/** Inside the composer's layer: mirrors its place and open conversation as `AmbientState` (`onStateChange`), and moves it when the host's `state` changes. Draws nothing. */
function StateBridge({ state, initial, onChange, layerRef }: BridgeProps) {
  const layer = useAgentLayer();
  useLayoutEffect(() => { layerRef.current = layer; });
  const level = levelOf(layer);
  const reported = useRef(level);
  const hostState = useRef(state);
  useLayoutEffect(() => { hostState.current = state; });
  const resnap = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const target = useRef<AmbientState | undefined>(undefined);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const move = useCallback((to: AmbientState) => {
    const now = layerRef.current;
    if (!now || levelOf(now) === to) return;
    target.current = to;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => { target.current = undefined; }, 800);
    if (to === 'minimized') { now.setPlace('icon'); return; }
    if (now.place === 'icon') now.setPlace('float');
    if (to === 'expanded') now.open('agent'); else if (levelOf(now) === 'expanded') now.close();
  }, [layerRef]);
  // The host's state (or the one the bar starts in) is applied once the layer exists, and again whenever the host changes it.
  const wanted = state ?? initial;
  const first = useRef(true);
  useEffect(() => { if (wanted !== undefined && (first.current || state !== undefined)) move(wanted); first.current = false; }, [wanted, state, move]);
  useEffect(() => {
    if (target.current !== undefined) { if (level === target.current) { target.current = undefined; clearTimeout(settle.current); } reported.current = level; return; }
    if (reported.current !== level) {
      reported.current = level; onChange(level);
      // A controlled `state` is the host's truth: when the host does not take the person's change (no `onStateChange`, or it keeps its own value), the bar goes back to what the host holds.
      clearTimeout(resnap.current);
      if (hostState.current !== undefined) resnap.current = setTimeout(() => { const want = hostState.current, now = layerRef.current; if (want !== undefined && now && levelOf(now) !== want) move(want); }, RESNAP_MS);
    }
  }, [level, onChange, layerRef, move]);
  useEffect(() => () => { clearTimeout(settle.current); clearTimeout(resnap.current); }, []);
  return null;
}

/** How long a host gets to take the person's change of a controlled `state` before the bar goes back to the host's value. */
const RESNAP_MS = 150;
/** Where the old floating bar kept its dragged position when the app gave no `storageKey`. */
const LEGACY_POSITION_KEY = 'boring.ambient.position';
const TONE = { done: 'success', input: 'warning', error: 'error' } as const;

/** The toasts of a store as the composer's notices, newest first. */
function noticesOf(items: readonly AgentNotification[], labels: AmbientLabels, open: (item: AgentNotification) => void, store: NotificationStore): readonly AppShellNotice[] {
  const word = { done: labels.finished, input: labels.needsInput, error: labels.failedRun } as const;
  return [...items].reverse().map(item => ({ id: `${item.id}:${item.createdAt}`, kind: TONE[item.kind], text: `${item.title}: ${item.summary ?? word[item.kind]}`,
    action: { label: labels.openShort, onSelect: () => { open(item); store.dismiss(item.id); } }, onDismiss: () => store.dismiss(item.id) }));
}

// Words the composer has in the app's language: taken from the app's own `labels` only when it gave them, so `locale` picks the rest.
const SHELL_WORDS = { dock: 'dockChat', openFull: 'openFull', goodResponse: 'goodResponse', badResponse: 'badResponse', artifactPanel: 'artifactPanel' } as const;

/** Inside the layer: a system notification for each new toast while the page is hidden (`systemNotifications`); its click brings the conversation. Draws nothing. */
function SystemNotifier({ items, labels, activate }: { readonly items: readonly AgentNotification[]; readonly labels: AmbientLabels; readonly activate: (layer: Omit<AgentLayerApi, 'agent'>, item: AgentNotification) => void }) {
  const layer = useAgentLayer();
  const seen = useRef(new Set<string>());
  const word = { done: labels.finished, input: labels.needsInput, error: labels.failedRun } as const;
  useEffect(() => {
    for (const item of items) {
      const key = `${item.id}:${item.createdAt}`;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      notifyWhenHidden(item.title, item.summary ?? word[item.kind], item.id, () => { globalThis.focus?.(); activate(layer, item); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `word` is rebuilt every render from `labels`; the toast's own text is read once, when it first shows
  }, [items, layer, activate]);
  return null;
}

/** The notice that offers system notifications while the browser has not been asked: its button is the person's own action, the only moment the permission is requested. */
function useEnableNotice(on: boolean, labels: AmbientLabels): readonly AppShellNotice[] {
  const [permission, setPermission] = useState<NotifyPermission>('unsupported');
  const [declined, setDeclined] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's permission exists only after mount
  useEffect(() => { if (on) setPermission(notifyPermission()); }, [on]);
  return useMemo(() => on && permission === 'default' && !declined ? [{ id: 'ambient-enable-notifications', kind: 'info', text: labels.enableNotifications,
    action: { label: labels.enableShort, onSelect: () => { void requestNotifyPermission().then(setPermission); } }, onDismiss: () => setDeclined(true) }] : [], [on, permission, declined, labels]);
}

const CHAT_WORDS = ['placeholder', 'placeholderWorking', 'messageInput', 'send', 'sendHint', 'stop', 'queue', 'add', 'attachFiles', 'takePhoto', 'commands', 'retry', 'voiceStop', 'voiceCancel', 'emptyDescription'] as const;

function AmbientOnComposer(props: AmbientChatProps) {
  const { controller, labels: givenLabels, icons: givenIcons, variant = 'contrast', state, defaultState, onStateChange, storageKey, notifications, conversations, avatar, tools, belowComposer,
    // Props the composer has no use for (`ambientGap` keeps the ones that matter on the old window): the old window's own position, size and placement.
    embedded, headerActions, headerTools, artifacts, artifactPanel, artifactTarget, onDock, onOpenFull, onFeedback, storage = 'session', systemNotifications = false, autoDismissMs, maxToasts, composerLayout, renderComposer, className, ...rest } = props;
  const { labels, icons } = useMergedText<AmbientLabels, AmbientIcons>(givenLabels, givenIcons, AMBIENT_TEXT);
  const internal = useMemo(() => createNotificationStore(), []);
  const store = notifications || internal;
  const layerRef = useRef<AgentLayerApi | undefined>(undefined);
  const levelRef = useRef<AmbientState>(state ?? defaultState ?? 'bar');
  const snapshotId = useSyncExternalStore(controller.subscribe, () => controller.getSnapshot().conversationId, () => controller.getSnapshot().conversationId);
  const conversationId = String(conversations?.activeId ?? snapshotId);
  const activeItem = conversations?.items.find(item => item.id === conversations.activeId);
  const title = activeItem?.title?.trim() || labels.title;
  useRunNotifications(controller, store, { enabled: notifications !== false && !embedded, conversationId, title, text: noticeTextOf(labels),
    suppress: () => levelRef.current === 'expanded' && globalThis.document?.visibilityState !== 'hidden' });
  const items = useNotifications(store);
  // Built inside the composer's layer (a function of it), where Open can bring the bar or the icon back to the conversation.
  const activate = useCallback((layer: Omit<AgentLayerApi, 'agent'>, item: AgentNotification) => {
    if (item.conversationId !== undefined && item.conversationId !== conversationId) conversations?.onSelect(item.conversationId);
    if (layer.place === 'icon') layer.setPlace('float');
    layer.open('agent');
  }, [conversationId, conversations]);
  const enable = useEnableNotice(systemNotifications && notifications !== false, labels);
  const notices = useCallback((layer: Omit<AgentLayerApi, 'agent'>) => [...noticesOf(items, labels, item => activate(layer, item), store), ...enable], [items, labels, activate, store, enable]);
  const change = useCallback((next: AmbientState) => {
    levelRef.current = next;
    if (next === 'expanded') store.dismissConversation(conversationId);
    onStateChange?.(next);
  }, [onStateChange, store, conversationId]);
  const words = useMemo(() => {
    const picked: Record<string, string> = { emptyTitle: labels.title };
    for (const key of CHAT_WORDS) { const word = (labels as unknown as Record<string, unknown>)[key]; if (typeof word === 'string') picked[key] = word; }
    for (const [from, to] of Object.entries(SHELL_WORDS)) { const word = (givenLabels as Record<string, unknown> | undefined)?.[from]; if (typeof word === 'string') picked[to] = word; }
    return picked;
  }, [labels, givenLabels]);
  const agent: AgentSpec = ({ controller, label: labels.title, words,
    chatProps: { ...rest, labels, icons, ...(renderComposer !== undefined ? { renderComposer } : {}), ...(composerLayout !== undefined ? { composerLayout } : {}), ...(avatar !== undefined ? { avatar } : {}), ...(tools !== undefined ? { tools } : {}), ...(belowComposer !== undefined ? { belowComposer } : {}), ...(conversations ? { conversations } : {}) } as Omit<PiChatProps, 'controller'> });
  const starts = (state ?? defaultState) === 'minimized' ? 'icon' : 'float';
  const bridge: ReactNode = <><StateBridge state={state} initial={defaultState} onChange={change} layerRef={layerRef} />{systemNotifications && notifications !== false && <SystemNotifier items={items} labels={labels} activate={activate} />}</>;
  const actions = headerActionsOf(headerActions);
  const host = { ...(embedded ? { embedded } : {}), ...(headerTools !== undefined ? { headerTools } : {}), ...(actions ? { headerActions: actions } : {}),
    ...(onDock ? { onDock } : {}), ...(onOpenFull ? { onOpenFull } : {}), ...(onFeedback ? { onFeedback } : {}), ...(artifacts ? { artifacts } : {}),
    ...(artifactPanel ? { artifactPanel } : {}), ...(artifactTarget ? { artifactTarget } : {}) };
  const composer = <FloatingComposer agent={agent} appId={storageKey ?? 'ambient'} start={starts} storage={storage} legacyPositionKey={storageKey ?? LEGACY_POSITION_KEY} legacyPositionStorage={storage} {...host}
    {...(className !== undefined ? { className } : {})} {...(autoDismissMs !== undefined ? { autoDismissMs } : {})} {...(maxToasts !== undefined ? { maxToasts } : {})} {...(notifications === false || embedded ? {} : { notices })}>{embedded ? null : bridge}</FloatingComposer>;
  return <div data-boring="ambient-chat" data-variant={variant} className={variant === 'contrast' ? 'dark scheme-dark contents' : 'contents'}>{composer}</div>;
}

/**
 * A compact floating agent bar over an existing page; it grows into a chat window in place. Borrows a concrete native controller like `PiChat`.
 * @deprecated The floating bar is the one composer now: mount `FloatingComposer` (`app-shell`, `<FloatingComposer agent={{ controller, chatProps }} appId="site" />`). This component keeps its props
 * and delegates to it; see MIGRATING.md. It will be removed once no app uses it.
 */
export function AmbientChat(props: AmbientChatProps) {
  return ambientGap(props) === undefined ? <AmbientOnComposer {...props} /> : <AmbientWindow {...props} />;
}

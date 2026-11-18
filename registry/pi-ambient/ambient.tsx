'use client';

// `AmbientChat` over the one composer. The floating bar is the shell's composer (`FloatingComposer` of `app-shell`): the same bar, strip, conversation window, icon, grip and remembered place.
// This file keeps the old public props. A prop the one composer takes is delegated to it; a prop it does not take yet (`ambientGap`) keeps the whole bar on the old window (`ambient-window.tsx`)
// so no existing app changes. Background-conversation toasts become the composer's notices; `createNotificationStore` and `watchConversation` keep feeding them.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createNotificationStore, useRunNotifications } from '@hachej/boring-ui-kit/chat-react';
import { FloatingComposer } from '../app-shell/floating-composer';
import { useAgentLayer } from '../app-shell/agent-layer';
import type { AgentLayerApi, AgentSpec } from '../app-shell/layer-context';
import type { AppShellNotice } from '../app-shell/shell-notice';
import { useMergedText } from '../pi-chat/labels';
import type { PiChatProps } from '../pi-chat/pi-chat';
import { useNotifications, noticeTextOf } from './notifications';
import type { AgentNotification, NotificationStore } from './notifications';
import { AmbientWindow, AMBIENT_TEXT } from './ambient-window';
import type { AmbientChatProps, AmbientIcons, AmbientLabels, AmbientState } from './ambient-window';

export { usePhone, defaultAmbientLabels, defaultAmbientIcons } from './ambient-window';
export type { AmbientArtifactPanelApi, AmbientChatProps, AmbientIcons, AmbientLabels, AmbientState } from './ambient-window';
export { AgentNotifications, createNotificationStore, defaultNotificationLabels, frenchNotificationLabels, noticeTextOf, summaryOf, useNotifications, watchConversation } from './notifications';
export type { AgentNotification, AgentNotificationsProps, NewNotification, NotificationKind, NotificationLabels, NotificationStore } from './notifications';

/**
 * The props the one composer does not take yet: each keeps the bar on the old window. `undefined` means the composer takes every prop the app gave, so the bar is the one composer.
 * Listed in `features/ambient.md`: the in-window artifact panel and host artifact cards, embedding in a host page, the bar's own actions, thumbs and "open in full chat" on replies,
 * the dock button, the composer's layout and renderer, the toast timing, `className` (hosts position the old bar with it) and the system-notification bell.
 */
export function ambientGap(props: AmbientChatProps): string | undefined {
  const keys = ['embedded', 'artifactPanel', 'artifacts', 'headerTools', 'renderComposer', 'composerLayout', 'onDock', 'onOpenFull', 'onFeedback', 'autoDismissMs', 'maxToasts', 'className'] as const;
  const key = keys.find(name => props[name] !== undefined && props[name] !== false);
  if (key) return key;
  if (props.systemNotifications) return 'systemNotifications';
  if (props.headerActions?.length) return 'headerActions';
  return undefined;
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
    if (reported.current !== level) { reported.current = level; onChange(level); }
  }, [level, onChange]);
  useEffect(() => () => clearTimeout(settle.current), []);
  return null;
}

const TONE = { done: 'success', input: 'warning', error: 'error' } as const;

/** The toasts of a store as the composer's notices, newest first. */
function noticesOf(items: readonly AgentNotification[], labels: AmbientLabels, open: (item: AgentNotification) => void, store: NotificationStore): readonly AppShellNotice[] {
  const word = { done: labels.finished, input: labels.needsInput, error: labels.failedRun } as const;
  return [...items].reverse().map(item => ({ id: `${item.id}:${item.createdAt}`, kind: TONE[item.kind], text: `${item.title}: ${item.summary ?? word[item.kind]}`,
    action: { label: labels.openShort, onSelect: () => { open(item); store.dismiss(item.id); } }, onDismiss: () => store.dismiss(item.id) }));
}

const CHAT_WORDS = ['placeholder', 'placeholderWorking', 'messageInput', 'send', 'sendHint', 'stop', 'queue', 'add', 'attachFiles', 'takePhoto', 'commands', 'retry', 'voiceStop', 'voiceCancel', 'emptyDescription'] as const;

function AmbientOnComposer(props: AmbientChatProps) {
  const { controller, labels: givenLabels, icons: givenIcons, variant = 'contrast', state, defaultState, onStateChange, storageKey, notifications, conversations, avatar, tools, belowComposer,
    // Props the composer has no use for (`ambientGap` keeps the ones that matter on the old window): the old window's own position, size and placement.
    embedded: _embedded, headerActions: _headerActions, headerTools: _headerTools, storage: _storage, systemNotifications: _system, autoDismissMs: _dismiss, maxToasts: _max, composerLayout: _layout, renderComposer: _render,
    artifacts: _artifacts, artifactPanel: _panel, artifactTarget: _target, onDock: _dock, onOpenFull: _full, onFeedback: _feedback, className: _class, ...rest } = props;
  const { labels, icons } = useMergedText<AmbientLabels, AmbientIcons>(givenLabels, givenIcons, AMBIENT_TEXT);
  const internal = useMemo(() => createNotificationStore(), []);
  const store = notifications || internal;
  const layerRef = useRef<AgentLayerApi | undefined>(undefined);
  const levelRef = useRef<AmbientState>(state ?? defaultState ?? 'bar');
  const snapshotId = useSyncExternalStore(controller.subscribe, () => controller.getSnapshot().conversationId, () => controller.getSnapshot().conversationId);
  const conversationId = String(conversations?.activeId ?? snapshotId);
  const activeItem = conversations?.items.find(item => item.id === conversations.activeId);
  const title = activeItem?.title?.trim() || labels.title;
  useRunNotifications(controller, store, { enabled: notifications !== false, conversationId, title, text: noticeTextOf(labels),
    suppress: () => levelRef.current === 'expanded' && globalThis.document?.visibilityState !== 'hidden' });
  const items = useNotifications(store);
  // Built inside the composer's layer (a function of it), where Open can bring the bar or the icon back to the conversation.
  const notices = useCallback((layer: Omit<AgentLayerApi, 'agent'>) => noticesOf(items, labels, item => {
    if (item.conversationId !== undefined && item.conversationId !== conversationId) conversations?.onSelect(item.conversationId);
    if (layer.place === 'icon') layer.setPlace('float');
    layer.open('agent');
  }, store), [items, labels, conversationId, conversations, store]);
  const change = useCallback((next: AmbientState) => {
    levelRef.current = next;
    if (next === 'expanded') store.dismissConversation(conversationId);
    onStateChange?.(next);
  }, [onStateChange, store, conversationId]);
  const words = useMemo(() => {
    const picked: Record<string, string> = { emptyTitle: labels.title };
    for (const key of CHAT_WORDS) { const word = (labels as unknown as Record<string, unknown>)[key]; if (typeof word === 'string') picked[key] = word; }
    return picked;
  }, [labels]);
  const agent: AgentSpec = ({ controller, label: labels.title, words,
    chatProps: { ...rest, labels, icons, ...(avatar !== undefined ? { avatar } : {}), ...(tools !== undefined ? { tools } : {}), ...(belowComposer !== undefined ? { belowComposer } : {}), ...(conversations ? { conversations } : {}) } as Omit<PiChatProps, 'controller'> });
  const starts = (state ?? defaultState) === 'minimized' ? 'icon' : 'float';
  const bridge: ReactNode = <StateBridge state={state} initial={defaultState} onChange={change} layerRef={layerRef} />;
  const composer = <FloatingComposer agent={agent} appId={storageKey ?? 'ambient'} start={starts} {...(notifications === false ? {} : { notices })}>{bridge}</FloatingComposer>;
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

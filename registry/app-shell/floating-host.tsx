'use client';

// What a host page adds to the standalone composer (`FloatingComposer`), the window-content props `AmbientChat` has: header tools and actions, Dock and Open in full chat as header actions, thumbs on replies,
// the artifact panel and the host's artifact routing, and embedding the conversation in a container. Each is opt-in: with none of them the composer is what it was. They are merged into the one `AgentSpec`
// the layer already reads, so the shell's own surfaces (`AppShell`'s `agent`) get no second path.
import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useArtifactFollow } from '@hachej/boring-ui-kit/chat-react';
import { ExternalLinkIcon, PanelLeftIcon } from '../_shared/icons';
import { PiChat } from '../pi-chat/pi-chat';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';
import type { ReplyRef } from '../pi-chat/config';
import type { ArtifactsConfig } from '../pi-artifacts/artifact';
import { withReplyFeedback } from './reply-feedback';
import type { ReplyFeedbackHandler } from './reply-feedback';
import { useAutoOpenTasks } from './task-present';
import { chatWordLabels, shellWords } from './layer-context';
import type { AgentArtifactPanelApi, AgentSpec } from './layer-context';
import type { ScreenHeaderAction } from './header-actions';
import type { AppShellLocale } from './text';
import type { ArtifactDescriptor } from '../pi-artifacts/artifact';

/** The props `AmbientChat` has for what the window shows, with the same names and meaning. */
export interface FloatingHostProps {
  /** Draw the conversation in the container the host gives it (a workspace pane) instead of floating over the page: the thread and its field fill the container, no bar, no icon, no remembered place. The host supplies any header; the header props below are not shown. */
  readonly embedded?: boolean | undefined;
  /** Host-owned controls in the window's title row (for example an icon-anchored popover), before the actions. */
  readonly headerTools?: ReactNode;
  /** Host actions in the window's title row: two shown, the rest in « … ». */
  readonly headerActions?: readonly ScreenHeaderAction[] | undefined;
  /** Adds « Dock chat » to the window's title row, for a host that floats this conversation out of a docked chat (the controller is shared, nothing is lost). */
  readonly onDock?: (() => void) | undefined;
  /** Adds « Open in full chat » to the window's title row: hand the conversation to the host's full chat. */
  readonly onOpenFull?: ((conversationId: string) => void) | undefined;
  /** Adds thumbs up and down under each finished reply. `value` is `null` when the person takes the rating back. */
  readonly onFeedback?: ReplyFeedbackHandler | undefined;
  /** The viewer an artifact card opens in, inside the window's side pane (beside the bar, full screen on a phone). Build it from the viewer registry; it draws its own bar and calls `api.close`. */
  readonly artifactPanel?: ((artifact: ArtifactDescriptor, api: AgentArtifactPanelApi) => ReactNode) | undefined;
  /** The host's artifact routing (`ArtifactsConfig`): its cards' `open`, kinds and detection. With `artifactPanel` it still opens tasks; without, every artifact opens in the host. */
  readonly artifacts?: ArtifactsConfig | undefined;
  /** `window` (default when `artifactPanel` is given) opens artifacts in the window's pane; `host` calls `artifacts.open` instead, for a host that shows them in its own viewer. */
  readonly artifactTarget?: 'window' | 'host' | undefined;
}

type Host = FloatingHostProps & { readonly locale?: AppShellLocale | undefined };

/** The spec the layer reads: the agent, with the host's window props merged in. The same object while nothing changes, and the agent itself when the host gave none. */
export function useHostedSpec(agent: AgentSpec, host: Host): AgentSpec {
  const { headerTools, headerActions, onDock, onOpenFull, onFeedback, artifactPanel, artifacts, artifactTarget, locale } = host;
  const given = headerTools !== undefined || headerActions !== undefined || onDock !== undefined || onOpenFull !== undefined || onFeedback !== undefined || artifactPanel !== undefined || artifacts !== undefined;
  return useMemo(() => {
    if (!given) return agent;
    const text = shellWords(locale ?? agent.chatProps?.locale, agent);
    const conversationId = () => String(agent.chatProps?.conversations?.activeId ?? agent.controller.getSnapshot().conversationId);
    const actions: ScreenHeaderAction[] = [...(agent.headerActions ?? []), ...(headerActions ?? []),
      ...(onOpenFull ? [{ id: 'open-full', label: text.openFull, icon: ExternalLinkIcon, onSelect: () => onOpenFull(conversationId()) }] : []),
      ...(onDock ? [{ id: 'dock', label: text.dockChat, icon: PanelLeftIcon, onSelect: onDock }] : [])];
    const replyFooter = withReplyFeedback(onFeedback, text, agent.chatProps?.replyFooter as ((reply: ReplyRef) => ReactNode) | undefined);
    const routed = artifacts ?? agent.chatProps?.artifacts;
    const inWindow = artifactPanel !== undefined && artifactTarget !== 'host';
    return { ...agent,
      ...(actions.length ? { headerActions: actions } : {}),
      ...(headerTools !== undefined ? { headerTools } : {}),
      ...(inWindow ? { artifactPanel } : {}),
      chatProps: { ...agent.chatProps, ...(routed ? { artifacts: routed } : {}), ...(replyFooter ? { replyFooter } : {}) } };
  }, [agent, given, locale, headerTools, headerActions, onDock, onOpenFull, onFeedback, artifactPanel, artifacts, artifactTarget]);
}

/** `embedded`: the conversation in its container, the way the old window embedded it: the chat's own thread and field, the same words, the host's artifact routing and its acknowledgements. */
export function EmbeddedConversation({ agent, locale }: { readonly agent: AgentSpec; readonly locale?: AppShellLocale | undefined }): ReactElement {
  const { controller, chatProps } = agent;
  const lang = locale ?? chatProps?.locale;
  const host = chatProps?.artifacts as ArtifactsConfig | undefined;
  const conversationId = String(chatProps?.conversations?.activeId ?? controller.getSnapshot().conversationId);
  const follow = useArtifactFollow({ controller, conversationId, active: null, onOpen: () => {}, showing: () => true, showingTask: () => true, openPresent: () => false,
    answer: chatProps?.actions?.answer as Parameters<typeof useArtifactFollow>[0]['answer'] });
  const reports = useMemo(() => ({ onShown: follow.onShown, onFailed: follow.onFailed }), [follow.onShown, follow.onFailed]);
  useAutoOpenTasks(controller, host, reports);
  const artifacts = useMemo(() => host ? { ...host, open: (artifact: Parameters<ArtifactsConfig['open']>[0], given?: Parameters<ArtifactsConfig['open']>[1]) => host.open(artifact, given ?? reports) } : undefined, [host, reports]);
  const labels = { ...chatWordLabels(agent.words), ...chatProps?.labels };
  return <div data-testid="composer-embedded" className="flex min-h-0 min-w-0 flex-1 flex-col [&_[data-boring=pi-chat]>header]:hidden">
    <PiChat {...withChatPlugins({ ...chatProps, ...(artifacts ? { artifacts } : {}) })} {...(Object.keys(labels).length > 0 ? { labels } : {})} {...(lang ? { locale: lang } : {})} controller={controller} placement="docked" />
  </div>;
}

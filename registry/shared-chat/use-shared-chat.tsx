'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { UserIcon } from 'lucide-react';
import { createSharedChat } from '@hachej/boring-ui-kit/shared-chat';
import type { ChannelSource, Conversation, SharedChatController } from '@hachej/boring-ui-kit/shared-chat';
import type { PiChatProps } from '../pi-chat/pi-chat';
import type { ConversationsConfig, MentionsConfig } from '../pi-chat/config';
import { MentionPicker } from '../pi-chat-mentions/mention-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { agentTone, MemberAvatar, SharedMembers, ReplyQuote, sharedQuote } from './messages';
import { SharedTimeline } from './timeline';
import type { TimelineApi } from './timeline';
import { SharedTextProvider } from './text';
import type { SharedTextOptions } from './text';
import { defaultSharedLabels } from './shared-labels';
import { frenchSharedLabels } from './shared-labels-fr';

const subscribeNothing = () => () => {};
/** Explicit host composition through PiChat's generic transcript, composer and catalog seams. */
export function useSharedChatProps(controller: SharedChatController | undefined, options: SharedTextOptions = {}): Omit<PiChatProps, 'controller'> {
  const state = useSyncExternalStore(controller?.subscribe ?? subscribeNothing, () => controller?.getSnapshot(), () => controller?.getSnapshot());
  const api = useRef<TimelineApi | undefined>(undefined);
  const members = state?.shared.members ?? [];
  const labels = { ...(options.locale === 'fr' ? frenchSharedLabels : defaultSharedLabels), ...options.labels };
  const mentions = useMemo<MentionsConfig>(() => ({
    listLabel: labels.sharedMembers, icon: <UserIcon aria-hidden="true" />, Picker: MentionPicker,
    label: id => members.find(member => member.id === id)?.name ?? id,
    search: async query => members.filter(member => `${member.name} ${member.id}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => Number(b.kind === 'agent') - Number(a.kind === 'agent')).map(member => ({ path: member.id, label: member.name })),
    render: id => <Badge variant="secondary">@{members.find(member => member.id === id)?.name ?? id}</Badge>,
    renderSent: id => {
      const member = members.find(member => member.id === id) ?? { id, name: id, kind: 'person' };
      return <span data-testid="message-mention" data-path={id} data-agent-color={agentTone(member)?.token} className={`inline-flex items-baseline gap-1 align-baseline font-medium ${agentTone(member)?.text ?? ''}`}><span aria-hidden="true"><MemberAvatar member={member} compact interactive={false} /></span><span data-testid="mention-name">{member.name}</span></span>;
    },
    renderOption: item => <><ItemMedia variant="icon"><UserIcon aria-hidden="true" /></ItemMedia><ItemContent className="min-w-0"><ItemTitle>{item.label}</ItemTitle><ItemDescription className="m-0 truncate">{item.path}</ItemDescription></ItemContent></>,
  }), [members, labels.sharedMembers]);
  const wrap = (children: ReactNode) => <SharedTextProvider {...options}>{children}</SharedTextProvider>;
  return {
    locale: options.locale,
    timeline: { count: state?.shared.messages.length ?? 0,
      render: context => controller ? wrap(<SharedTimeline controller={controller} api={api} mentions={mentions} {...context} />) : null,
      afterSend: () => api.current?.reset() },
    controls: controller ? wrap(<SharedMembers controller={controller} />) : undefined,
    mentions,
    composerHeader: controller && state?.shared.replyTo ? wrap(<ReplyQuote targetId={state.shared.replyTo} quote={sharedQuote(state.shared, state.shared.replyTo)} onReveal={id => api.current?.reveal(id)} onRemove={() => controller.setReplyTo(undefined)} />) : undefined,
    composerHasContent: Boolean(state?.shared.files.length),
    onPickFiles: files => { if (controller) controller.setFiles([...controller.getSnapshot().shared.files, ...files]); },
    composerChips: controller && wrap(state?.shared.files.map((file, index) => <Badge key={index} variant="secondary">{file.name}<Button variant="ghost" size="icon" aria-label={`Remove ${file.name}`} onClick={() => controller.setFiles(controller.getSnapshot().shared.files.filter((_, at) => at !== index))}><span aria-hidden="true">×</span></Button></Badge>)),
    renderConnectionError: error => error instanceof Error ? error.message : String(error),
    // WhatsApp's composer; a host spreading these props can still override either.
    composerLayout: 'pill', voiceReplacesSend: true,
  };
}

/** Owns only the adapters it creates; each adapter borrows the host source. */
export function useSharedChat(source: ChannelSource, options: SharedTextOptions = {}) {
  const [list, setList] = useState<{ source: ChannelSource; items: Conversation[] }>();
  const [selection, setSelection] = useState<{ source: ChannelSource; id: string }>();
  const [error, setError] = useState<string>();
  const items = list?.source === source ? list.items : [];
  const conversationId = selection?.source === source ? selection.id : items[0]?.id;
  const [binding, setBinding] = useState<{ source: ChannelSource; id: string; controller: SharedChatController }>();
  useEffect(() => {
    let off = false; setError(undefined);
    void source.conversations().then(items => { if (!off) setList({ source, items }); }, cause => { if (!off) setError(String(cause)); });
    return () => { off = true; };
  }, [source]);
  useEffect(() => {
    if (conversationId === undefined) return;
    const controller = createSharedChat(source, { conversationId });
    setBinding({ source, id: conversationId, controller });
    return () => { void controller.dispose(); };
  }, [source, conversationId]);
  const controller = binding?.source === source && binding.id === conversationId ? binding.controller : undefined;
  const conversations: ConversationsConfig = { items, activeId: conversationId, loading: list?.source !== source, onSelect: id => setSelection({ source, id }) };
  const chat = useSharedChatProps(controller, options);
  return { controller, conversationId, conversations, error,
    chatProps: controller ? { ...chat, controller, conversations } : undefined,
    workspaceProps: { controller, conversationId, conversations, locale: options.locale, controls: chat.controls, chat },
  };
}

'use client';
import { PiChat } from '../pi-chat/pi-chat';
import type { PiChatProps } from '../pi-chat/pi-chat';
import type { SharedChatController } from '@hachej/boring-ui-kit/shared-chat';
import type { SharedLabels } from './shared-labels';
import { useSharedChatProps } from './use-shared-chat';
import { withChatPlugins } from '../pi-chat-plugins/chat-plugins';

export { useSharedChat, useSharedChatProps } from './use-shared-chat';
export { defaultSharedLabels } from './shared-labels';
export { frenchSharedLabels } from './shared-labels-fr';
export type { SharedLabels } from './shared-labels';
export { createSharedChat, createChannelSocket, createFakeChannelSource, channelAvatarStates, cardActions, ChannelRequestError } from '@hachej/boring-ui-kit/shared-chat';
export type { ChannelSource, ChannelEvent, ChannelMessage, Member, Conversation, Card, CardAction, Step, AvatarState, SharedChatController } from '@hachej/boring-ui-kit/shared-chat';

export interface SharedChatProps extends Omit<PiChatProps, 'controller'> {
  readonly controller: SharedChatController;
  readonly participantLabels?: Partial<SharedLabels>;
}
/** Optional composition. PiChat still owns the regular shell, draft, send and composer lifecycle. */
export function SharedChat({ participantLabels, ...props }: SharedChatProps) {
  const composition = useSharedChatProps(props.controller, { locale: props.locale, labels: participantLabels });
  return <PiChat {...withChatPlugins({ ...props, ...composition })} controls={<>{composition.controls}{props.controls}</>} composerChips={<>{props.composerChips}{composition.composerChips}</>} />;
}

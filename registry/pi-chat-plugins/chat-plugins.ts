import type { ReactNode } from 'react';
import type { AttachmentsConfig, EffortConfig, MentionsConfig, ModelConfig, PendingVoice, SlashConfig, VoiceMessageConfig } from '../pi-chat/config';
import type { ChatTextPart } from '../pi-chat/message';
import { markdownText } from '../pi-chat-markdown/markdown';
import { SlashPicker } from '../pi-chat-slash/slash-menu';
import { MentionPicker } from '../pi-chat-mentions/mention-menu';
import { ModelEffortPicker } from '../pi-chat-pickers/pickers';
import { voiceMessagePlugin } from '../pi-chat-voice/voice-message';
import { CameraSheet } from '../pi-chat-attachments/camera-sheet';

/** The chat props a composer feature item plugs into. */
export interface ChatPluginProps {
  readonly renderText?: ((part: ChatTextPart) => ReactNode) | undefined;
  readonly slash?: SlashConfig | undefined;
  readonly mentions?: MentionsConfig | undefined;
  readonly model?: ModelConfig | undefined;
  readonly effort?: EffortConfig | undefined;
  readonly voiceMessage?: VoiceMessageConfig | undefined;
  readonly attachments?: AttachmentsConfig | undefined;
  /** The camera of a chat that attaches through `onFiles` instead of `attachments`. */
  readonly camera?: AttachmentsConfig['Camera'];
  readonly onFiles?: unknown;
  /** Voice rows a host (the app shell, a shared chat) records itself: drawn by the voice item's bubble even without `voiceMessage`. */
  readonly pendingVoice?: readonly PendingVoice[] | undefined;
}

/** Fills a config once per config object, so the chat sees the same object on every render. */
function filler<T extends object>(fill: (config: T) => T): (config: T | undefined) => T | undefined {
  const cache = new WeakMap<T, T>();
  return config => {
    if (!config) return config;
    let filled = cache.get(config);
    if (!filled) { filled = fill(config); cache.set(config, filled); }
    return filled;
  };
}
const slashWith = filler<SlashConfig>(config => config.Picker ? config : { ...config, Picker: SlashPicker });
const mentionsWith = filler<MentionsConfig>(config => config.Picker ? config : { ...config, Picker: MentionPicker });
const modelWith = filler<ModelConfig>(config => config.Picker ? config : { ...config, Picker: ModelEffortPicker });
const effortWith = filler<EffortConfig>(config => config.Picker ? config : { ...config, Picker: ModelEffortPicker });
const voiceWith = filler<VoiceMessageConfig>(config => ({ ...config, useRecorder: config.useRecorder ?? voiceMessagePlugin.useRecorder, Button: config.Button ?? voiceMessagePlugin.Button, Bubble: config.Bubble ?? voiceMessagePlugin.Bubble }));
/** Draws host-recorded rows only: no recorder or button, so `transcribe` is never called. */
const bubbleOnly: VoiceMessageConfig = { transcribe: () => Promise.reject(new Error('This chat records no voice')), Bubble: voiceMessagePlugin.Bubble };
const attachmentsWith = filler<AttachmentsConfig>(config => config.Camera ? config : { ...config, Camera: CameraSheet });

/**
 * Every composer feature item at once: Markdown replies, the `/` menu, the `@` picker, the model and effort pill, voice messages and
 * the phone camera. A component the host already set is kept; a feature the host did not configure stays off.
 * `<PiChat {...withChatPlugins({ controller, slash, mentions, model, voiceMessage, attachments })} />`.
 */
export function withChatPlugins<T extends ChatPluginProps>(props: T): T {
  const { model, effort } = props;
  return {
    ...props,
    renderText: props.renderText ?? markdownText,
    slash: slashWith(props.slash),
    mentions: mentionsWith(props.mentions),
    // One pill draws both: fill the model's unless the host gave the effort its own.
    model: effort?.Picker ? model : modelWith(model),
    effort: model ? effort : effortWith(effort),
    voiceMessage: props.voiceMessage || !props.pendingVoice ? voiceWith(props.voiceMessage) : bubbleOnly,
    attachments: attachmentsWith(props.attachments),
    // A chat that attaches through `onFiles` gets the camera too, as before the move.
    ...(props.onFiles && !props.attachments && !props.camera ? { camera: CameraSheet } : {}),
  };
}

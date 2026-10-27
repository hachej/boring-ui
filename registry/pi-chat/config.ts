import type { ComponentType, ReactNode } from 'react';
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ChatController } from '@hachej/boring-ui-kit/native-chat';
import type { SlashItem } from '@hachej/boring-ui-kit/chat-text';
import type { ApprovalDecision, ArtifactDetect, ArtifactRecognise, ChatArtifact, SubagentRenderer as ViewSubagentRenderer } from '@hachej/boring-ui-kit/chat-view';
import type { BlockAction } from '../button/actions';
import type { ChatLabels } from './labels';

/*
 * Composer features the host switches on by configuration. Each prop is optional: leave it out and the composer has
 * no menu, no button and no keyboard trigger for it. The current model and thinking level are read from the native
 * view's `pi.agent` document, so there is no extra state to keep in sync. The component that draws a feature comes from its own
 * registry item and rides on the config (`Picker`, `Camera`, `useRecorder` with `Button` and `Bubble`): without it the feature is
 * simply not offered (no menu, no pill, no camera entry, no record button). `withChatPlugins` of `pi-chat-plugins` fills them all in.
 */

/** Where a `/` menu entry comes from (the kit's `chat-text`). */
export type { SlashSource } from '@hachej/boring-ui-kit/chat-text';

export interface SlashApi {
  /** Replace the composer text. */
  readonly setText: (text: string) => void;
  /** The composer text with the typed `/query` already removed. */
  readonly text: string;
}
export interface SlashCommand {
  readonly name: string;
  readonly description?: string;
  /** Shown as a badge and as a filter chip; commands without one are grouped as `built-in`. */
  readonly sourcePlugin?: string;
  readonly run: (api: SlashApi) => void | Promise<void>;
}
export interface SlashSkill {
  readonly name: string;
  readonly description: string;
  readonly sourcePlugin?: string;
}
export interface SlashConfig {
  readonly commands?: readonly SlashCommand[];
  readonly skills?: readonly SlashSkill[];
  /** The `/` menu (`SlashPicker` of `pi-chat-slash`). Without it there is no `/` menu and no Commands entry. */
  readonly Picker?: ComponentType<SlashPickerProps> | undefined;
}

export interface MentionResult { readonly path: string; readonly kind?: 'file' | 'directory'; readonly label?: string }
export interface MentionKind {
  readonly label: (path: string) => string;
  readonly icon: ReactNode;
  readonly open?: ((path: string) => void) | undefined;
  readonly renderSent?: ((path: string) => ReactNode | undefined) | undefined;
}
export interface MentionsConfig {
  /** App mentions use `@prefix:path` (or the existing quoted token for spaces). Prefixes match [a-z][a-z0-9-]*. No picker is required. */
  readonly kinds?: Readonly<Record<string, MentionKind>> | undefined;
  /** Accessible name and optional option/media presentation for a host catalog. */
  readonly listLabel?: string;
  readonly icon?: ReactNode;
  readonly renderOption?: (item: MentionResult, query: string) => ReactNode;
  readonly label?: (id: string) => string;
  /** Workspace search for the `@` picker. Empty `query` asks for a default listing. Abort `signal` when the query changes. */
  readonly search: (query: string, signal: AbortSignal) => Promise<readonly MentionResult[]>;
  /** Open a mentioned workspace file (for example in the right panel). When given, a mention in a sent message is a button. */
  readonly open?: ((path: string) => void) | undefined;
  /** Changes whenever what `search` would return may have changed (a workspace change event, another workspace). An open picker searches again. */
  readonly generation?: string | number | undefined;
  /** Host-supplied look for a mention in a sent message (a plug-in such as feedback). Return undefined to keep the default mention. */
  readonly render?: ((path: string) => ReactNode | undefined) | undefined;
  /** Sent-message rendering, independent of the composer's token presentation. */
  readonly renderSent?: ((path: string) => ReactNode | undefined) | undefined;
  /**
   * Upload bytes through the host's provider. Image cards read thumbnails; voice bubbles read audio only on Play.
   * Thumbnails accept png, jpeg, gif and webp. Audio must retain its recorded audio MIME type.
   */
  readonly preview?: PreviewRead | undefined;
  /** Optional authorized playback URL, requested only on Play; otherwise voice audio uses `preview`. */
  readonly audioUrl?: AudioUrlRead | undefined;
  /** The `@` picker (`MentionPicker` of `pi-chat-mentions`). Without it typing `@` opens nothing. */
  readonly Picker?: ComponentType<MentionPickerProps> | undefined;
}
export type AudioUrlRead = (path: string, signal: AbortSignal) => Promise<string | undefined>;
/** Reads an upload for its thumbnail or lazy voice playback: its media type and base64 data, or undefined. */
export type PreviewRead = (path: string, signal: AbortSignal) => Promise<{ readonly mimeType: string; readonly data: string } | undefined>;

/** Paste-to-file thresholds (the kit's `chat-text`): a paste with more characters or more lines than these becomes a file. */
export type { PasteToFile } from '@hachej/boring-ui-kit/chat-text';
/** A paste the composer took, with the textarea range it replaces (restored if the upload is cancelled). */
export interface PastedText { readonly text: string; readonly start: number; readonly end: number }

export interface UploadResult {
  /** The host saved the file in the workspace: it becomes an `@path` mention. */
  readonly path?: string;
  /** Sent as a native image attachment instead of a path mention when both are supplied. */
  readonly image?: { readonly data: string; readonly mimeType: string };
  readonly name: string;
}
export interface VoiceMessageConfig {
  readonly transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>;
  /** Capture limit (default five minutes). Upload and send still wait for release. */
  readonly maxMs?: number;
  /** Same workspace upload contract as `attachments.upload`, used instead when supplied. Preserve the voice- filename prefix. */
  readonly upload?: AttachmentsConfig['upload'];
  /** The recorder (`useVoiceMessage` of `pi-chat-voice`). Without it there is no voice message: no button, no pending bubble. */
  readonly useRecorder?: VoiceRecorderHook | undefined;
  /** The hold-to-record button at the end of the composer bar (`VoiceMessageButton` of `pi-chat-voice`). */
  readonly Button?: ComponentType<VoiceMessageButtonProps> | undefined;
  /** A voice message on its way: recording, transcribing, uploading (`PendingVoiceBubble` of `pi-chat-voice`). */
  readonly Bubble?: ComponentType<PendingVoiceBubbleProps> | undefined;
}

export interface AttachmentsConfig {
  /** The file input's `accept`. Any file when omitted. */
  readonly accept?: string;
  readonly upload: (files: File[], signal: AbortSignal) => Promise<readonly UploadResult[]>;
  /** The full-screen camera the attach menu opens on a phone (`CameraSheet` of `pi-chat-attachments`). Without it there is no Take a photo entry. */
  readonly Camera?: ComponentType<CameraSheetProps> | undefined;
}

/** One past conversation in the history list. `title` is its name or first message; `updatedAt` is when it last had activity. */
export interface ConversationItem {
  readonly id: string;
  readonly title?: string | undefined;
  readonly updatedAt?: number | string | Date | undefined;
  /** A preview of the last message (the row's tooltip). */
  readonly lastMessage?: string | null | undefined;
  readonly archived?: boolean | undefined;
}
/** The host's conversations. Give it to `PiChat` and the header's History button opens a list of them instead of the earlier records of this one. */
export interface ConversationsConfig {
  readonly items: readonly ConversationItem[];
  /** The conversation that is open; it is marked in the list. */
  readonly activeId?: string | undefined;
  readonly onSelect: (id: string) => void;
  readonly onNew?: (() => void) | undefined;
  readonly loading?: boolean | undefined;
  /**
   * Server-side search: with it, a typed query (or the Archived filter) lists what this returns instead of filtering `items`
   * by title. Abort `signal` when the query changes.
   */
  readonly search?: ((query: string, options: { readonly archived: boolean }, signal: AbortSignal) => Promise<readonly ConversationItem[]>) | undefined;
  /** Each action below adds its button to the rows; the host refreshes `items` when it resolves. */
  readonly rename?: ((id: string, title: string) => Promise<void>) | undefined;
  /** Archive (`true`) or restore (`false`). With it, the list also offers an Archived filter (which needs `search`). */
  readonly archive?: ((id: string, archived: boolean) => Promise<void>) | undefined;
  readonly remove?: ((id: string) => Promise<void>) | undefined;
  /** Fork the open conversation after the entry of a settled reply: the reply's Fork button. */
  readonly fork?: ((atEntryId: string) => Promise<void>) | undefined;
  /**
   * Host actions on each row, after rename, archive and delete: `header` ones as buttons, `menu` ones in a "…" menu. Test ids
   * `conversation-action-<id>`, the menu `conversation-action-more`.
   */
  readonly rowActions?: ((item: ConversationItem) => readonly BlockAction[]) | undefined;
}

/** A settled reply, as host message actions receive it: its row key, its text and the native entry it ends with. */
export interface ReplyRef {
  readonly key: string; readonly text: string; readonly entryId?: string | undefined;
  /** When the last model round of the reply was written (ms), the same value as its message's `timestamp`: a host keys its own per-reply data on it. */
  readonly timestamp?: number | undefined;
  /** The model that wrote the last round of the reply, as its message names it (`provider` and `model` ids). */
  readonly model?: { readonly provider: string; readonly modelId: string } | undefined;
  /**
   * Sum of the model rounds that form the reply (ms): Pi's own `AssistantMessage.durationMs`, measured monotonically
   * and kept in the transcript. It excludes queue time, tool runs and retry delays, and is absent for a message written
   * before Pi recorded it. It is never computed from the clock at render time.
   */
  readonly durationMs?: number | undefined;
}

export interface ModelRef { readonly provider: string; readonly modelId: string }
export interface ModelConfig {
  readonly options: readonly (ModelRef & { readonly label?: string })[];
  /** Reject to refuse: the message is shown inline. */
  readonly change: (model: ModelRef) => Promise<void>;
  /** The one model-and-effort pill (`ModelEffortPicker` of `pi-chat-pickers`; `effort.Picker` is used when only it is set). Without one there is no pill. */
  readonly Picker?: ComponentType<ModelEffortPickerProps> | undefined;
}
export interface EffortConfig {
  readonly options: readonly string[];
  readonly change: (level: string) => Promise<void>;
  /** The one model-and-effort pill, when `model` does not carry one (`ModelEffortPicker` of `pi-chat-pickers`). */
  readonly Picker?: ComponentType<ModelEffortPickerProps> | undefined;
}

/*
 * The text grammar (slash menu, `@mention` tokens, message pieces, file kinds, paste and draft rules) is the kit's `chat-text`; it is
 * re-exported here so the items that import it from `pi-chat/config` keep compiling.
 */
export { appendToDraft, displayName, fileKind, hasMention, isLongPaste, isUploadPath, isVoicePath, looksLikeMarkdown, MENTION_TOKEN, mentionedPaths, mentionKind, mentionToken, mentionTrigger, pieces, prependToDraft, removeMention, slashGroup, slashItems, slashQuery, visibleParts, withoutKindMentions, withoutMentions } from '@hachej/boring-ui-kit/chat-text';
export type { FileKind, MentionTrigger, Piece, SlashItem } from '@hachej/boring-ui-kit/chat-text';

/** Props of the slash picker that `SlashConfig.Picker` carries. */
export interface SlashPickerProps {
  readonly query: string;
  readonly items: readonly SlashItem[];
  readonly onSelect: (item: SlashItem) => void;
  readonly onDismiss: () => void;
}

/** Props of the mention picker that `MentionsConfig.Picker` carries. */
export interface MentionPickerProps {
  readonly query: string;
  readonly listLabel?: MentionsConfig['listLabel'];
  readonly renderOption?: MentionsConfig['renderOption'];
  readonly generation?: MentionsConfig['generation'];
  readonly search: MentionsConfig['search'];
  readonly onSelect: (path: string) => void;
  readonly onDismiss: () => void;
}

/** Props of the model and effort picker that `ModelConfig.Picker` or `EffortConfig.Picker` carries. */
export interface ModelEffortPickerProps {
  readonly model: ModelConfig | undefined; readonly effort: EffortConfig | undefined;
  readonly currentModel: ModelRef | undefined; readonly currentEffort: string | undefined;
  readonly disabled: boolean; readonly busy: 'model' | 'effort' | null;
  readonly onModel: (model: ModelRef) => void; readonly onEffort: (level: string) => void;
}

export type VoicePhase = 'starting' | 'recording' | 'processing' | 'transcribe-failed' | 'upload-failed' | 'sending' | 'unconfirmed' | 'blocked';
/** A voice message on its way: recorded, then transcribed, uploaded and sent. */
export interface PendingVoice {
  readonly id: number;
  readonly path: string | undefined;
  readonly phase: VoicePhase;
  readonly seconds: number;
  readonly retry: () => void;
  readonly audioOnly: (() => void) | undefined;
  readonly discard: () => void;
}
/** The recorder the chat hands to the voice button. */
export interface VoiceMessageHandle {
  readonly canStart: boolean;
  readonly phase: VoicePhase | 'idle';
  readonly seconds: number;
  readonly captureSequence: number;
  readonly problem: string | undefined;
  readonly pending: readonly PendingVoice[];
  readonly start: () => void;
  readonly finish: () => void;
  readonly cancel: () => void;
}
/** Props of the hold-to-record button that `VoiceMessageConfig.Button` carries. */
/** `primary`: the button stands in for Send (`voiceReplacesSend`), so it takes Send's primary look. */
export interface VoiceMessageButtonProps {
  readonly voice: VoiceMessageHandle;
  readonly disabled?: boolean;
  readonly primary?: boolean;
  /** A gesture elsewhere already started capture: tap the mic to finish, with inline cancel while it records. */
  readonly tapToFinish?: boolean;
  /** A shell with its own hold feedback can keep the held microphone's geometry fixed. Default true. */
  readonly showStatus?: boolean;
  readonly testId?: string;
}
/** Props of a pending voice message bubble that `VoiceMessageConfig.Bubble` carries. */
export interface PendingVoiceBubbleProps { readonly pending: PendingVoice | undefined }
/** What the chat hands its recorder (`VoiceMessageConfig.useRecorder`). `config` is undefined when voice is off. */
export interface VoiceRecorderOptions {
  readonly controller: ChatController | undefined;
  readonly config: VoiceMessageConfig | undefined;
  readonly attachments?: AttachmentsConfig | undefined;
  readonly labels: ChatLabels;
  readonly admitted?: (() => void) | undefined;
  readonly activeController?: { readonly current: ChatController } | undefined;
}
/** A React hook: the chat calls it on every render of a mounted chat (a new hook remounts the chat). */
export type VoiceRecorderHook = (options: VoiceRecorderOptions) => VoiceMessageHandle;

/** Props of the phone camera sheet that `AttachmentsConfig.Camera` carries. */
export interface CameraSheetProps {
  /** The photo, as a JPEG File scaled to at most `CAMERA_MAX_SIDE` on its longest side (or the phone camera's own file, from the fallback). */
  readonly onCapture: (file: File) => void;
  readonly onClose: () => void;
  /** Opens the camera; defaults to the browser's, when it has one. */
  readonly getUserMedia?: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined;
}

/** A `/command` a settled reply may turn into a button (`commandMentions`; drawn by a text renderer such as `pi-chat-markdown`). */
export interface CommandMention { readonly name: string; readonly behavior: 'execute' | 'insert' }
export interface CommandMentions {
  readonly commands: readonly CommandMention[];
  readonly onActivate: (command: CommandMention) => void;
}

/** A recording's length as m:ss. */
export const voiceClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/*
 * The cards of a reply are items too (`pi-chat-question`, `pi-chat-approval`, `pi-chat-subagent`, `pi-artifacts`). The core keeps only what
 * it needs to place them: the props each card receives, and a visible "waiting for your answer" notice when a question or an approval has
 * no card, so a run never waits silently. `withChatPlugins` of `pi-chat-plugins` plugs every card in.
 */

/** What the host answers when asked to resolve a pending question. */
export type AnswerOutcome = { readonly kind: 'answered' } | { readonly kind: 'denied' | 'conflict' | 'unknown-question'; readonly reason?: string };
/** `ask_user` calls are question rows; `ApprovalDecision` is what `requireApproval` records (both owned by the kit's chat view). */
export { ASK_USER_TOOL } from '@hachej/boring-ui-kit/chat-view';
export type { ApprovalDecision } from '@hachej/boring-ui-kit/chat-view';

/** Props of the question card that `ChatCards.question` carries (`QuestionCard` of `pi-chat-question`). */
export interface QuestionCardProps {
  readonly call: ToolCall;
  readonly result: ToolResultMessage | undefined;
  readonly questionId: string | undefined;
  readonly answer?: ((questionId: string, answer: string) => Promise<AnswerOutcome>) | undefined;
  /** The call is still being generated by the model: it cannot be answered yet. */
  readonly live?: boolean;
}
/** Props of the approval card that `ChatCards.approval` carries (`ApprovalCard` of `pi-chat-approval`). Answering uses the host's `answer`. */
export interface ApprovalCardProps {
  readonly call: ToolCall;
  /** The question ID bound to this call's assistant entry (`derive` provides it); answers use it, never the bare call ID. */
  readonly questionId?: string | undefined;
  /** The decision `requireApproval` recorded in the call's details (`derive` finds it). Without one, a settled call shows as not decided. */
  readonly decision?: ApprovalDecision | undefined;
  /** The one-line summary `requireApproval` published for this call (`derive` finds it). Shown first; the raw arguments are then collapsed under it. */
  readonly summary?: string | undefined;
  readonly result: ToolResultMessage | undefined;
  readonly answer?: ((callId: string, answer: string) => Promise<AnswerOutcome>) | undefined;
  /** The call is still being generated by the model: it cannot be decided yet. */
  readonly live?: boolean;
}
/**
 * Draws a tool call that ran a sub-agent (`subagentCard` of `pi-chat-subagent`), from the details its running slot published (`details`)
 * or that it finished with. Undefined: the call is not a sub-agent call and stays an ordinary tool step.
 */
export type SubagentRenderer = ViewSubagentRenderer<ReactNode>;

/** The cards the chat draws for a human decision or a sub-agent. Each one left out has no card (see `PiChat`'s `cards`). */
export interface ChatCards {
  /** An `ask_user` question (`QuestionCard` of `pi-chat-question`). Without it the chat says it waits for an answer, with no answer UI. */
  readonly question?: ComponentType<QuestionCardProps> | undefined;
  /** A call gated by `requireApproval` (`ApprovalCard` of `pi-chat-approval`). Without it the chat says it waits for an answer, with no answer UI. */
  readonly approval?: ComponentType<ApprovalCardProps> | undefined;
  /** A sub-agent call (`subagentCard` of `pi-chat-subagent`). Without it the call is an ordinary tool step. */
  readonly subagent?: SubagentRenderer | undefined;
}

/** An artifact a tool call made, as the chat places it (owned by the kit's chat view). */
export type { ChatArtifact };
/** Props of the artifact card that `ArtifactsConfig.Card` carries (`PluggedArtifactCard` of `pi-artifacts`). */
export interface ChatArtifactCardProps {
  readonly artifact: ChatArtifact;
  readonly open: boolean;
  readonly onOpen: (() => void) | undefined;
  readonly kinds: readonly unknown[] | undefined;
}
/**
 * Artifact cards, as the core sees `ArtifactsConfig` of `pi-artifacts`: the host's opener and the item's `recognise` and `Card`. Without
 * `recognise` and `Card` no artifact is offered: the calls stay ordinary tool steps.
 */
export interface ChatArtifactsConfig {
  readonly kinds?: readonly unknown[] | undefined;
  readonly open: (artifact: never) => void;
  readonly isOpen?: ((artifact: never) => boolean) | undefined;
  readonly detect?: ArtifactDetect | undefined;
  /** The artifact a call made, or that a running call (`running`) is making; undefined for any other call. */
  readonly recognise?: ArtifactRecognise | undefined;
  readonly Card?: ComponentType<ChatArtifactCardProps> | undefined;
}

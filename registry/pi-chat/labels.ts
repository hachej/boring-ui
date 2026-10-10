/*
 * Every word the chat shows, and the icons it draws, as plain data. A host passes a partial `labels` (and `icons`) object to `PiChat`
 * (or `AmbientChat`, `AgentWorkspace`): what it leaves out keeps the default below. Strings that need a value are functions. No i18n
 * framework: an app that translates passes its own object per language.
 */
import { createContext, createElement, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ArrowDownIcon, ArrowUpIcon, GitForkIcon, HistoryIcon, ListEndIcon, MessagesSquareIcon, PaperclipIcon, PlusIcon, RefreshCwIcon, SquareIcon } from 'lucide-react';
import type { BlockIcon } from '../button/actions';
import { withDefaults } from '../utils/utils';

const TOOL_VERBS: Readonly<Record<string, string>> = { read: 'Reading', write: 'Writing', edit: 'Editing', ls: 'Listing', list_files: 'Listing', find: 'Searching', grep: 'Searching', load_skill: 'Loading skill', bash: 'Running bash' };
const TOOL_NOUNS: Readonly<Record<string, string>> = { bash: 'command', read: 'read', write: 'write', edit: 'edit', find: 'find', grep: 'search', ls: 'list' };

const EFFORT_NAMES: Readonly<Record<string, string>> = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const EFFORT_DETAILS: Readonly<Record<string, string>> = { off: 'No extra reasoning', minimal: 'Barely any reasoning', low: 'Light reasoning', medium: 'Balanced reasoning', high: 'Deep reasoning', xhigh: 'Deeper reasoning', max: 'Maximum reasoning' };

export const defaultChatLabels = {
  // Header and transcript
  /** The chat's name: the header title, the region's name and the empty state's title. */
  title: 'Conversation',
  history: 'History',
  live: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  loadFailed: 'Conversation could not be loaded.',
  disconnected: 'Disconnected. Last observed messages remain visible.',
  reconnect: 'Reconnect',
  requiredActions: 'Required conversation actions',
  messages: 'Messages',
  showEarlier: 'Show earlier messages',
  loading: 'Loading conversation…',
  emptyDescription: 'Start a conversation.',
  jumpToLatest: 'Jump to latest',
  agentWorking: 'Agent is working',
  waitingForAnswer: 'Waiting for your answer',
  retryPending: 'Native retry pending',
  compacting: 'Native context compaction in progress',
  /** The "…" menu of host actions (header, replies). */
  moreActions: 'More actions',
  // Notices
  sendUnknown: 'Submission acknowledgement is unknown. The message is kept until you check or retry it.',
  checkSubmission: 'Check original submission',
  retrySame: 'Retry same request',
  stopRequested: 'Stop requested. Waiting for native confirmation.',
  stopUnconfirmed: 'Stop is unconfirmed. Work may still be running.',
  steerRefused: 'The message could not be steered; it is back in the message box.',
  tooLate: 'Too late: that message has already started.',
  tooLateToRemove: 'Too late to remove: that message has already started.',
  queueFailed: 'The message could not be changed.',
  queueLocked: 'Queued messages cannot be changed here.',
  waitToSteer: 'Wait for the current send to finish, then steer.',
  steerFailed: 'The message could not be steered.',
  connectionFailed: 'Connection failed',
  actionFailedShort: 'Action failed',
  uploadFailedShort: 'Upload failed',
  changeRefused: 'The change was refused',
  dismissHint: 'click to dismiss',
  // Composer
  placeholder: 'Message the agent…',
  placeholderWorking: 'Queue a message…',
  messageInput: 'Message',
  send: 'Send',
  sendHint: 'Send (Enter)',
  stop: 'Stop',
  queue: 'Queue',
  add: 'Add',
  attachFiles: 'Attach files',
  commands: 'Commands',
  feedback: 'Feedback',
  feedbackHint: 'Feedback: point at the page and say what is wrong',
  remove: (name: string) => `Remove ${name}`,
  dismiss: (name: string) => `Dismiss ${name}`,
  uploading: (name: string) => `Uploading ${name}…`,
  uploadFailed: (name: string, error: string | undefined) => `${name}: ${error ?? 'upload failed'}`,
  preparingAttachments: 'Preparing attachments…',
  preparingAttachmentsShort: 'Preparing attachments',
  mentionedFiles: 'Mentioned files',
  uploads: 'Uploads',
  attachments: 'Attachments',
  searchCommands: 'Search commands',
  filterBySource: 'Filter by source',
  allSources: 'All',
  noCommands: 'No matching commands.',
  /** A `/` menu filter chip: `skills`, `built-in` or a plugin's name. */
  slashGroup: (group: string) => group,
  skillBadge: 'skill',
  workspaceFiles: 'Workspace files',
  searchFailed: 'Search failed',
  model: 'Model',
  effort: 'Effort',
  effortDefault: 'Default',
  modelAndEffort: 'Model and effort',
  modelSummary: (model: string | undefined, effort: string | undefined) => [model && `Model: ${model}`, effort && `Effort: ${effort}`].filter(Boolean).join(', '),
  /** A thinking level's name and short description in the picker. */
  effortName: (level: string) => EFFORT_NAMES[level] ?? level,
  effortDetail: (level: string): string | undefined => EFFORT_DETAILS[level],
  // Voice input (the microphone button beside the composer)
  voiceRecord: 'Record a message',
  voiceStop: 'Stop recording',
  voiceCancel: 'Cancel recording',
  voiceTranscribing: 'Transcribing…',
  voiceNothingHeard: 'Nothing was heard. Try again.',
  voiceTranscribeFailed: 'The recording could not be transcribed. Try again.',
  voiceDenied: 'Microphone blocked. Allow it for this site in the browser, then press record again.',
  voiceNoMicrophone: 'No microphone found. Connect one, then press record again.',
  voiceBusy: 'The microphone is busy or could not be opened. Close other apps using it and try again.',
  voiceInsecure: 'Recording needs a secure page (https or localhost).',
  voiceUnsupported: 'This browser cannot record audio here.',
  voiceStartFailed: 'The microphone could not be started.',
  // Queue
  queuedMessages: 'Queued messages',
  steer: 'Steer',
  steerHint: 'Send this into the running turn now',
  steering: 'Steering',
  queued: 'Queued',
  removeQueued: 'Remove queued message',
  removeHint: 'Remove',
  more: 'More',
  edit: 'Edit',
  sending: 'Sending',
  images: (count: number) => `[${count} image${count === 1 ? '' : 's'}]`,
  // Conversation list and history
  historyDialog: 'Conversation history',
  newConversation: 'New',
  untitled: 'New conversation',
  closeHistory: 'Close history',
  close: 'Close',
  earlierInConversation: 'Earlier messages in this conversation',
  searchConversations: 'Search conversations',
  archived: 'Archived',
  current: 'Current',
  noMatch: (query: string) => `No conversation matches “${query}”.`,
  noArchived: 'No archived conversations.',
  noConversations: 'No conversations yet.',
  loadingConversations: 'Loading conversations…',
  actionFailed: 'That did not work. Try again.',
  rename: 'Rename',
  renameItem: (title: string) => `Rename ${title}`,
  conversationName: 'Conversation name',
  save: 'Save',
  archive: 'Archive',
  restore: 'Restore',
  archiveItem: (title: string, archived: boolean) => `${archived ? 'Restore' : 'Archive'} ${title}`,
  delete: 'Delete',
  deleteItem: (title: string) => `Delete ${title}`,
  keep: 'Keep conversation',
  today: 'Today',
  yesterday: 'Yesterday',
  previousWeek: 'Previous 7 days',
  older: 'Older',
  conversations: 'Conversations',
  earlierMessages: 'Earlier messages',
  readOnly: '(read-only)',
  retry: 'Retry',
  loadingShort: 'Loading…',
  loadEarlier: 'Load earlier',
  returnToConversation: 'Return to active conversation',
  historyFailed: 'Conversation history could not be loaded. The previous page remains visible.',
  loadPage: 'Load a page to browse earlier messages.',
  noRecords: 'No records in this history page.',
  beginning: 'Beginning of conversation.',
  justNow: 'now',
  roleSystem: 'System',
  roleToolResult: (tool: string, failed: boolean) => `Tool result: ${tool}${failed ? ' (failed)' : ''}`,
  roleUser: 'You',
  roleAssistant: (outcome: 'ok' | 'interrupted' | 'failed'): string => outcome === 'interrupted' ? 'Assistant (interrupted)' : outcome === 'failed' ? 'Assistant (failed)' : 'Assistant',
  roleEvent: 'Event',
  contextBoundary: 'Context boundary',
  // Messages
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  failed: 'Failed',
  copyResponse: 'Copy response',
  copyCode: 'Copy code',
  fork: 'Fork from here',
  forkHint: 'Fork from here: a new conversation with the messages up to this reply',
  responseFailed: 'The response failed',
  interrupted: 'Response interrupted',
  thinking: 'Thinking…',
  openImage: 'Open image attachment',
  imageAttachment: 'Image attachment',
  systemContext: 'System context',
  toolFailed: (tool: string) => `${tool} failed`,
  event: (label: string) => `Event: ${label}`,
  // Activity and tools
  reasoning: 'Reasoning',
  thinkingStep: 'Thinking',
  steps: (count: number) => `${count} ${count === 1 ? 'step' : 'steps'}`,
  toolRunning: 'Running',
  toolCompleted: 'Completed',
  toolFailedStatus: 'Failed',
  toolUnfinished: 'No result',
  arguments: 'Arguments',
  result: 'Result',
  error: 'Error',
  openImageResult: 'Open image result',
  emptyResult: 'Empty result',
  /** The live line of a running tool call; `hint` is what it acts on (a path, a command), possibly empty. */
  toolActivity: (tool: string, hint: string) => {
    const verb = TOOL_VERBS[tool] ?? `Running ${tool}`;
    return hint ? `${verb}${tool === 'bash' ? ':' : ''} ${hint}` : verb;
  },
  /** How a tool is named in a finished activity summary ("Used read ×3 · command"). */
  toolNoun: (tool: string) => TOOL_NOUNS[tool] ?? tool,
  // Approval and question cards
  approvalNeeded: 'Approval needed',
  needsApproval: 'Needs your approval',
  approve: 'Approve',
  deny: 'Deny',
  approved: 'Approved',
  denied: 'Denied',
  notDecided: 'Not decided: the run was stopped',
  wantsToRun: 'The agent wants to run',
  decision: 'Decision',
  stillWritingCall: 'The agent is still writing this call…',
  decidingUnavailable: 'Deciding is not available in this view.',
  decisionSent: (approved: boolean) => `${approved ? 'Approved.' : 'Denied.'} Waiting for the agent…`,
  decisionRefused: (kind: 'denied' | 'conflict' | 'unknown-question'): string => kind === 'denied' ? 'The host did not accept this answer.' : kind === 'conflict' ? 'This call was already decided.' : 'This call is no longer waiting for a decision.',
  decisionNotSent: 'The decision could not be sent.',
  waitingForAgent: 'Waiting for the agent…',
  question: 'Question',
  questionForYou: 'Question for you',
  notAnswered: 'Not answered',
  answered: 'Answered',
  askedQuestion: 'The agent asked a question.',
  answerOptions: 'Answer options',
  ownAnswer: 'Or type your own answer',
  typeAnswer: 'Type your answer',
  yourAnswerInput: 'Your answer',
  answer: 'Answer',
  stillWritingQuestion: 'The agent is still writing this question…',
  answeringUnavailable: 'Answering is not available in this view.',
  answerRefused: (kind: 'denied' | 'conflict' | 'unknown-question'): string => kind === 'denied' ? 'The host did not accept this answer.' : kind === 'conflict' ? 'This question was already answered.' : 'This question is no longer waiting for an answer.',
  answerNotSent: 'The answer could not be sent.',
  yourAnswer: 'Your answer:',
  // Artifact cards
  artifact: 'Artifact',
  opening: 'Opening…',
  viewing: 'Viewing',
  version: (ordinal: number) => `Version ${ordinal}`,
  runCommand: (name: string, execute: boolean) => `${execute ? 'Run' : 'Insert'} /${name} command`,
  taskStatus: 'Task status',
  activityFailed: (count: number, tools: string) => `${count > 1 ? `${count} steps failed` : 'Step failed'}: ${tools}`,
  activityUsed: (summary: string, stopped: boolean) => `${stopped ? 'Stopped · ' : 'Used '}${summary}`,
  activityThought: 'Thought it through',
  activityMany: (steps: number) => `Worked through ${steps} steps`,
  open: 'Open',
  openArtifact: (title: string, version: number | undefined) => version === undefined ? `Open ${title}` : `Open ${title}, version ${version}`,
};

export type ChatLabels = typeof defaultChatLabels;

/** The chat's icons. Any component that takes `className` (every lucide icon does). */
export const defaultChatIcons = {
  /** The agent's glyph in the empty state (the header shows the host's `avatar`, if any). */
  agent: MessagesSquareIcon as BlockIcon,
  send: ArrowUpIcon as BlockIcon,
  stop: SquareIcon as BlockIcon,
  history: HistoryIcon as BlockIcon,
  newChat: PlusIcon as BlockIcon,
  add: PlusIcon as BlockIcon,
  attach: PaperclipIcon as BlockIcon,
  queue: ListEndIcon as BlockIcon,
  jumpToLatest: ArrowDownIcon as BlockIcon,
  reconnect: RefreshCwIcon as BlockIcon,
  fork: GitForkIcon as BlockIcon,
};

export type ChatIcons = typeof defaultChatIcons;

/** What the chat's pieces read: the merged labels and icons. */
export interface ChatText { readonly labels: ChatLabels; readonly icons: ChatIcons }
/** The defaults, as `useMergedText`'s base. */
export const defaultChatText: ChatText = { labels: defaultChatLabels, icons: defaultChatIcons };
const DEFAULT_TEXT = defaultChatText;
const ChatTextContext = createContext<ChatText>(DEFAULT_TEXT);

/** The labels and icons of the surrounding chat (the defaults outside one). */
export const useChatText = (): ChatText => useContext(ChatTextContext);

/** Merges the host's partial labels and icons over the defaults (or over `base`), keeping one object while they do not change. */
export function useMergedText<L extends ChatLabels = ChatLabels, I extends ChatIcons = ChatIcons>(labels: Partial<L> | undefined, icons: Partial<I> | undefined,
  base: { readonly labels: L; readonly icons: I } = DEFAULT_TEXT as { readonly labels: L; readonly icons: I }): { readonly labels: L; readonly icons: I } {
  return useMemo(() => ({ labels: withDefaults(base.labels, labels), icons: withDefaults(base.icons, icons) }), [labels, icons, base]);
}

/** Provides the chat's labels and icons to everything inside (composer, queue, rows, history). */
export function ChatTextProvider({ value, children }: { readonly value: ChatText; readonly children: ReactNode }) {
  return createElement(ChatTextContext.Provider, { value }, children);
}

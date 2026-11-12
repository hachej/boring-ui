'use client';

// The agent layer's shared state and words: the public types, the internal context every part reads (`useInternal`), the shell's constants.
import { createContext, useContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { PresentedArtifact } from '../pi-artifacts/artifact';
import type { FeedbackSession } from '@hachej/boring-feedback/ui';
import type { NativeChatController } from '@hachej/boring-ui-kit/native-chat';
import type { ChatVoiceHandle as Voice } from '@hachej/boring-ui-kit/chat-react/voice';
import type { DockApi } from '../dock/dock';
import type { PiChatProps } from '../pi-chat/pi-chat';
import type { VoiceMessageConfig } from '../pi-chat/config';
import { chatTextFor } from '../pi-chat/locale';
import type { ChatLabels } from '../pi-chat/labels';
import { appShellText } from './text';
import type { AppShellLocale, AppShellText } from './text';
import type { ShellPanel } from './shell-panel';
import type { ScreenHeaderAction } from './header-actions';

export interface AgentSpec {
  readonly controller: NativeChatController;
  /** The agent's name in the expanded sidebar and the header trigger's accessible name (default: the chat's title, then « Assistant »). */
  readonly label?: string;
  /** The agent's icon in the sidebar and the header trigger (default: sparkles). */
  readonly icon?: ComponentType<{ className?: string }>;
  readonly chatProps?: Omit<PiChatProps, 'controller'>;
  /** Push-to-talk. `message` retains audio plus transcript; `auto` sends text only; `draft` (default) fills the composer. */
  readonly voice?: VoiceMessageConfig & { readonly send?: 'auto' | 'draft' | 'message' };
  /** The pointing tool, from the `feedback` item: the composer's annotate toggle and point mode on the app's surface. */
  readonly feedback?: FeedbackSession;
  /** Host actions in the layer's title row (before the dock controls, or the snap and close controls when compact), as the screen header's. Two shown, the rest in « … ». Not at peek. */
  readonly headerActions?: readonly ScreenHeaderAction[];
  /**
   * `composer="bar"` (D-2198): the app's library, the same shape as the workspace bar's `library`: the app renders its file navigator (for example
   * the kit's `FileTreeView`) and calls `onPicked` once a file is chosen. « Bibliothèque » in the assistant's header and in a preview's header opens it
   * in the right pane, by the pane's rules (over the docked conversation, or the right column). A file the app then opens with `useAgentLayer().pane`
   * goes on top of it (« ← Bibliothèque »). `onPicked({ path, files })` lets the kit open the file in its own viewer (`files`) with the list it was
   * picked from (previous and next step through it); `onPicked()` alone closes the library when nothing was opened.
   */
  readonly library?: ((onPicked: (file?: { readonly path: string; readonly files?: readonly string[] | undefined }) => void) => ReactNode) | undefined;
  /**
   * `composer: 'bar'`: how the kit reads a file the app names (attached to a message, cited in a reply, in the library, on a page) to show it in the
   * pane in its own viewer (`LocalFileViewer`: an image with zoom, a PDF by page, a CSV as a table, Markdown, text and code, a video). With it, a file
   * chip, a library pick and the agent's `present` open there; `chatProps.onOpenFile` and `pane.push({ title, content })` stay the app's override.
   * Resolve `{ blob, revision }` to let the pane acknowledge a `present` of that revision once its viewer shows it.
   */
  readonly files?: { readonly read: (path: string) => Promise<Blob | { readonly blob: Blob; readonly revision: string }> } | undefined;
  /** `composer: 'bar'` (AC-13): the person may only read (a role without writing, an assistant switched off). The box stays in place with this
   * one line, the reason, instead of the field; nothing in it can be focused. Absent: the field as usual. */
  readonly readOnly?: string | undefined;
  /** The shell's own words for this assistant (Dicter, Conversation, Détacher en bas, Bibliothèque…) over the locale's defaults (AC-21). Also every word the
   * one composer shows from the chat (`AgentWords`): the field's placeholder, Envoyer, Arrêter, Joindre, Réessayer, the microphone's ✕ and ■, the empty conversation. */
  readonly words?: AgentWords | undefined;
  /** `composer: 'bar'` (kit 0.4.85): one app action on the folded reply card, beside the files it cites (for example « Annuler » to undo what the agent just did). The app
   * shows it by giving it and takes it away by passing nothing; `onSelect` runs when it is pressed and the conversation stays folded. */
  readonly replyAction?: { readonly label: string; readonly onSelect: () => void } | undefined;
  /** `composer: 'bar'` (kit 0.4.85): the app's words on the working card, per phase. `tool` is the tool that runs (absent while the agent thinks), `text` the default words.
   * Return the words, or nothing to keep the default. */
  readonly workingWords?: ((phase: { readonly tool?: string; readonly stage?: string; readonly text: string }) => string | undefined) | undefined;
}

/** The chat's own words an app may override through `agent.words`, next to the shell's (`AppShellText`): all of them are what the one composer shows. */
const CHAT_WORD_KEYS = ['placeholder', 'placeholderWorking', 'messageInput', 'send', 'sendHint', 'stop', 'queue', 'add', 'attachFiles', 'takePhoto', 'commands', 'retry', 'voiceStop', 'voiceCancel', 'emptyDescription'] as const;
export type AgentWords = Partial<AppShellText> & Partial<Pick<ChatLabels, (typeof CHAT_WORD_KEYS)[number]>> & {
  /** The empty conversation's title (« Conversation » by default). */
  readonly emptyTitle?: string;
};
/** The chat words an app gave in `agent.words`, as chat labels (`emptyTitle` is the chat's `title`). */
export const chatWordLabels = (words: AgentWords | undefined): Partial<ChatLabels> => {
  const labels: Record<string, string> = {};
  for (const key of CHAT_WORD_KEYS) { const word = words?.[key]; if (typeof word === 'string') labels[key] = word; }
  if (words?.emptyTitle) labels['title'] = words.emptyTitle;
  return labels as Partial<ChatLabels>;
};
/** The chat's words as this composer shows them: the locale's, then the app's `agent.words`. */
export const composerLabels = (locale: AppShellLocale | undefined, agent: AgentSpec | undefined): ChatLabels => ({ ...chatTextFor(locale ?? agent?.chatProps?.locale).labels, ...chatWordLabels(agent?.words) });

/** Compact: closed, peek, half or full. Expanded: closed or open. */
export type AgentLayerState = 'closed' | 'peek' | 'half' | 'full' | 'open';
export type Which = 'agent' | 'improve';
export type Snap = 'closed' | 'peek' | 'half' | 'full';
export interface AgentLayerApi {
  readonly agent: NativeChatController | undefined;
  readonly state: AgentLayerState;
  readonly showing: Which | null;
  /** Opens the assistant or the PM. Below `TOGETHER_FROM` (and on a phone) it closes the other; from it, the PM opens beside the assistant. */
  open(which?: Which, at?: 'peek' | 'half' | 'full'): void;
  /** Closes what `showing` names: with both open, the assistant (a second call closes the PM). */
  close(): void;
  /** Open the real chat with one card mention. Call directly from a click or swipe release to grant microphone permission. False without an agent. */
  readonly talkAbout: (mention: string, options?: { readonly voice?: boolean; readonly at?: 'half' | 'full' }) => boolean;
  readonly expanded: boolean;
  /**
   * `composer: 'bar'` (D-2198): shows the app's preview of a file (dropped, attached or cited) in the right column, or full screen on a phone. The column holds one
   * thing at a time: a docked assistant goes back above the field (Ouvert) while the preview is open, and comes back when it closes. `null` closes it.
   * False (nothing shown) without `composer: 'bar'` or an agent.
   */
  readonly preview: (preview: AgentPreview | null) => boolean;
  /** `composer: 'bar'`: the right pane's back stack (`preview` is `pane.push`, `preview(null)` is `pane.close()`). */
  readonly pane: AgentPane;
}

/** What `useAgentLayer().pane.push` shows: the app's own view under its title, or a file the kit opens in its viewer (`AgentSpec.files`). */
export type PaneItem = AgentPreview | {
  readonly file: string;
  /** The back control's word for it (default: the file's name). */
  readonly title?: string | undefined;
  /** The set it was opened from (the files of one reply, a folder, a detail's attachments): previous and next step through it, « 2 / 5 ». */
  readonly files?: readonly string[] | undefined;
};

/** The right pane: one place with a back stack, whatever put content there (the app's detail views, a file, the library, the agent's `present`). */
export interface AgentPane {
  /** Shows `item` on top (opening the pane); its back control returns to what was under it, as it was. False when it cannot be shown. */
  push(item: PaneItem): boolean;
  /** One step back: the entry under the top, or the pane closes. */
  back(): void;
  /** Closes the pane, whatever it holds. */
  close(): void;
  /** How many entries the pane holds (0: closed). */
  readonly depth: number;
}

/** One entry of the pane's stack: what it shows, its title (the back control of the entry above says it) and the control that opened it (focus returns there). */
export type PaneEntry = { readonly id: number; readonly title: string; readonly opener: HTMLElement | null } & (
  | { readonly kind: 'view'; readonly content: ReactNode }
  | { readonly kind: 'library'; readonly content: ReactNode }
  | { readonly kind: 'file'; readonly path: string; readonly files: readonly string[]; readonly revision?: string | undefined });

/** What `useAgentLayer().preview` shows: the app's own view of the file, under its title. */
export interface AgentPreview {
  readonly title: string;
  readonly content: ReactNode;
}
// The three fixed snap points: a peek (the file chip, one composer row and a line of the last reply, `PEEK_REM` above the tab bar), 55% and the full height.
export const PEEK_REM = 8;
/** `composer: 'bar'` (AC-20, mockup l-6): the peek is the one field and the handle, no line of the thread. */
export const PEEK_BAR_REM = 6;
/** The shell's z-scale (tabs 20, peek 30, drawer and panel 40, other sheets 50, point bar 60). */
export const Z = { tabs: 20, peek: 30, layer: 40, sheet: 50, point: 60 } as const;
export const HALF = 0.55;
export const FULL = 1;
/** Hold the trigger this long before it records; shorter is a tap. */
export const HOLD_MS = 350;
/**
 * From this width the assistant dock and the PM column are open together: the expanded sidebar (the default `--sidebar-width`, 16rem) + the screen's least width
 * (`DockLayout`'s 360px) + the dock's least width (320px) + the PM column (26rem) = 1352px. Below it they are one at a time, as on a phone.
 * A media query cannot read `--sidebar-width`, so this stays a constant for the default 16rem. A narrower themed sidebar only adds room; a sidebar wider than 16.5rem (8px of slack) needs this raised.
 */
export const TOGETHER_FROM = 1360;
export const TOGETHER_QUERY = `(width >= ${TOGETHER_FROM}px)`;
/** The PM column's width in px (26rem): while it is open beside the dock, the dock leaves the screen its least width beside both. */
export const PM_COLUMN = 416;
export const MIN_MAIN = 360;
export interface Internal extends Omit<AgentLayerApi, 'agent'> {
  /** The layer's own controls (Close, the trigger, Escape, a swipe): the one snap (the assistant, or the PM where they are one at a time). */
  readonly close: () => void;
  /** `AgentLayerApi.close`: what `showing` names. */
  readonly closeShowing: () => void;
  readonly agent: AgentSpec | undefined;
  readonly improve: ShellPanel | undefined;
  readonly snap: Snap;
  readonly setSnap: (snap: Snap) => void;
  /** Whether the wide layout's dock is floating over the app (reported by the panel); with `expanded` it gives the chats' placement. */
  readonly dockFloating: boolean;
  readonly setDockFloating: (floating: boolean) => void;
  readonly showAgent: () => void;
  /** Wide enough for both and the PM column open: the dock leaves room for it (`AgentDockLayout`). */
  readonly besidePanel: boolean;
  /** Until this time (ms) an outside press is the AgentTrigger's own click. */
  readonly triggerUntil: { current: number };
  readonly voice: Voice;
  readonly talkRecording: boolean;
  /** `bar`: the microphone was held and released, so the words it brings are sent at once instead of waiting in the field (AC-11). */
  readonly holdSend: { current: boolean };
  /** The peek height in px: `PEEK_REM` plus the tab bar the peek sits above. */
  readonly peekPoint: string;
  /** The measured tab bar height in px, given explicitly to the parts portalled to the body (they cannot inherit the shell's variables). */
  readonly tabbar: number;
  /** The persistent element holding both chats: it moves between the drawer and the panel, so closing never unmounts a chat. */
  readonly host: HTMLElement | null;
  /** The shell's `locale`: it wins over `agent.chatProps.locale` (used only when the shell sets none). */
  readonly locale: AppShellLocale | undefined;
  /** Expanded only: the side the dock sits on while docked (the viewer's choice, remembered). */
  readonly side: DockSide;
  readonly setSide: (side: DockSide) => void;
  /** `composer: 'content'` on a wide screen with an assistant: the field is drawn under the page content, the dock holds only the thread. False on a phone (the peek drawer) and for `'dock'`. */
  readonly contentComposer: boolean;
  /** `composer: 'content'` with an agent: the content always sits in the same column wrapper, wide or narrow, so crossing the breakpoint never remounts the screen. */
  readonly contentColumn: boolean;
  /** Where the content composer is drawn and the element a dropped file is taken on (both set by `AgentDockLayout`). */
  readonly composerSlot: HTMLElement | null;
  readonly dropZone: HTMLElement | null;
  readonly setComposerSlot: (element: HTMLElement | null) => void;
  /** An `AgentComposerAnchor` is mounted: the field and the tray are drawn there, not in the full-width slot. */
  readonly anchored: boolean;
  readonly setAnchor: (anchor: { readonly tray: HTMLElement; readonly field: HTMLElement; readonly card: HTMLElement } | null) => void;
  readonly setDropZone: (element: HTMLElement | null) => void;
  /** The content composer sent a message: the thread opens in the dock (`bar` on a wide screen: it stays folded, the card shows the work and the reply). */
  readonly onSent: () => void;
  /** Set by a dock control: the next placement or side change puts focus back on the panel's first dock control. */
  readonly restoreFocus: { current: boolean };
  /** Content composer on a wide screen: where a send opens the thread, the person's remembered choice. A tray above the field (default) or the dock. */
  readonly mode: AgentMode;
  readonly setMode: (mode: AgentMode) => void;
  /** The tray's Dock: the same thread to the side pane, docked (never floating), and remember the choice. */
  readonly moveToDock: () => void;
  /** The dock panel reports its api so the tray can dock it. */
  readonly registerDock: (api: DockApi | null) => void;
  /** The tray is filling the main column (Agrandir). */
  readonly grown: boolean;
  readonly setGrown: (grown: boolean) => void;
  /** The thread is on show in the tray above the field. */
  readonly trayOpen: boolean;
  /** The thread is on show in the dock (the dock's own `open`). */
  readonly dockOpen: boolean;
  /** `composer: 'bar'`: the one composer (D-2198). */
  readonly bar: boolean;
  /** `composer: 'bar'` on a wide screen with the conversation folded: the reply card sits on the field. */
  readonly folded: boolean;
  /** Where the folded card is drawn, right above the field (set by `ContentColumn` or `AgentComposerAnchor`). */
  readonly cardSlot: HTMLElement | null;
  readonly setCardSlot: (element: HTMLElement | null) => void;
  /** `bar` on a phone: the card's place in the drawer's peek, and the height the peek grows by while the card shows. */
  readonly setPhoneCard: (element: HTMLElement | null) => void;
  readonly cardPx: number;
  readonly setCardPx: (px: number) => void;
  /** The right pane's entries, the top one last (`AgentLayerApi.pane`). */
  readonly stack: readonly PaneEntry[];
  /** The pane sits on top of the docked conversation in the same column (« ← Assistant »), not in a column of its own. */
  readonly paneStacked: boolean;
  /** Opens `agent.library` in the right pane (undefined without one). */
  readonly openLibrary: (() => void) | undefined;
  /** Opens a file the person chose in the chat (a chip, a mention) in the pane, with the set it belongs to; undefined when the kit cannot read files. */
  readonly openFile: ((path: string, files?: readonly string[]) => void) | undefined;
  /** The pane's previous or next file of the set the top entry was opened from. */
  readonly step: (offset: -1 | 1) => void;
  /** The chat's artifact cards and the agent's `present` route here (PiChat's `artifacts`), with the viewer's mount report for the acknowledgement. */
  readonly presented: PanePresent | undefined;
}

/** The pane's side of the agent's `present` (useArtifactFollow): open a card's artifact, which card is on show, and the viewer's mount report. */
export interface PanePresent {
  readonly open: (artifact: PresentedArtifact) => void;
  readonly isOpen: (artifact: PresentedArtifact) => boolean;
  readonly shown: (shown: { readonly path: string; readonly revision: string; readonly hidden?: true }) => void;
}

export type DockSide = 'left' | 'right';
/** Where a thread sent from the content composer opens on a wide screen: `tray` above the field, or `dock` beside the app. */
export type AgentMode = 'tray' | 'dock';
/**
 * Where the assistant's field sits on a wide screen. `dock` (default): inside the dock, under the thread. `content`: pinned under the page
 * content, at the content's width, with the dock holding only the thread (one controller, one thread, the same chat as the phone's peek).
 * `bar` (D-2198), the one composer: the same field under the page, drawn as one row (the conversation's chevron, attach, the field and one
 * action button, Dicter, Envoyer or Arrêter; `/` opens the actions), the conversation's work or reply as a card on the field while it is folded,
 * and docked, the field goes with the thread to the right column (nothing stays at the bottom). `useAgentLayer().pane` fills that column.
 * Below the wide breakpoint nothing changes: the peek drawer.
 */
export type AgentComposer = 'dock' | 'content' | 'bar';
/** The dock's remembered state lives under this prefix (DockLayout's storageKey): `<key>.agent.floating`, `.width`, and the side. */
export const DOCK_KEY = 'boring.app-shell';
export const SIDE_KEY = `${DOCK_KEY}.agent.side`;
/** The tray's height: 35% of the content column, at most this many px. */
export const TRAY_MAX = 360;

export const LayerContext = createContext<Internal | null>(null);

export function useInternal(): Internal {
  const layer = useContext(LayerContext);
  if (!layer) throw new Error('useAgentLayer needs an AgentLayerProvider');
  return layer;
}
/** The layer's words: the locale's defaults, then the app's own (`agent.words`). */
export const shellWords = (locale: AppShellLocale | undefined, agent: AgentSpec | undefined): AppShellText => agent?.words ? { ...appShellText(locale), ...agent.words } as AppShellText : appShellText(locale);
/** Folded (`composer: 'bar'`): the card on the field says what the agent does, so the chat's own status line, its files list and its send notice (the box's one line says it, AC-12) step aside. */
export const FOLDED_FIELD = '[&_[data-testid=preparing]]:hidden [&_[data-testid=composer-dock]_p[data-testid=agent-status]]:hidden [&_[data-testid=conversation-files]]:hidden [&_[data-testid=send-blocked]]:hidden [&_[data-testid=send-unknown]]:hidden';

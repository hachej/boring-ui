/*
 * The words and icons of the pi-app block as plain data: its own (sessions pane, artifact panel, file viewer) and the viewers' it composes
 * (`defaultViewerLabels`). `AgentWorkspace` takes a partial `labels` and `icons`; the chat's go through `chat.labels` and `chat.icons`.
 */
import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeftIcon, LibraryIcon, MessageSquareIcon, PanelLeftIcon, PictureInPicture2Icon, PlusIcon, XIcon } from 'lucide-react';
import type { BlockIcon } from '../button/actions';
import { defaultViewerIcons, defaultViewerLabels } from '../viewers/viewer-window';

export const defaultAppLabels = {
  ...defaultViewerLabels,
  sessionsTitle: 'Chats',
  workspaceNavigation: 'Workspace navigation',
  openNavigation: 'Open navigation',
  closeNavigation: 'Close navigation',
  hideNavigation: 'Hide navigation',
  showNavigation: 'Show navigation',
  chat: 'Chat',
  library: 'Library',
  agent: 'Agent',
  backToChat: 'Back to chat',
  newChat: 'New',
  closeSessions: 'Close chats',
  openSessions: 'Open chats',
  hideSessions: 'Hide chats',
  showSessions: 'Show chats',
  floatChat: 'Float chat',
  floatHint: 'Release to float the chat',
  resizePanel: 'Resize artifact panel',
  artifactPanel: 'Artifact panel',
  back: 'Back',
  savedAt: (when: string) => `Saved ${when}`,
  latestSavedAt: (when: string) => `Latest, saved ${when}`,
  olderVersion: 'Older version',
  earlierVersion: 'Earlier version',
  artifactNotText: 'This artifact cannot be shown as text.',
  versionUnavailable: 'This version is not available.',
  noCanvasViewer: 'This host has no canvas viewer (pass one in `viewers.canvas`).',
  fileMissing: 'This file no longer exists.',
  attachmentTooLarge: (limit: string) => `Larger than ${limit}. Not saved.`,
  fileNotText: 'This file cannot be shown as text.',
  binaryFile: (size: string) => `This is a binary file (${size}); it cannot be shown as text.`,
  fileViewer: (kind: string) => `${kind} viewer`,
  newVersion: 'A new version is available.',
};
export type AppLabels = typeof defaultAppLabels;

export const defaultAppIcons = {
  ...defaultViewerIcons,
  sessionsToggle: PanelLeftIcon as BlockIcon,
  library: LibraryIcon as BlockIcon,
  chat: MessageSquareIcon as BlockIcon,
  newChat: PlusIcon as BlockIcon,
  closeSessions: XIcon as BlockIcon,
  floatChat: PictureInPicture2Icon as BlockIcon,
  back: ArrowLeftIcon as BlockIcon,
};
export type AppIcons = typeof defaultAppIcons;

export interface AppText { readonly labels: AppLabels; readonly icons: AppIcons }
const AppTextContext = createContext<AppText>({ labels: defaultAppLabels, icons: defaultAppIcons });
/** The block's labels and icons (the defaults outside an `AgentWorkspace`). */
export const useAppText = (): AppText => useContext(AppTextContext);
export function AppTextProvider({ value, children }: { readonly value: AppText; readonly children: ReactNode }) {
  return createElement(AppTextContext.Provider, { value }, children);
}

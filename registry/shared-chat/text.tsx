'use client';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ChannelMessage } from '@hachej/boring-ui-kit/shared-chat';
import { useChatText as useNativeText, useShallowStable } from '../pi-chat/labels';
import type { ChatArtifactsConfig } from '../pi-chat/config';
import { defaultSharedLabels } from './shared-labels';
import type { SharedLabels } from './shared-labels';
import { frenchSharedLabels } from './shared-labels-fr';

/** How the room looks. Every default is today's look; a host turns pieces off or on to match its own plain chat chrome. */
export interface SharedViewOptions {
  /** Optional host cards/opener for exact native room descriptors. Does not grant resource read access. */
  readonly artifacts?: ChatArtifactsConfig | undefined;
  /** `false`: no members control, no avatars and no author lines. Default `true`. */
  readonly presence?: boolean | undefined;
  /** `'hidden'`: the agent's steps are never shown (no « 3 steps » line, no progress). Default `'shown'`. */
  readonly steps?: 'shown' | 'hidden' | undefined;
  /** Actions on an answer; `'copy'` copies its text. Default none. */
  readonly answerActions?: readonly 'copy'[] | undefined;
  /** A line under each answer (« Generated in 1.0 s »). Keep it stable (memoised or module-level): an inline function changes the view on every render. */
  readonly footer?: ((message: ChannelMessage) => ReactNode) | undefined;
  /** `'plain'`: the agent's answer is plain text, not a bubble; people's messages keep theirs. Default `'bubble'`. */
  readonly answerStyle?: 'bubble' | 'plain' | undefined;
}
export interface SharedTextOptions extends SharedViewOptions { readonly locale?: 'en' | 'fr' | undefined; readonly labels?: Partial<SharedLabels> | undefined }
const Context = createContext(defaultSharedLabels);
const View = createContext<SharedViewOptions>({});
export function SharedTextProvider({ children, locale, labels: given, presence, steps, answerActions: actions, footer, answerStyle, artifacts }: SharedTextOptions & { readonly children: ReactNode }) {
  // Inline `labels` or `answerActions` keep one context while their content is the same (see useShallowStable).
  const labels = useShallowStable(given), answerActions = useShallowStable(actions);
  const value = useMemo(() => ({ ...(locale === 'fr' ? frenchSharedLabels : defaultSharedLabels), ...labels }), [locale, labels]);
  const view = useMemo<SharedViewOptions>(() => ({ presence, steps, answerActions, footer, answerStyle, artifacts }), [presence, steps, answerActions, footer, answerStyle, artifacts]);
  return <Context.Provider value={value}><View.Provider value={view}>{children}</View.Provider></Context.Provider>;
}
export const useSharedView = () => useContext(View);
export function useChatText() {
  const native = useNativeText(), labels = useContext(Context);
  return useMemo(() => ({ ...native, labels: { ...native.labels, ...labels } }), [native, labels]);
}

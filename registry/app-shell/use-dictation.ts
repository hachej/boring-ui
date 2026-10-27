'use client';

import { useDictation as useKitDictation } from '@hachej/boring-ui-kit/chat-react';
import type { DictationOptions as KitDictationOptions } from '@hachej/boring-ui-kit/chat-react';
import { chatTextFor } from '../pi-chat/locale';
import type { ChatLocale } from '../pi-chat/locale';

export type { Dictation, DictationPhase, DictationLabels } from '@hachej/boring-ui-kit/chat-react';
export interface DictationOptions extends Omit<KitDictationOptions, 'labels'> {
  readonly locale?: ChatLocale | undefined;
  readonly labels?: Partial<KitDictationOptions['labels']> | undefined;
}

/** Compatibility adapter: locale words stay with the copied presentation; the kit owns dictation. */
export function useDictation(options: DictationOptions) {
  return useKitDictation({ ...options, labels: { ...chatTextFor(options.locale).labels, ...options.labels } });
}

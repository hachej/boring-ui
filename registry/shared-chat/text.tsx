'use client';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useChatText as useNativeText } from '../pi-chat/labels';
import { defaultSharedLabels } from './shared-labels';
import type { SharedLabels } from './shared-labels';
import { frenchSharedLabels } from './shared-labels-fr';

export interface SharedTextOptions { readonly locale?: 'en' | 'fr' | undefined; readonly labels?: Partial<SharedLabels> | undefined }
const Context = createContext(defaultSharedLabels);
export function SharedTextProvider({ children, locale, labels }: SharedTextOptions & { readonly children: ReactNode }) {
  const value = useMemo(() => ({ ...(locale === 'fr' ? frenchSharedLabels : defaultSharedLabels), ...labels }), [locale, labels]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useChatText() {
  const native = useNativeText(), labels = useContext(Context);
  return { ...native, labels: { ...native.labels, ...labels } };
}

// Subscribes a component to one of the headless states of `@hachej/boring-feedback/ui` (annotate, list, report).
import { useSyncExternalStore } from 'react';
import type { ExternalState } from '@hachej/boring-feedback/ui';

export function useExternal<State>(state: ExternalState<State>): State {
  return useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
}

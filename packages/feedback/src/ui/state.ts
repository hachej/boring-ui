// A minimal external store: `subscribe` and `getSnapshot` fit React's `useSyncExternalStore` and any other view layer.

export interface ExternalState<State> {
  readonly getSnapshot: () => State;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface WritableState<State> extends ExternalState<State> {
  readonly set: (change: Partial<State>) => State;
  /** Replaces the whole snapshot (drops optional fields `set` would keep). */
  readonly replace: (next: State) => State;
}

export function createState<State extends object>(initial: State): WritableState<State> {
  let snapshot = Object.freeze({ ...initial });
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: change => {
      snapshot = Object.freeze({ ...snapshot, ...change });
      for (const listener of [...listeners]) listener();
      return snapshot;
    },
    replace: next => {
      snapshot = Object.freeze({ ...next });
      for (const listener of [...listeners]) listener();
      return snapshot;
    },
  };
}

import type { UiBridge, UiState } from "../../shared/ui-bridge";

type UiStateUpdater = (current: UiState) => UiState | undefined;

const updateTails = new WeakMap<UiBridge, Promise<void>>();

/** Serialize read-modify-write state updates for each in-process bridge. */
export async function updateUiState(
  bridge: UiBridge,
  update: UiStateUpdater,
): Promise<void> {
  const previous = updateTails.get(bridge) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const current = (await bridge.getState()) ?? {};
      const next = update(current);
      if (next !== undefined && next !== current) await bridge.setState(next);
    });
  const tail = operation.then(() => undefined, () => undefined);
  updateTails.set(bridge, tail);

  try {
    await operation;
  } finally {
    if (updateTails.get(bridge) === tail) updateTails.delete(bridge);
  }
}

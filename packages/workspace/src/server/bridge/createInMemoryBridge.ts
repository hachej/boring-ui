import type {
  WorkspaceBridge,
  UiState,
  UiCommand,
  CommandResult,
} from "../../shared/ui-bridge";

type AnnotatedCommand = UiCommand & { seq: number };
type CommandHandler = (cmd: AnnotatedCommand) => unknown;
const MAX_PENDING_COMMANDS = 1_000;

export function createInMemoryBridge(): WorkspaceBridge {
  let state: UiState | null = null;
  let nextSeq = 1;
  const subscribers = new Set<CommandHandler>();
  const pendingCommands: AnnotatedCommand[] = [];

  function enqueuePending(command: AnnotatedCommand): void {
    pendingCommands.push(command);
    if (pendingCommands.length > MAX_PENDING_COMMANDS) {
      pendingCommands.splice(0, pendingCommands.length - MAX_PENDING_COMMANDS);
    }
  }

  function offerCommand(command: AnnotatedCommand): boolean {
    let delivered = false;
    for (const handler of subscribers) {
      try {
        if (handler(command) !== false) delivered = true;
      } catch {
        // A broken sink must not prevent another subscriber from accepting the
        // command or prevent the command from remaining queued.
      }
    }
    return delivered;
  }

  function offerPendingCommands(): void {
    if (pendingCommands.length === 0) return;
    const queued = pendingCommands.splice(0, pendingCommands.length);
    const undelivered = queued.filter((command) => !offerCommand(command));
    if (undelivered.length === 0) return;
    pendingCommands.unshift(...undelivered);
    if (pendingCommands.length > MAX_PENDING_COMMANDS) {
      pendingCommands.splice(0, pendingCommands.length - MAX_PENDING_COMMANDS);
    }
  }

  async function dispatchCommand(cmd: UiCommand): Promise<CommandResult> {
    const seq = nextSeq++;
    const annotated: AnnotatedCommand = { ...cmd, seq };
    if (!offerCommand(annotated)) enqueuePending(annotated);
    return { seq, status: "ok" };
  }

  return {
    async getState() {
      return state;
    },

    async setState(s: UiState) {
      state = s;
    },

    async postCommand(cmd: UiCommand): Promise<CommandResult> {
      return dispatchCommand(cmd);
    },

    async emitUiEffect(cmd: UiCommand): Promise<CommandResult> {
      return dispatchCommand(cmd);
    },

    subscribeCommands(handler: CommandHandler): () => void {
      subscribers.add(handler);
      // Subscribe before replaying. Commands posted during the replay see the
      // subscriber, and a failed newcomer causes the queue to be offered to
      // every already-ready subscriber instead of stranding it.
      offerPendingCommands();
      return () => {
        subscribers.delete(handler);
      };
    },

    async drainCommands(): Promise<AnnotatedCommand[]> {
      if (pendingCommands.length === 0) return [];
      return pendingCommands.splice(0, pendingCommands.length);
    },
  };
}

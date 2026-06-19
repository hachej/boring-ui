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

  async function dispatchCommand(cmd: UiCommand): Promise<CommandResult> {
    const seq = nextSeq++;
    const annotated: AnnotatedCommand = { ...cmd, seq };
    let delivered = false;
    for (const handler of subscribers) {
      if (handler(annotated) !== false) delivered = true;
    }
    if (!delivered) enqueuePending(annotated);
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

import type {
  UiBridge,
  UiState,
  UiCommand,
  CommandResult,
} from "../../shared/ui-bridge";

type AnnotatedCommand = UiCommand & { seq: number };
type CommandHandler = (cmd: AnnotatedCommand) => void;
const MAX_PENDING_COMMANDS = 1_000;

export function createInMemoryBridge(): UiBridge {
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

  return {
    async getState() {
      return state;
    },

    async setState(s: UiState) {
      state = s;
    },

    async postCommand(cmd: UiCommand): Promise<CommandResult> {
      const seq = nextSeq++;
      const annotated: AnnotatedCommand = { ...cmd, seq };
      if (subscribers.size === 0) enqueuePending(annotated);
      for (const handler of subscribers) {
        handler(annotated);
      }
      return { seq, status: "ok" };
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

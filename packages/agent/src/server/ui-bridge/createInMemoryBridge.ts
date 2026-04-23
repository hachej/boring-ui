import type {
  UiBridge,
  UiState,
  UiCommand,
  CommandResult,
} from "../../shared/ui-bridge.js";

type AnnotatedCommand = UiCommand & { seq: number };
type CommandHandler = (cmd: AnnotatedCommand) => void;

export function createInMemoryBridge(): UiBridge {
  let state: UiState | null = null;
  let nextSeq = 1;
  const subscribers = new Set<CommandHandler>();

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
  };
}

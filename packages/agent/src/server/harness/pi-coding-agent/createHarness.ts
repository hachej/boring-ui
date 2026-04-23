import {
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  SessionManager,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { AgentHarness, SendMessageInput, RunContext } from "../../../shared/harness.js";
import type { AgentTool } from "../../../shared/tool.js";
import type { UIMessageChunk } from "../../../shared/message.js";
import { adaptToolsForPi } from "./tool-adapter.js";
import { piEventToChunks } from "./stream-adapter.js";
import { PiSessionStore } from "./sessions.js";

interface PiSessionHandle {
  piSession: AgentSession;
  modelRegistry: ModelRegistry;
}

export function createPiCodingAgentHarness(opts: {
  tools: AgentTool[];
}): AgentHarness {
  const sessionStore = new PiSessionStore();
  const piSessions = new Map<string, PiSessionHandle>();

  async function getOrCreatePiSession(
    sessionId: string,
    input: SendMessageInput,
    ctx: RunContext,
  ): Promise<PiSessionHandle> {
    const existing = piSessions.get(sessionId);
    if (existing) return existing;

    const authStorage = AuthStorage.inMemory();
    const modelRegistry = ModelRegistry.inMemory(authStorage);

    const model = input.model
      ? modelRegistry.find(input.model.provider, input.model.id)
      : undefined;

    const { session: piSession } = await createAgentSession({
      cwd: ctx.workdir,
      tools: [],
      customTools: adaptToolsForPi(opts.tools),
      model,
      thinkingLevel: input.thinkingLevel ?? "off",
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
    });

    const handle: PiSessionHandle = { piSession, modelRegistry };
    piSessions.set(sessionId, handle);
    return handle;
  }

  function disposePiSession(sessionId: string): void {
    const handle = piSessions.get(sessionId);
    if (!handle) return;
    handle.piSession.dispose();
    piSessions.delete(sessionId);
  }

  const originalDelete = sessionStore.delete.bind(sessionStore);
  sessionStore.delete = async (ctx, sessionId) => {
    await originalDelete(ctx, sessionId);
    disposePiSession(sessionId);
  };

  return {
    id: "pi-coding-agent",
    placement: "server",
    sessions: sessionStore,

    async *sendMessage(
      input: SendMessageInput,
      ctx: RunContext,
    ): AsyncIterable<UIMessageChunk> {
      const { piSession } = await getOrCreatePiSession(
        input.sessionId,
        input,
        ctx,
      );

      const chunks: UIMessageChunk[] = [];
      let done = false;
      let streamError: unknown = null;
      let wake: (() => void) | null = null;

      const unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
        const converted = piEventToChunks(event);
        chunks.push(...converted);
        if (event.type === "agent_end") {
          done = true;
        }
        if (wake) wake();
      });

      const onAbort = () => {
        streamError = new Error("Aborted");
        done = true;
        if (wake) wake();
      };
      ctx.abortSignal.addEventListener("abort", onAbort, { once: true });

      try {
        await piSession.prompt(input.message);

        while (!done) {
          if (chunks.length === 0) {
            await new Promise<void>((r) => {
              wake = r;
            });
            wake = null;
          }
          if (streamError) throw streamError;
          while (chunks.length > 0) {
            yield chunks.shift()!;
          }
        }
        while (chunks.length > 0) {
          yield chunks.shift()!;
        }
      } finally {
        ctx.abortSignal.removeEventListener("abort", onAbort);
        unsubscribe();
        sessionStore.touchSession(input.sessionId);
      }
    },
  };
}

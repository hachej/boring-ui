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
import { createSessionTitleScheduler } from "./sessionTitle.js";

interface PiSessionHandle {
  piSession: AgentSession;
  modelRegistry: ModelRegistry;
}

export function createPiCodingAgentHarness(opts: {
  tools: AgentTool[];
  cwd: string;
}): AgentHarness {
  const sessionStore = new PiSessionStore(opts.cwd);
  const piSessions = new Map<string, PiSessionHandle>();
  const scheduleSessionTitle = createSessionTitleScheduler({
    loadSession: (sessionId) =>
      sessionStore.load({ workspaceId: "default" }, sessionId),
    writeTitle: (sessionId, title) => {
      sessionStore.touchSession(sessionId, title);
    },
  });

  async function getOrCreatePiSession(
    sessionId: string,
    input: SendMessageInput,
    ctx: RunContext,
  ): Promise<PiSessionHandle> {
    const existing = piSessions.get(sessionId);
    if (existing) return existing;

    // AuthStorage.create() reads env vars (ANTHROPIC_API_KEY etc.) + ~/.pi/agent/auth.json.
    // AuthStorage.inMemory() would not pick up credentials.
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);

    // Map our short aliases → pi-ai's registered model IDs.
    // Frontend sends {provider:'anthropic', id:'sonnet'|'haiku'|'opus'}; pi-ai
    // registers 'claude-sonnet-4.6' / 'claude-haiku-4.5' / 'claude-opus-4.7'.
    const ALIAS_TO_PI_ID: Record<string, string> = {
      sonnet: "claude-sonnet-4.6",
      haiku: "claude-haiku-4.5",
      opus: "claude-opus-4.7",
    };
    const requestedId = input.model?.id;
    const piId = requestedId
      ? (ALIAS_TO_PI_ID[requestedId] ?? requestedId)
      : undefined;
    const resolvedModel = input.model && piId
      ? modelRegistry.find(input.model.provider, piId)
      : undefined;
    // Default: sonnet for anthropic if nothing resolved, preventing pi from
    // falling back to openai-codex when only ANTHROPIC_API_KEY is set.
    const model = resolvedModel
      ?? modelRegistry.find("anthropic", ALIAS_TO_PI_ID.sonnet);

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
      let assistantText = "";
      const textDeltaSeen = new Set<number>();

      const activeTools = new Map<string, number>();
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      function stopHeartbeat() {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }

      function startHeartbeat() {
        if (heartbeatTimer) return;
        heartbeatTimer = setInterval(() => {
          const now = Date.now();
          for (const [toolCallId, startTime] of activeTools) {
            chunks.push({
              type: "data-status",
              data: { toolCallId, elapsedMs: now - startTime },
            } as unknown as UIMessageChunk);
          }
          if (activeTools.size > 0 && wake) wake();
        }, 2000);
      }

      const unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
        if (event.type === "message_update") {
          const ame = event.assistantMessageEvent;
          if (ame.type === "text_delta") {
            textDeltaSeen.add(ame.contentIndex);
            assistantText += ame.delta;
          }
          if (
            ame.type === "text_end"
            && typeof ame.content === "string"
            && !textDeltaSeen.has(ame.contentIndex)
          ) {
            assistantText += ame.content;
          }
        }

        if (event.type === "tool_execution_start") {
          activeTools.set(event.toolCallId, Date.now());
          startHeartbeat();
        }
        if (event.type === "tool_execution_end") {
          activeTools.delete(event.toolCallId);
          if (activeTools.size === 0) stopHeartbeat();
        }

        const converted = piEventToChunks(event);
        chunks.push(...converted);
        if (event.type === "agent_end") {
          done = true;
          stopHeartbeat();
        }
        if (wake) wake();
      });

      const onAbort = () => {
        streamError = new Error("Aborted");
        done = true;
        stopHeartbeat();
        piSession.abort().catch(() => {});
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
        stopHeartbeat();
        ctx.abortSignal.removeEventListener("abort", onAbort);
        unsubscribe();
        sessionStore.touchSession(input.sessionId);
        if (!streamError) {
          scheduleSessionTitle({
            sessionId: input.sessionId,
            firstUserMessage: input.message,
            firstAssistantReply: assistantText,
          });
        }
      }
    },
  };
}

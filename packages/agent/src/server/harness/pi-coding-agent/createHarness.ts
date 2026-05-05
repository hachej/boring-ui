import {
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SettingsManager,
  getAgentDir,
  loadSkills,
} from "@mariozechner/pi-coding-agent";
import type { AgentHarness, SendMessageInput, RunContext } from "../../../shared/harness.js";
import type { AgentTool } from "../../../shared/tool.js";
import type { UIMessageChunk } from "../../../shared/message.js";
import { adaptToolsForPi } from "./tool-adapter.js";
import { piEventToChunks } from "./stream-adapter.js";
import { PiSessionStore } from "./sessions.js";
import { createSessionTitleScheduler } from "./sessionTitle.js";
import {
  readConfiguredDefaultModel,
  registerConfiguredModelProviders,
} from "../../models/modelConfig.js";
import {
  mergePiPackageSources,
  type PiPackageSource,
} from "../../piPackages.js";

interface PiSessionHandle {
  piSession: AgentSession;
  modelRegistry: ModelRegistry;
}

export { mergePiPackageSources } from "../../piPackages.js";
export type { PiPackageSource } from "../../piPackages.js";

export interface PiResourceLoaderOptions {
  noContextFiles?: boolean;
  noSkills?: boolean;
  additionalSkillPaths?: string[];
  /**
   * Additional native Pi package sources to enable for this agent runtime.
   * These are applied as in-memory SettingsManager overrides, so host/plugin
   * declarations do not mutate .pi/settings.json.
   */
  piPackages?: PiPackageSource[];
}

const ALIAS_TO_PI_ID: Record<string, string> = {
  sonnet: "claude-sonnet-4.6",
  haiku: "claude-haiku-4.5",
  opus: "claude-opus-4.7",
  // Anthropic deprecated this legacy ID; map to current haiku family.
  "claude-3-5-haiku-20241022": "claude-haiku-4.5",
};

function extractAssistantMessageText(message: unknown): {
  role?: string;
  text: string;
  errorText: string;
} {
  const record = message as {
    role?: unknown;
    content?: unknown;
    errorMessage?: unknown;
  } | null;
  const role = typeof record?.role === "string" ? record.role : undefined;
  const errorText =
    typeof record?.errorMessage === "string" ? record.errorMessage : "";
  const text = Array.isArray(record?.content)
    ? record.content
        .map((part) => {
          const item = part as { type?: unknown; text?: unknown };
          return item?.type === "text" && typeof item.text === "string"
            ? item.text
            : "";
        })
        .join("")
    : "";
  return { role, text, errorText };
}

function findLastAssistantMessage(messages: unknown): unknown {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: unknown } | undefined;
    if (message?.role === "assistant") return message;
  }
  return undefined;
}

function resolveRequestedModel(
  modelRegistry: ModelRegistry,
  input: SendMessageInput,
) {
  const requestedId = input.model?.id;
  const piId = requestedId
    ? (ALIAS_TO_PI_ID[requestedId] ?? requestedId)
    : undefined;
  return input.model && piId
    ? modelRegistry.find(input.model.provider, piId)
    : undefined;
}

function resolveDefaultModel(modelRegistry: ModelRegistry) {
  const configured = readConfiguredDefaultModel();
  if (configured) {
    const model = modelRegistry.find(configured.provider, configured.id);
    if (model) return model;
  }
  return modelRegistry.find("anthropic", ALIAS_TO_PI_ID.sonnet);
}

export function createResourceSettingsManager(
  cwd: string,
  agentDir: string,
  piPackages: PiPackageSource[],
): SettingsManager {
  const fileSettingsManager = SettingsManager.create(cwd, agentDir);
  if (piPackages.length === 0) return fileSettingsManager;

  const projectSettings = fileSettingsManager.getProjectSettings();
  let globalSettingsJson: string | undefined = JSON.stringify(
    fileSettingsManager.getGlobalSettings(),
  );
  let projectSettingsJson: string | undefined = JSON.stringify({
    ...projectSettings,
    packages: mergePiPackageSources(projectSettings.packages ?? [], piPackages),
  });
  // Pi settings writes stay visible to this SettingsManager instance, but do
  // not mutate host/project files while workspace-owned packages are injected.
  // SettingsManager also uses `undefined` as the callback result for reads, so
  // preserve the current JSON whenever a callback does not produce a new value.
  const storage: Parameters<typeof SettingsManager.fromStorage>[0] = {
    withLock(scope, fn) {
      if (scope === "global") {
        globalSettingsJson = fn(globalSettingsJson) ?? globalSettingsJson;
      } else {
        projectSettingsJson = fn(projectSettingsJson) ?? projectSettingsJson;
      }
    },
  };

  return SettingsManager.fromStorage(storage);
}

async function applyRequestedSessionOptions(
  handle: PiSessionHandle,
  input: SendMessageInput,
): Promise<void> {
  const requestedModel = resolveRequestedModel(handle.modelRegistry, input);
  if (requestedModel) {
    const current = handle.piSession.model;
    if (
      !current ||
      current.provider !== requestedModel.provider ||
      current.id !== requestedModel.id
    ) {
      await handle.piSession.setModel(requestedModel);
    }
  }

  if (input.thinkingLevel) {
    handle.piSession.setThinkingLevel(input.thinkingLevel);
  }
}

export function createPiCodingAgentHarness(opts: {
  tools: AgentTool[];
  cwd: string;
  /** Append-only addendum to pi's base system prompt. */
  systemPromptAppend?: string;
  /** Optional pi resource-loader isolation knobs. */
  resourceLoaderOptions?: PiResourceLoaderOptions;
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
    if (existing) {
      await applyRequestedSessionOptions(existing, input);
      return existing;
    }

    // AuthStorage.create() reads env vars (ANTHROPIC_API_KEY etc.) + ~/.pi/agent/auth.json.
    // AuthStorage.inMemory() would not pick up credentials.
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    registerConfiguredModelProviders(modelRegistry);

    const resolvedModel = resolveRequestedModel(modelRegistry, input);
    // Default: sonnet for anthropic if nothing resolved, preventing pi from
    // falling back to openai-codex when only ANTHROPIC_API_KEY is set.
    const model = resolvedModel ?? resolveDefaultModel(modelRegistry);

    // Hosts may extend pi's base prompt and/or isolate resource discovery.
    // We keep pi's default system prompt, but can disable ambient AGENTS.md
    // and global skill discovery while injecting explicit local skill paths.
    const resourceLoader =
      opts.systemPromptAppend ||
      opts.resourceLoaderOptions?.noContextFiles ||
      opts.resourceLoaderOptions?.noSkills ||
      (opts.resourceLoaderOptions?.additionalSkillPaths?.length ?? 0) > 0 ||
      (opts.resourceLoaderOptions?.piPackages?.length ?? 0) > 0
        ? (() => {
            const agentDir = getAgentDir()
            const additionalSkillPaths =
              opts.resourceLoaderOptions?.additionalSkillPaths ?? []
            const piPackages = opts.resourceLoaderOptions?.piPackages ?? []
            const settingsManager = createResourceSettingsManager(
              ctx.workdir,
              agentDir,
              piPackages,
            )
            return new DefaultResourceLoader({
              cwd: ctx.workdir,
              agentDir,
              settingsManager,
              ...(opts.systemPromptAppend
                ? { appendSystemPrompt: [opts.systemPromptAppend] }
                : {}),
              ...(opts.resourceLoaderOptions?.noContextFiles
                ? { noContextFiles: true }
                : {}),
              ...(opts.resourceLoaderOptions?.noSkills ? { noSkills: true } : {}),
              ...(additionalSkillPaths.length
                ? { additionalSkillPaths }
                : {}),
              ...(opts.resourceLoaderOptions?.noSkills || additionalSkillPaths.length
                ? {
                    skillsOverride: () =>
                      loadSkills({
                        cwd: ctx.workdir,
                        agentDir,
                        skillPaths: additionalSkillPaths,
                        includeDefaults: false,
                      }),
                  }
                : {}),
            })
          })()
        : undefined;

    await resourceLoader?.reload()

    const { session: piSession } = await createAgentSession({
      cwd: ctx.workdir,
      tools: [],
      customTools: adaptToolsForPi(opts.tools),
      model,
      thinkingLevel: input.thinkingLevel ?? "off",
      sessionManager: SessionManager.inMemory(),
      authStorage,
      modelRegistry,
      ...(resourceLoader ? { resourceLoader } : {}),
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

    /**
     * Pi exposes the resolved system prompt as a getter on AgentSession.
     * Sessions are created lazily on first sendMessage, so callers may see
     * `undefined` for a session that hasn't been written to yet — that's
     * the expected pre-first-turn state, not an error.
     */
    getSystemPrompt(sessionId: string): string | undefined {
      return piSessions.get(sessionId)?.piSession.systemPrompt;
    },

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
      const textStartSeen = new Set<number>();
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

      // pi sometimes emits multiple `message_start` events for the same
      // logical assistant message (e.g. when a turn includes a tool call
      // followed by a final text response — pi treats those as separate
      // sub-messages but reuses the same id). The AI SDK on the client
      // keys messages by id; duplicate `start` chunks with the same id
      // confuse `replaceMessage` and produce React duplicate-key warnings
      // + `activeResponse undefined` errors that break tool-part rendering.
      // Dedupe at the chunk-emission seam: emit each `start` messageId
      // at most once per turn.
      const startedMessageIds = new Set<string>()
      function dedupStartChunks(input: UIMessageChunk[]): UIMessageChunk[] {
        const out: UIMessageChunk[] = []
        for (const c of input) {
          const rec = c as unknown as { type?: string; messageId?: string }
          if (rec.type === "start") {
            const id = rec.messageId
            if (!id) {
              if (startedMessageIds.has("__anonymous__")) continue
              startedMessageIds.add("__anonymous__")
            } else {
              if (startedMessageIds.has(id)) continue
              startedMessageIds.add(id)
            }
          }
          out.push(c)
        }
        return out
      }

      let sawTextChunk = false;
      const unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
        if (event.type === "message_update") {
          const ame = event.assistantMessageEvent;
          if (ame.type === "text_start") {
            textStartSeen.add(ame.contentIndex);
          }
          if (ame.type === "text_delta") {
            textDeltaSeen.add(ame.contentIndex);
            assistantText += ame.delta;
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

        let converted = dedupStartChunks(piEventToChunks(event));
        if (event.type === "message_update") {
          const ame = event.assistantMessageEvent;
          if (
            ame.type === "text_end"
            && typeof ame.content === "string"
            && ame.content.length > 0
            && !textDeltaSeen.has(ame.contentIndex)
          ) {
            const id = String(ame.contentIndex);
            converted = [
              ...(textStartSeen.has(ame.contentIndex)
                ? []
                : [{ type: "text-start", id } as UIMessageChunk]),
              { type: "text-delta", id, delta: ame.content } as UIMessageChunk,
              ...converted,
            ];
            textDeltaSeen.add(ame.contentIndex);
            assistantText += ame.content;
          }
        }
        for (const chunk of converted) {
          const t = (chunk as { type?: string }).type;
          if (t === "text-delta") {
            sawTextChunk = true;
          }
        }
        chunks.push(...converted);

        // Some model/provider paths emit only final message snapshots (no
        // message_update deltas). Synthesize text chunks so SSE consumers still
        // receive assistant text.
        if (event.type === "message_end" && !sawTextChunk) {
          const { role, text, errorText } = extractAssistantMessageText(
            (event as unknown as { message?: unknown }).message,
          );
          if (role === "assistant" && errorText.length > 0) {
            chunks.push({ type: "error", errorText } as UIMessageChunk);
            sawTextChunk = true;
          } else if (role === "assistant" && text.length > 0) {
            chunks.push(
              { type: "text-start", id: "0" } as UIMessageChunk,
              { type: "text-delta", id: "0", delta: text } as UIMessageChunk,
              { type: "text-end", id: "0" } as UIMessageChunk,
            );
            sawTextChunk = true;
            assistantText += text;
          }
        }

        if (event.type === "agent_end") {
          if (!sawTextChunk) {
            const { role, text, errorText } = extractAssistantMessageText(
              findLastAssistantMessage(
                (event as unknown as { messages?: unknown }).messages,
              ),
            );
            if (role === "assistant" && errorText.length > 0) {
              chunks.push({ type: "error", errorText } as UIMessageChunk);
              sawTextChunk = true;
            } else if (role === "assistant" && text.length > 0) {
              chunks.push(
                { type: "text-start", id: "0" } as UIMessageChunk,
                { type: "text-delta", id: "0", delta: text } as UIMessageChunk,
                { type: "text-end", id: "0" } as UIMessageChunk,
              );
              sawTextChunk = true;
              assistantText += text;
            }
          }
          done = true;
          stopHeartbeat();
        }
        if (wake) wake();
      });

      // pi's prompt() resolves only at agent_end. Awaiting it here would
      // block this generator from yielding until the entire turn completes,
      // collapsing the response into a single end-of-turn flush. Kick it
      // off concurrently and drain `chunks` as the subscriber fills it.
      let promptSettled = false;
      const promptPromise = piSession
        .prompt(input.message)
        .then(() => {
          promptSettled = true;
        })
        .catch((err) => {
          promptSettled = true;
          streamError = err;
          done = true;
          stopHeartbeat();
          if (wake) wake();
        });

      const onAbort = () => {
        // While prompt() is still running, treat abort as a graceful stop:
        // we'll signal pi via piSession.abort(), let the child exit, and
        // exit the generator cleanly. Only surface "Aborted" as an error
        // when the turn already completed — that's an unexpected late abort.
        if (promptSettled) {
          streamError = new Error("Aborted");
        }
        done = true;
        stopHeartbeat();
        piSession.abort().catch(() => {});
        if (wake) wake();
      };
      ctx.abortSignal.addEventListener("abort", onAbort, { once: true });

      try {
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
        // Surface any pending rejection from prompt() and ensure the
        // promise settles so unhandled-rejection warnings don't leak.
        await promptPromise;
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

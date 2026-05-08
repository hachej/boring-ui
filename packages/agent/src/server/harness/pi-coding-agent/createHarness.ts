import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  type PromptOptions,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SettingsManager,
  getAgentDir,
  loadSkills,
} from "@mariozechner/pi-coding-agent";
import type { AgentHarness, SendMessageInput, RunContext, MessageAttachment } from "../../../shared/harness.js";
import { createLogger } from "../../logging.js";
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
  sessionManager: SessionManager;
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


function extractUserMessageText(message: unknown): string {
  const record = message as { role?: unknown; content?: unknown } | null;
  if (record?.role !== "user") return "";
  if (typeof record.content === "string") return record.content;
  if (!Array.isArray(record.content)) return "";
  return record.content
    .map((part) => {
      const p = part as { type?: unknown; text?: unknown };
      return p.type === "text" && typeof p.text === "string" ? p.text : "";
    })
    .join("");
}

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
  if (!input.model || !requestedId) return undefined;
  const model = modelRegistry.find(input.model.provider, requestedId);
  if (!model) return undefined;
  // Only return the model if the provider actually has credentials — otherwise
  // fall through to resolveDefaultModel so a stale localStorage selection
  // (e.g. openai-codex/gpt-5.1 with no API key) doesn't break the chat.
  const available = modelRegistry.getAvailable();
  const hasAuth = available.some(
    (m) => m.provider === model.provider && m.id === model.id,
  );
  return hasAuth ? model : undefined;
}

function resolveDefaultModel(modelRegistry: ModelRegistry) {
  const configured = readConfiguredDefaultModel();
  if (configured) {
    const model = modelRegistry.find(configured.provider, configured.id);
    if (model) return model;
  }
  return undefined;
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

const log = createLogger("pi-harness");
const DEFAULT_ATTACHMENT_DIR = "assets/images";

function extForAttachment(filename: string, contentType: string): string {
  const fromName = extname(filename).toLowerCase().replace(/^\./, "");
  if (/^[a-z0-9]{1,12}$/.test(fromName)) return fromName;
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/svg+xml") return "svg";
  return "bin";
}

function basenameForAttachment(filename: string): string {
  const base = filename.split("/").pop()?.split("\\").pop() ?? "image";
  const withoutExt = base.replace(/\.[^.]*$/, "");
  const safe = withoutExt
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return safe || "image";
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

    // Restore file-backed pi session so the agent remembers the conversation
    // across server restarts. On first turn, create a new file-backed session
    // and persist its path. On subsequent restarts, open the existing file.
    // Synchronous read keeps this function free of async I/O before
    // createAgentSession (required for test-timer compatibility).
    const sessionCtx = { workspaceId: "default" };
    const savedPiFile = sessionStore.loadPiSessionFileSync(sessionId);
    let sessionManager: SessionManager;
    let isNewPiSession = false;
    if (savedPiFile) {
      try {
        sessionManager = SessionManager.open(savedPiFile, undefined, ctx.workdir);
      } catch {
        sessionManager = SessionManager.create(ctx.workdir);
        isNewPiSession = true;
      }
    } else {
      sessionManager = SessionManager.create(ctx.workdir);
      isNewPiSession = true;
    }

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
      sessionManager,
      authStorage,
      modelRegistry,
      ...(resourceLoader ? { resourceLoader } : {}),
    });

    if (isNewPiSession) {
      const piFile = sessionManager.getSessionFile();
      if (piFile) {
        sessionStore.savePiSessionFile(sessionCtx, sessionId, piFile).catch(() => {});
      }
    }

    const handle: PiSessionHandle = { piSession, modelRegistry, sessionManager };
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

  const nativeFollowUpPending = new Set<string>();

  return {
    id: "pi-coding-agent",
    placement: "server",
    sessions: sessionStore,

    async followUp(sessionId: string, text: string, _attachments?: MessageAttachment[], _displayText = text): Promise<void> {
      const handle = piSessions.get(sessionId);
      if (!handle) return;
      nativeFollowUpPending.add(sessionId);
      await handle.piSession.followUp(text);
    },

    clearFollowUp(_sessionId: string): void {
      // pi owns the follow-up queue. There is no public clear API; Stop aborts
      // the active session, which prevents queued work from continuing.
    },

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

      // Do NOT clear the follow-up queue here. The browser can submit a
      // follow-up while the first request is still in AI SDK `submitted` state,
      // before this generator reaches its setup path. Clearing here races that
      // legitimate POST and makes the queued message disappear. Stale queues are
      // cleared explicitly through clearFollowUp() on the Stop path.

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
      let inlineTurnIndex = 0;
      let currentPiAssistantMessageId: string | null = null;
      let piSeq = 0;
      const nextPiSeq = () => ++piSeq;

      function namespaceInlinePartIds(input: UIMessageChunk[]): UIMessageChunk[] {
        if (inlineTurnIndex === 0) return input;
        return input.map((chunk) => {
          const rec = chunk as unknown as { type?: string; id?: string };
          if (
            (rec.type === "text-start" || rec.type === "text-delta" || rec.type === "text-end" ||
              rec.type === "reasoning-start" || rec.type === "reasoning-delta" || rec.type === "reasoning-end") &&
            typeof rec.id === "string"
          ) {
            return { ...rec, id: `turn-${inlineTurnIndex}:${rec.id}` } as unknown as UIMessageChunk;
          }
          return chunk;
        });
      }

      // promptPromise tracks the active pi run. Native pi follow-up queuing
      // keeps this promise open until queued follow-ups finish.
      // finally block can await full settlement before cleanup.
      let promptSettled = false;
      let promptPromise: Promise<void> = Promise.resolve();

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

        let converted: UIMessageChunk[];
        const piHistoryChunks: UIMessageChunk[] = [];
        const eventMessage = (event as unknown as { message?: { id?: unknown; role?: unknown } }).message;
        if (event.type === "message_start" && (eventMessage?.role === "user" || eventMessage?.role === "assistant")) {
          const messageId = typeof eventMessage.id === "string" ? eventMessage.id : `${eventMessage.role}-${Date.now()}`;
          const role = eventMessage.role;
          if (role === "assistant") currentPiAssistantMessageId = messageId;
          const text = role === "user" ? extractUserMessageText(eventMessage) : undefined;
          if ((role === "user" && text && text !== input.message) || (role === "assistant" && inlineTurnIndex > 0)) {
            piHistoryChunks.push({
              type: "data-pi-message-start",
              data: { seq: nextPiSeq(), messageId, role, ...(text ? { text } : {}) },
            } as unknown as UIMessageChunk);
          }
        }
        if (event.type === "message_update") {
          const ame = event.assistantMessageEvent;
          const messageId = typeof (event as unknown as { messageId?: unknown }).messageId === "string"
            ? (event as unknown as { messageId: string }).messageId
            : typeof (event as unknown as { message?: { id?: unknown } }).message?.id === "string"
              ? (event as unknown as { message: { id: string } }).message.id
              : currentPiAssistantMessageId ?? "assistant-streaming";
          if (inlineTurnIndex > 0) {
            if (ame.type === "text_start") {
              piHistoryChunks.push({
                type: "data-pi-text-start",
                data: { seq: nextPiSeq(), messageId, partId: String(ame.contentIndex) },
              } as unknown as UIMessageChunk);
            } else if (ame.type === "text_delta" && ame.delta) {
              const seq = nextPiSeq();
              piHistoryChunks.push(
                {
                  type: "data-pi-text-delta",
                  data: { seq, messageId, partId: String(ame.contentIndex), delta: ame.delta },
                } as unknown as UIMessageChunk,
                // Back-compat for the current client projection. Remove once
                // ChatPanel consumes the stable data-pi-text-* DTOs directly.
                {
                  type: "data-pi-message-delta",
                  data: { seq, messageId, role: "assistant", delta: ame.delta },
                } as unknown as UIMessageChunk,
              );
            } else if (ame.type === "text_end") {
              piHistoryChunks.push({
                type: "data-pi-text-end",
                data: { seq: nextPiSeq(), messageId, partId: String(ame.contentIndex), ...(typeof ame.content === "string" ? { text: ame.content } : {}) },
              } as unknown as UIMessageChunk);
            } else if (ame.type === "thinking_start") {
              piHistoryChunks.push({
                type: "data-pi-reasoning-start",
                data: { seq: nextPiSeq(), messageId, partId: String(ame.contentIndex) },
              } as unknown as UIMessageChunk);
            } else if (ame.type === "thinking_delta") {
              piHistoryChunks.push({
                type: "data-pi-reasoning-delta",
                data: { seq: nextPiSeq(), messageId, partId: String(ame.contentIndex), delta: ame.delta },
              } as unknown as UIMessageChunk);
            } else if (ame.type === "thinking_end") {
              piHistoryChunks.push({
                type: "data-pi-reasoning-end",
                data: { seq: nextPiSeq(), messageId, partId: String(ame.contentIndex) },
              } as unknown as UIMessageChunk);
            } else if (ame.type === "toolcall_end") {
              piHistoryChunks.push({
                type: "data-pi-tool-call-end",
                data: { seq: nextPiSeq(), messageId, toolCallId: ame.toolCall.id, toolName: ame.toolCall.name, input: ame.toolCall.arguments },
              } as unknown as UIMessageChunk);
            }
          }
        }
        if (event.type === "message_end" && (eventMessage?.role === "user" || (eventMessage?.role === "assistant" && inlineTurnIndex > 0))) {
          const messageId = typeof eventMessage.id === "string" ? eventMessage.id : `${eventMessage.role}-${Date.now()}`;
          const role = eventMessage.role;
          const text = role === "user"
            ? extractUserMessageText(eventMessage)
            : extractAssistantMessageText(eventMessage).text;
          piHistoryChunks.push({
            type: "data-pi-message-end",
            data: { seq: nextPiSeq(), messageId, role, ...(text ? { text } : {}) },
          } as unknown as UIMessageChunk);
        }

        if (inlineTurnIndex > 0 && event.type === "tool_execution_end" && currentPiAssistantMessageId) {
          piHistoryChunks.push({
            type: "data-pi-tool-result",
            data: { seq: nextPiSeq(), messageId: currentPiAssistantMessageId, toolCallId: event.toolCallId, output: event.result, isError: event.isError },
          } as unknown as UIMessageChunk);
        }

        if (event.type === "message_start" && (event as any).message?.role === "user") {
          const text = extractUserMessageText((event as any).message);
          converted = text && text !== input.message
            ? [{ type: "data-followup-consumed", data: { text } } as unknown as UIMessageChunk, ...piHistoryChunks]
            : piHistoryChunks;
          if (text && text !== input.message) {
            inlineTurnIndex += 1;
            nativeFollowUpPending.delete(input.sessionId);
          }
        } else if (event.type === "message_end" && (event as any).message?.role === "user") {
          converted = piHistoryChunks;
        } else {
          const sdkChunks = namespaceInlinePartIds(dedupStartChunks(piEventToChunks(event)));
          const sdkChunksForTurn = inlineTurnIndex > 0
            ? sdkChunks.filter((chunk) => {
                const t = (chunk as { type?: string }).type;
                return t !== "text-start" && t !== "text-delta" && t !== "text-end"
                  && t !== "reasoning-start" && t !== "reasoning-delta" && t !== "reasoning-end";
              })
            : sdkChunks;
          converted = [...piHistoryChunks, ...sdkChunksForTurn];
        }
        if (event.type === "message_update") {
          const ame = event.assistantMessageEvent;
          if (
            ame.type === "text_end"
            && typeof ame.content === "string"
            && ame.content.length > 0
            && !textDeltaSeen.has(ame.contentIndex)
          ) {
            const id = inlineTurnIndex === 0 ? String(ame.contentIndex) : `turn-${inlineTurnIndex}:${ame.contentIndex}`;
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
        if (event.type === "message_end" && !sawTextChunk && inlineTurnIndex === 0) {
          const { role, text, errorText } = extractAssistantMessageText(
            (event as unknown as { message?: unknown }).message,
          );
          if (role === "assistant" && errorText.length > 0) {
            chunks.push({ type: "error", errorText } as UIMessageChunk);
            sawTextChunk = true;
          } else if (role === "assistant" && text.length > 0) {
            const id = inlineTurnIndex === 0 ? "0" : `turn-${inlineTurnIndex}:0`;
            chunks.push(
              { type: "text-start", id } as UIMessageChunk,
              { type: "text-delta", id, delta: text } as UIMessageChunk,
              { type: "text-end", id } as UIMessageChunk,
            );
            sawTextChunk = true;
            assistantText += text;
          }
        }

        if (event.type === "agent_end") {
          if (!sawTextChunk && inlineTurnIndex === 0) {
            const { role, text, errorText } = extractAssistantMessageText(
              findLastAssistantMessage(
                (event as unknown as { messages?: unknown }).messages,
              ),
            );
            if (role === "assistant" && errorText.length > 0) {
              chunks.push({ type: "error", errorText } as UIMessageChunk);
              sawTextChunk = true;
            } else if (role === "assistant" && text.length > 0) {
              const id = inlineTurnIndex === 0 ? "0" : `turn-${inlineTurnIndex}:0`;
              chunks.push(
                { type: "text-start", id } as UIMessageChunk,
                { type: "text-delta", id, delta: text } as UIMessageChunk,
                { type: "text-end", id } as UIMessageChunk,
              );
              sawTextChunk = true;
              assistantText += text;
            }
          }

          if (nativeFollowUpPending.has(input.sessionId) && !ctx.abortSignal.aborted) {
            // Pi native follow-up was queued but its user message has not been
            // emitted yet. Keep this HTTP stream open; the queued user
            // message_start will clear the pending flag and produce the
            // data-followup-consumed marker, followed by the next assistant.
          } else {
            done = true;
            stopHeartbeat();
          }
        }
        if (wake) wake();
      });

      // pi's prompt() resolves only at agent_end. Awaiting it here would
      // block this generator from yielding until the entire turn completes,
      // collapsing the response into a single end-of-turn flush. Kick it
      // off concurrently and drain `chunks` as the subscriber fills it.
      //
      // Native pi follow-up queuing keeps prompt() alive until queued follow-up
      // turns complete, so there is no harness-side second prompt chain.
      async function prepareTurn(message: string, attachments?: MessageAttachment[]): Promise<{ message: string; promptOpts?: PromptOptions }> {
        // Process image attachments: pass as vision AND write to workspace.
        const initialImages: NonNullable<PromptOptions["images"]> = [];
        const savedPaths: string[] = [];
        const writeErrors: string[] = [];
        for (const a of attachments ?? []) {
          const match = a.url.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (!match) continue;
          const [, contentType, b64] = match;
          initialImages.push({ type: "image", mimeType: contentType, data: b64 });
          if (!ctx.workdir) {
            writeErrors.push(`${a.filename ?? "image"}: no workdir`);
            continue;
          }
          try {
            const bytes = Buffer.from(b64, "base64");
            const ext = extForAttachment(a.filename ?? "image", contentType);
            const base = basenameForAttachment(a.filename ?? "image");
            const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            const relPath = `${DEFAULT_ATTACHMENT_DIR}/${base}-${unique}.${ext}`;
            await mkdir(join(ctx.workdir, DEFAULT_ATTACHMENT_DIR), { recursive: true });
            await writeFile(join(ctx.workdir, relPath), bytes);
            savedPaths.push(relPath);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error("attachment write failed", { workdir: ctx.workdir, error: msg });
            writeErrors.push(`${a.filename ?? "image"}: ${msg}`);
          }
        }
        const attachmentNotes: string[] = [];
        if (savedPaths.length > 0) {
          attachmentNotes.push(`[Attached file(s) saved to workspace:\n${savedPaths.map((p) => `- ${p}`).join("\n")}]`);
        }
        if (writeErrors.length > 0) {
          attachmentNotes.push(`[Warning: failed to save attachment(s) to workspace — ${writeErrors.join("; ")}. The image is available via vision only.]`);
        }
        return {
          message: attachmentNotes.length > 0 ? `${message}\n\n${attachmentNotes.join("\n")}` : message,
          promptOpts: initialImages.length > 0 ? { images: initialImages } : undefined,
        };
      }

      async function startTurn(message: string, attachments?: MessageAttachment[]): Promise<void> {
        promptSettled = false;
        const prepared = await prepareTurn(message, attachments);
        return piSession
          .prompt(prepared.message, prepared.promptOpts)
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
      }
      promptPromise = startTurn(input.message, input.attachments);

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

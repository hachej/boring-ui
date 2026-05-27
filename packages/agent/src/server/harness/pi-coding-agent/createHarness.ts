import { existsSync, readFileSync } from "node:fs";
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
  type ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import type { AgentHarness, SendMessageInput, RunContext, MessageAttachment, FollowUpOptions } from "../../../shared/harness.js";
import { createLogger } from "../../logging.js";
import type { AgentTool } from "../../../shared/tool.js";
import type { TelemetrySink } from "../../../shared/telemetry.js";
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

interface NativeFollowUpRequest {
  text: string;
  displayText: string;
  clientNonce?: string;
  clientSeq?: number;
}

interface NativeFollowUpRemoval {
  request: NativeFollowUpRequest;
  textOrdinal: number;
}

export { mergePiPackageSources } from "../../piPackages.js";
export type { PiPackageSource } from "../../piPackages.js";

/**
 * Pi's base system prompt ends with `Current working directory: <abs path>`.
 * The model frequently misreads that as "you may pass this absolute path as
 * a tool argument," then trips the workspace-sandbox bounds check (e.g.
 * `find` with `path: "/home/ubuntu/.../workspace"` returns "path is outside
 * workspace" because the resolver compares against a parent directory).
 *
 * This addendum tells the model exactly how to interpret the cwd line and
 * how to call find/read/edit/write without burning a roundtrip on a bound-
 * check rejection.
 */
const WORKSPACE_PATHS_GUIDELINE = [
  "## Workspace paths",
  "",
  "- The \"Current working directory\" above is the workspace root. Tool path arguments must be relative to it (e.g. `README.md`, `src/foo.ts`).",
  "- Never pass an absolute path or a path that walks outside the workspace (no leading `/`, no `..` that escapes the root). The sandbox will reject it and the call is wasted.",
  "- For `find`/`grep`/`ls`: omit the `path` argument to search from the workspace root. Pass `path` only when you need to restrict to a subdirectory, and only as a workspace-relative path.",
  "- For `read`/`edit`/`write`: pass workspace-relative paths only.",
].join("\n");

function composeSystemPromptAppend(hostAppend: string | undefined): string {
  return [WORKSPACE_PATHS_GUIDELINE, hostAppend?.trim()].filter(Boolean).join("\n\n");
}

export interface PiHarnessOptions {
  noContextFiles?: boolean;
  noSkills?: boolean;
  additionalSkillPaths?: string[];
  /**
   * Additional native Pi package sources to enable for this agent runtime.
   * These are applied as in-memory SettingsManager overrides, so host/plugin
   * declarations do not mutate .pi/settings.json.
   */
  packages?: PiPackageSource[];
  /**
   * Additional native pi extension entrypoints. Pi loads these through jiti and
   * re-imports them on ctx.reload(), which is required for hot-reloadable
   * boring agent plugins.
   */
  extensionPaths?: string[];
  /** In-process host extensions. Use only for trusted built-ins; hot plugin code should use paths. */
  extensionFactories?: ExtensionFactory[];
  /**
   * Optional source of hot-reloadable Pi resources. Pi calls it on every
   * reloadSession() (and once at session build) and merges the result with
   * the static fields above. Lets the workspace plugin layer refresh
   * package.json-discovered skills/packages/extensions without mutating
   * arrays that the harness already captured.
   */
  getHotReloadableResources?: () => HotReloadablePiResources;
}

export interface HotReloadablePiResources {
  additionalSkillPaths?: string[];
  packages?: PiPackageSource[];
  extensionPaths?: string[];
}

export type PiExtensionFactory = ExtensionFactory;

function buildDynamicPromptExtension(
  source: () => string | undefined | Promise<string | undefined>,
): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", async (event) => {
      const extra = (await source())?.trim()
      if (!extra) return
      return { systemPrompt: `${event.systemPrompt}\n\n${extra}` }
    })
  }
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

function extractAssistantReasoningTexts(message: unknown): string[] {
  const content = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    const item = part as { type?: unknown; thinking?: unknown; text?: unknown; content?: unknown };
    if (item.type !== "thinking" && item.type !== "reasoning") return [];
    const text = item.thinking ?? item.text ?? item.content;
    return typeof text === "string" && text.length > 0 ? [text] : [];
  });
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

function readSettingsFileIfPresent(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
}

function mergeInjectedProjectPackages(
  settingsJson: string | undefined,
  piPackages: PiPackageSource[],
): string {
  const settings = settingsJson ? JSON.parse(settingsJson) : {};
  const configuredPackages = Array.isArray(settings.packages)
    ? settings.packages
    : [];
  return JSON.stringify({
    ...settings,
    packages: mergePiPackageSources(configuredPackages, piPackages),
  });
}

export function createResourceSettingsManager(
  cwd: string,
  agentDir: string,
  piPackages: PiPackageSource[],
): SettingsManager {
  if (piPackages.length === 0) return SettingsManager.create(cwd, agentDir);

  const globalSettingsPath = join(agentDir, "settings.json");
  const projectSettingsPath = join(cwd, ".pi", "settings.json");
  let globalSettingsOverrideJson: string | undefined;
  let projectSettingsOverrideJson: string | undefined;

  // Host-declared Pi packages are an in-memory project overlay. Normal reads
  // still come from Pi's real settings files so `resourceLoader.reload()` sees
  // user edits to workspace/.pi/settings.json; writes performed through this
  // SettingsManager stay in-memory and do not mutate host/project files.
  const storage: Parameters<typeof SettingsManager.fromStorage>[0] = {
    withLock(scope, fn) {
      if (scope === "global") {
        const current = globalSettingsOverrideJson ?? readSettingsFileIfPresent(globalSettingsPath);
        const next = fn(current);
        if (next !== undefined) globalSettingsOverrideJson = next;
        return;
      }

      const current = projectSettingsOverrideJson
        ?? mergeInjectedProjectPackages(readSettingsFileIfPresent(projectSettingsPath), piPackages);
      const next = fn(current);
      if (next !== undefined) projectSettingsOverrideJson = next;
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
  /**
   * Dynamic system-prompt source. Read on every before_agent_start, so live
   * plugin reloads land in the next agent turn without re-creating the harness.
   */
  systemPromptDynamic?: () => string | undefined | Promise<string | undefined>;
  /** Optional pi adapter/runtime knobs. */
  pi?: PiHarnessOptions;
  /** Optional stable namespace for file-backed session storage. */
  sessionNamespace?: string;
  /** Optional explicit file-backed session directory. Mostly for tests/hosts. */
  sessionDir?: string;
  /** Optional best-effort telemetry sink supplied by an embedding host. */
  telemetry?: TelemetrySink;
}): AgentHarness {
  const sessionStore = new PiSessionStore(opts.cwd, {
    sessionNamespace: opts.sessionNamespace,
    sessionDir: opts.sessionDir,
  });
  const piSessions = new Map<string, PiSessionHandle>();

  // Effective Pi resources merge static caller-supplied fields with
  // getHotReloadableResources() output. Pi's DefaultResourceLoader keeps the
  // array references it was constructed with and re-reads them on
  // piSession.reload(), so we mutate via splice instead of replacing.
  const effectiveSkillPaths: string[] = []
  const effectivePackages: PiPackageSource[] = []
  const effectiveExtensionPaths: string[] = []
  const refreshEffectiveResources = (): void => {
    const dynamic = opts.pi?.getHotReloadableResources?.() ?? {}
    effectiveSkillPaths.splice(
      0,
      effectiveSkillPaths.length,
      ...(opts.pi?.additionalSkillPaths ?? []),
      ...(dynamic.additionalSkillPaths ?? []),
    )
    effectivePackages.splice(
      0,
      effectivePackages.length,
      ...mergePiPackageSources(opts.pi?.packages ?? [], dynamic.packages ?? []),
    )
    effectiveExtensionPaths.splice(
      0,
      effectiveExtensionPaths.length,
      ...(opts.pi?.extensionPaths ?? []),
      ...(dynamic.extensionPaths ?? []),
    )
  }
  refreshEffectiveResources()
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

    // Auth/model credentials are Pi-owned. AuthStorage.create() lets Pi read
    // its normal environment/settings/auth sources; Boring does not pick a
    // provider credential itself.
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
    // Prefer an explicit available UI selection; otherwise use configured
    // Boring/Pi default if present. Undefined is intentional: Pi/session owns
    // the final fallback model selection.
    const model = resolvedModel ?? resolveDefaultModel(modelRegistry);

    // Hosts may extend pi's base prompt and/or isolate resource discovery.
    // We keep pi's default system prompt but always tack on a workspace-paths
    // guideline (relative-paths only) on top of whatever the host supplied —
    // pi's cwd line otherwise lures the model into passing absolute paths
    // that fail the workspace bounds check. Hosts can also disable ambient
    // AGENTS.md / global skill discovery while injecting explicit skill paths,
    // packages, hot-reloadable extension entrypoints, and dynamic plugin
    // prompt/resources.
    refreshEffectiveResources()
    const composedSystemPromptAppend = composeSystemPromptAppend(opts.systemPromptAppend)
    const dynamicPromptExtension = opts.systemPromptDynamic
      ? buildDynamicPromptExtension(opts.systemPromptDynamic)
      : undefined
    const agentDir = getAgentDir()
    const extensionFactories = [
      ...(dynamicPromptExtension ? [dynamicPromptExtension] : []),
      ...(opts.pi?.extensionFactories ?? []),
    ]
    const settingsManager = createResourceSettingsManager(
      ctx.workdir,
      agentDir,
      effectivePackages,
    )
    const resourceLoader = new DefaultResourceLoader({
      cwd: ctx.workdir,
      agentDir,
      settingsManager,
      appendSystemPromptOverride: (base: string[]) => [...base, composedSystemPromptAppend],
      ...(effectiveExtensionPaths.length ? { additionalExtensionPaths: effectiveExtensionPaths } : {}),
      ...(extensionFactories.length ? { extensionFactories } : {}),
      ...(opts.pi?.noContextFiles ? { noContextFiles: true } : {}),
      ...(opts.pi?.noSkills ? { noSkills: true } : {}),
      ...(effectiveSkillPaths.length ? { additionalSkillPaths: effectiveSkillPaths } : {}),
      // skillsOverride REPLACES Pi's resolved skill set, which includes
      // skills contributed by host-declared pi packages (e.g.
      // @hachej/boring-pi → boring-plugin-authoring). Only trigger it for
      // the explicit `noSkills` opt-out, where the host wants a clean slate.
      // Passing additionalSkillPaths is not, by itself, a request to throw
      // away package skills — those should keep flowing through Pi's loader
      // and merge with the additional paths.
      ...(opts.pi?.noSkills
        ? {
            skillsOverride: () =>
              loadSkills({
                cwd: ctx.workdir,
                agentDir,
                skillPaths: effectiveSkillPaths,
                includeDefaults: false,
              }),
          }
        : {}),
    })

    await resourceLoader?.reload()

    const { session: piSession } = await createAgentSession({
      cwd: ctx.workdir,
      // Suppress Pi's built-in filesystem/shell tools while keeping Boring's
      // adapted tool catalog active. Passing `tools: []` is an allowlist of
      // zero tools in Pi v0.75+, which disables customTools too.
      noTools: "builtin",
      customTools: adaptToolsForPi(opts.tools, input.sessionId, opts.telemetry),
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

  async function reloadPiSession(sessionId: string): Promise<boolean> {
    const handle = piSessions.get(sessionId);
    if (!handle) return false;
    refreshEffectiveResources();
    await handle.piSession.reload();
    return true;
  }

  function disposePiSession(sessionId: string): void {
    const handle = piSessions.get(sessionId);
    if (!handle) return;
    handle.piSession.dispose();
    piSessions.delete(sessionId);
    clearNativeFollowUpWork(sessionId);
  }

  const originalDelete = sessionStore.delete.bind(sessionStore);
  sessionStore.delete = async (ctx, sessionId) => {
    await originalDelete(ctx, sessionId);
    disposePiSession(sessionId);
  };

  const nativeFollowUpPending = new Set<string>();
  const nativeFollowUpQueues = new Map<string, NativeFollowUpRequest[]>();

  function clearNativeFollowUpWork(sessionId: string): void {
    nativeFollowUpPending.delete(sessionId);
    nativeFollowUpQueues.delete(sessionId);
  }

  function userMessageText(message: unknown): string {
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => ((part as { type?: unknown; text?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string") ? (part as { text: string }).text : "")
      .join("");
  }

  function removeFirstMatchingOrdinal<T>(items: T[], matches: (item: T) => boolean, ordinal: number): void {
    let seen = 0;
    const index = items.findIndex((item) => {
      if (!matches(item)) return false;
      if (seen++ !== ordinal) return false;
      return true;
    });
    if (index >= 0) items.splice(index, 1);
  }

  function removePiQueuedFollowUp(piSession: AgentSession, text?: string, textOrdinal = 0): void {
    const session = piSession as unknown as {
      _followUpMessages?: string[];
      _emitQueueUpdate?: () => void;
      agent?: {
        clearFollowUpQueue?: () => void;
        followUpQueue?: { messages?: unknown[] };
      };
    };
    if (!text) {
      session.agent?.clearFollowUpQueue?.();
      if (Array.isArray(session._followUpMessages)) session._followUpMessages = [];
      session._emitQueueUpdate?.();
      return;
    }
    const queuedMessages = session.agent?.followUpQueue?.messages;
    if (Array.isArray(queuedMessages)) {
      removeFirstMatchingOrdinal(queuedMessages, (message) => userMessageText(message) === text, textOrdinal);
    }
    if (Array.isArray(session._followUpMessages)) {
      removeFirstMatchingOrdinal(session._followUpMessages, (message) => message === text, textOrdinal);
    }
    session._emitQueueUpdate?.();
  }

  function hasFollowUpSelector(options?: FollowUpOptions): boolean {
    return Boolean(options?.clientNonce) || options?.clientSeq !== undefined;
  }

  function matchesFollowUpSelector(item: NativeFollowUpRequest, options?: FollowUpOptions): boolean {
    if (!hasFollowUpSelector(options)) return true;
    return Boolean(options?.clientNonce && item.clientNonce === options.clientNonce)
      || (options?.clientSeq !== undefined && item.clientSeq === options.clientSeq);
  }

  function removeNativeFollowUp(sessionId: string, options?: FollowUpOptions): NativeFollowUpRemoval[] {
    const queue = nativeFollowUpQueues.get(sessionId);
    if (!queue?.length) {
      if (!hasFollowUpSelector(options)) clearNativeFollowUpWork(sessionId);
      return [];
    }

    const removed: NativeFollowUpRemoval[] = [];
    const next: NativeFollowUpRequest[] = [];
    const textCounts = new Map<string, number>();
    for (const request of queue) {
      const textOrdinal = textCounts.get(request.text) ?? 0;
      textCounts.set(request.text, textOrdinal + 1);
      if (matchesFollowUpSelector(request, options)) removed.push({ request, textOrdinal });
      else next.push(request);
    }

    if (next.length > 0) nativeFollowUpQueues.set(sessionId, next);
    else clearNativeFollowUpWork(sessionId);
    return removed;
  }

  return {
    id: "pi-coding-agent",
    placement: "server",
    sessions: sessionStore,

    async followUp(sessionId: string, text: string, _attachments?: MessageAttachment[], displayText = text, options?: FollowUpOptions): Promise<void> {
      const handle = piSessions.get(sessionId);
      if (!handle) throw new Error("followup_session_not_ready");
      const queue = nativeFollowUpQueues.get(sessionId) ?? [];
      queue.push({
        text,
        displayText,
        clientNonce: options?.clientNonce,
        clientSeq: options?.clientSeq,
      });
      nativeFollowUpQueues.set(sessionId, queue);
      nativeFollowUpPending.add(sessionId);
      await handle.piSession.followUp(text);
    },

    clearFollowUp(sessionId: string, options?: FollowUpOptions): void {
      const handle = piSessions.get(sessionId);
      const removed = removeNativeFollowUp(sessionId, options);
      if (!handle) return;
      if (!options?.clientNonce && options?.clientSeq === undefined) {
        removePiQueuedFollowUp(handle.piSession);
        return;
      }
      for (const item of removed) removePiQueuedFollowUp(handle.piSession, item.request.text, item.textOrdinal);
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

    reloadSession: reloadPiSession,

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
      let pendingTerminalErrorChunks: UIMessageChunk[] = [];
      const messageIdsWithStreamedReasoning = new Set<string>();
      let piSeq = 0;
      const nextPiSeq = () => ++piSeq;

      const STANDARD_VISIBLE_CHUNK_TYPES = new Set([
        "text-start",
        "text-delta",
        "text-end",
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
        "tool-input-available",
        "tool-input-error",
        "tool-output-available",
        "tool-output-error",
      ]);
      const standardToolInputsSeen = new Set<string>();

      function isStandardVisibleChunk(chunk: UIMessageChunk): boolean {
        const type = (chunk as { type?: unknown }).type;
        return typeof type === "string" && STANDARD_VISIBLE_CHUNK_TYPES.has(type);
      }

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

      function filterSdkChunksForCurrentSegment(input: UIMessageChunk[]): UIMessageChunk[] {
        const out: UIMessageChunk[] = [];
        for (const chunk of input) {
          const rec = chunk as unknown as { type?: string; toolCallId?: string };
          if (inlineTurnIndex > 0 && isStandardVisibleChunk(chunk)) continue;

          if (rec.type === "tool-input-available" && rec.toolCallId) {
            standardToolInputsSeen.add(rec.toolCallId);
            out.push(chunk);
            continue;
          }

          if (
            (rec.type === "tool-output-available" || rec.type === "tool-output-error" || rec.type === "tool-output-denied") &&
            rec.toolCallId &&
            !standardToolInputsSeen.has(rec.toolCallId)
          ) {
            // pi can emit tool_execution_end without a prior assistant
            // toolcall_end in the canonical AI SDK stream. Suppress that
            // orphan output; the data-pi side channel still carries the tool
            // result for the pi projection/fallback path.
            continue;
          }

          out.push(chunk);
        }
        return out;
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
          if ((role === "user" && text) || role === "assistant") {
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
            messageIdsWithStreamedReasoning.add(messageId);
            piHistoryChunks.push({
              type: "data-pi-reasoning-start",
              data: { seq: nextPiSeq(), messageId, partId: String(ame.contentIndex) },
            } as unknown as UIMessageChunk);
          } else if (ame.type === "thinking_delta") {
            messageIdsWithStreamedReasoning.add(messageId);
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
        if (event.type === "message_end" && (eventMessage?.role === "user" || eventMessage?.role === "assistant")) {
          const role = eventMessage.role;
          const messageId = typeof eventMessage.id === "string"
            ? eventMessage.id
            : role === "assistant" && currentPiAssistantMessageId
              ? currentPiAssistantMessageId
              : `${role}-${Date.now()}`;
          const text = role === "user"
            ? extractUserMessageText(eventMessage)
            : extractAssistantMessageText(eventMessage).text;
          if (role === "assistant" && !messageIdsWithStreamedReasoning.has(messageId)) {
            for (const reasoningText of extractAssistantReasoningTexts(eventMessage)) {
              const partId = `reasoning-${nextPiSeq()}`;
              piHistoryChunks.push(
                { type: "data-pi-reasoning-start", data: { seq: nextPiSeq(), messageId, partId } } as unknown as UIMessageChunk,
                { type: "data-pi-reasoning-delta", data: { seq: nextPiSeq(), messageId, partId, delta: reasoningText } } as unknown as UIMessageChunk,
                { type: "data-pi-reasoning-end", data: { seq: nextPiSeq(), messageId, partId } } as unknown as UIMessageChunk,
              );
            }
          }
          piHistoryChunks.push({
            type: "data-pi-message-end",
            data: { seq: nextPiSeq(), messageId, role, ...(text ? { text } : {}) },
          } as unknown as UIMessageChunk);
        }

        if (event.type === "tool_execution_start" && currentPiAssistantMessageId) {
          piHistoryChunks.push({
            type: "data-pi-tool-call-end",
            data: { seq: nextPiSeq(), messageId: currentPiAssistantMessageId, toolCallId: event.toolCallId, toolName: event.toolName, input: event.args },
          } as unknown as UIMessageChunk);
        }

        if (event.type === "tool_execution_end" && currentPiAssistantMessageId) {
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
            sawTextChunk = false;
            currentPiAssistantMessageId = null;
            const queue = nativeFollowUpQueues.get(input.sessionId);
            if (queue?.length) {
              const index = queue.findIndex((item) => item.text === text || item.displayText === text);
              if (index >= 0) queue.splice(index, 1);
              else queue.shift();
              if (queue.length > 0) nativeFollowUpQueues.set(input.sessionId, queue);
              else clearNativeFollowUpWork(input.sessionId);
            } else {
              nativeFollowUpPending.delete(input.sessionId);
            }
          }
        } else if (event.type === "message_end" && (event as any).message?.role === "user") {
          converted = piHistoryChunks;
        } else {
          const sdkChunks = namespaceInlinePartIds(dedupStartChunks(piEventToChunks(event)));
          const shouldBufferTerminalError = event.type === "message_update"
            && (event as { assistantMessageEvent?: { type?: unknown } }).assistantMessageEvent?.type === "error";
          const visibleSdkChunks = shouldBufferTerminalError
            ? sdkChunks.filter((chunk) => {
                const type = (chunk as { type?: unknown }).type;
                if (type === "error" || type === "finish") {
                  pendingTerminalErrorChunks.push(chunk);
                  return false;
                }
                return true;
              })
            : sdkChunks;
          const sdkChunksForTurn = filterSdkChunksForCurrentSegment(visibleSdkChunks);
          converted = [...piHistoryChunks, ...sdkChunksForTurn];
        }
        for (const chunk of converted) {
          const t = (chunk as { type?: string }).type;
          if (t === "text-delta" || t === "data-pi-text-delta" || t === "data-pi-text-end") {
            sawTextChunk = true;
          }
          const piEndData = (chunk as { data?: { role?: unknown; text?: unknown } }).data;
          if (t === "data-pi-message-end" && piEndData?.role === "assistant" && typeof piEndData.text === "string" && piEndData.text.length > 0) {
            sawTextChunk = true;
          }
        }
        chunks.push(...converted);

        if (event.type === "agent_end") {
          const willRetry = Boolean((event as { willRetry?: boolean }).willRetry);
          if (willRetry) {
            pendingTerminalErrorChunks = [];
          } else if (pendingTerminalErrorChunks.length > 0) {
            chunks.push(...pendingTerminalErrorChunks);
            pendingTerminalErrorChunks = [];
            sawTextChunk = true;
          } else if (!sawTextChunk) {
            const { role, text, errorText } = extractAssistantMessageText(
              findLastAssistantMessage(
                (event as unknown as { messages?: unknown }).messages,
              ),
            );
            if (role === "assistant" && errorText.length > 0) {
              chunks.push({ type: "error", errorText } as UIMessageChunk);
              sawTextChunk = true;
            } else if (role === "assistant" && text.length > 0) {
              const messageId = currentPiAssistantMessageId ?? "assistant-streaming";
              chunks.push(
                { type: "data-pi-message-start", data: { seq: nextPiSeq(), messageId, role } } as unknown as UIMessageChunk,
                { type: "data-pi-message-end", data: { seq: nextPiSeq(), messageId, role, text } } as unknown as UIMessageChunk,
              );
              sawTextChunk = true;
              assistantText += text;
            }
          }

          if (willRetry) {
            // Pi 0.75+ can emit agent_end for a failed attempt while it is
            // about to auto-retry. Keep the HTTP stream open so retry chunks
            // are delivered instead of accumulating after the generator exits.
          } else if (nativeFollowUpPending.has(input.sessionId) && !ctx.abortSignal.aborted) {
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
            // Pre-check base64 length to avoid allocating oversized buffers
            // (DoS vector: a client could send a massive base64 string).
            // Base64 decodes to ~75% of encoded length; cap at 10 MB.
            const estimatedSize = Math.ceil(b64.length * 0.75)
            if (estimatedSize > 10 * 1024 * 1024) {
              writeErrors.push(`${a.filename ?? "image"}: attachment exceeds 10 MB limit`);
              continue;
            }
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
            // Defensive escape hatch: native followUp normally keeps prompt()
            // alive until the queued turn is consumed and emits its own user
            // message_start. If pi resolves without that consumption event,
            // do not keep the HTTP stream open forever waiting for chunks that
            // will never arrive.
            if (!done && nativeFollowUpPending.has(input.sessionId)) {
              clearNativeFollowUpWork(input.sessionId);
              done = true;
              stopHeartbeat();
              if (wake) wake();
            }
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

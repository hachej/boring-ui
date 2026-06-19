import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  createAgentSession,
  type AgentSession,
  type PromptOptions,
  SessionManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  SettingsManager,
  getAgentDir,
  loadSkills,
  type ExtensionFactory,
  type SlashCommandInfo,
} from "@mariozechner/pi-coding-agent";
import type { AgentHarness, AgentSlashCommandSummary, SendMessageInput, RunContext } from "../../../shared/harness.js";
import { createLogger } from "../../logging.js";
import type { AgentTool } from "../../../shared/tool.js";
import type { TelemetrySink } from "../../../shared/telemetry.js";
import { adaptToolsForPi, unmarkToolResultErrorDetails } from "./tool-adapter.js";
import { createPiAgentSessionAdapter, type PiAgentSessionAdapter } from "../../pi-chat/PiAgentSessionAdapter.js";
import { PiSessionStore } from "./sessions.js";
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
  resourceLoader: DefaultResourceLoader;
}

export { mergePiPackageSources } from "../../piPackages.js";
export type { PiPackageSource } from "../../piPackages.js";

/**
 * Pi's base system prompt includes `Current working directory: <abs path>`.
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
  "- The \"Current working directory\" line in this prompt is the workspace root. Tool path arguments must be relative to it (e.g. `README.md`, `src/foo.ts`).",
  "- Never pass an absolute path or a path that walks outside the workspace (no leading `/`, no `..` that escapes the root). The sandbox will reject it and the call is wasted.",
  "- For `find`/`grep`/`ls`: omit the `path` argument to search from the workspace root. Pass `path` only when you need to restrict to a subdirectory, and only as a workspace-relative path.",
  "- For `read`/`edit`/`write`: pass workspace-relative paths only.",
].join("\n");

/**
 * The boring-agent runtime provisions Python via Astral `uv` (see workspace
 * provisioning). Tell the model how to use it so it doesn't fall back to bare
 * `pip` or assume `uv` is missing. Lives here (runtime package) because it
 * describes the standard runtime environment, not any single app/plugin.
 */
const PYTHON_RUNTIME_GUIDELINE = [
  "## Python runtime",
  "",
  "- Python 3 and the Astral `uv` package manager are available on PATH.",
  "- Run scripts with `python3`.",
  "- Install/manage packages with `uv pip install <pkg>` (fast; targets the workspace venv at `.boring-agent/venv`). `uv` is the canonical package manager here — don't assume only `pip`.",
  "- Create venvs with `uv venv` if needed.",
].join("\n");

function composeSystemPromptAppend(hostAppend: string | undefined): string {
  return [WORKSPACE_PATHS_GUIDELINE, PYTHON_RUNTIME_GUIDELINE, hostAppend?.trim()]
    .filter(Boolean)
    .join("\n\n");
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

/** Pi harness options with the discovery flags resolved to definite booleans. */
export type ResolvedPiHarnessOptions = PiHarnessOptions & {
  noContextFiles: boolean;
  noSkills: boolean;
};

/**
 * Boring's default pi resource-discovery policy — the ONE place these flags
 * get their defaults. Harness factories must apply this instead of inlining
 * flag literals; hosts override per-field through their `pi` config.
 *
 * - `noContextFiles: true` — boring composes its own workspace context
 *   prompt; pi's ambient AGENTS.md/CLAUDE.md discovery stays off.
 * - `noSkills: true` — ambient skill discovery (workspace + user-global
 *   ~/.pi skills) stays off so user-global skills don't leak into hosted
 *   agents. Hosts that run on the user's own machine (the standalone CLI)
 *   opt in with `pi: { noSkills: false }`.
 */
export function withPiHarnessDefaults(pi?: PiHarnessOptions): ResolvedPiHarnessOptions {
  const { noContextFiles = true, noSkills = true, ...rest } = pi ?? {};
  return { ...rest, noContextFiles, noSkills };
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

function buildToolErrorResultExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("tool_result", async (event) => {
      const marked = unmarkToolResultErrorDetails((event as { details?: unknown }).details)
      if (!marked.isMarked) return
      return {
        details: marked.details,
        isError: true,
      }
    })
  }
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

/**
 * Derive the originating plugin/package name from Pi's command sourceInfo.
 * Returns the extension directory name for boring runtime plugins (.pi/extensions/<name>),
 * the package name for npm sources, the repo name for git sources, and the
 * filename for user-global single-file extensions. Returns undefined for built-in/top-level
 * commands with no package origin.
 */
export function deriveSourcePlugin(sourceInfo: SlashCommandInfo["sourceInfo"] | undefined): string | undefined {
  if (!sourceInfo) return undefined;
  const path = typeof sourceInfo.path === "string" ? sourceInfo.path : "";
  const source = typeof sourceInfo.source === "string" ? sourceInfo.source : "";
  // Boring runtime plugin: .pi/extensions/<name>/...
  const runtimePlugin = path.match(/[/\\]\.pi[/\\]extensions[/\\]([^/\\]+)/);
  if (runtimePlugin) return runtimePlugin[1];
  // Provisioned plugin skill: .boring-agent/skills/<plugin>/<skill>/SKILL.md
  const provisionedSkill = path.match(/[/\\]\.boring-agent[/\\]skills[/\\]([^/\\]+)/);
  if (provisionedSkill) return provisionedSkill[1];
  // npm package source: "npm:<pkg>"
  if (source.startsWith("npm:")) return source.slice(4) || undefined;
  // git source: "git/<host>/<owner>/<repo>" -> repo
  if (source.startsWith("git/")) return source.split("/").filter(Boolean).pop();
  // User-global single-file extension: .../extensions/<file>.ts
  const fileExtension = path.match(/[/\\]extensions[/\\]([^/\\]+)\.[cm]?[tj]sx?$/);
  if (fileExtension) return fileExtension[1];
  return undefined;
}

function normalizeSlashCommandInfo(command: SlashCommandInfo): AgentSlashCommandSummary {
  const sourcePlugin = deriveSourcePlugin(command.sourceInfo);
  return {
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
    source: command.source,
    ...(sourcePlugin ? { sourcePlugin } : {}),
  };
}

export function createPiCodingAgentHarness(opts: {
  tools: AgentTool[];
  /** Host/storage cwd used for harness-owned resources (.pi settings, attachments, plugin discovery). */
  cwd: string;
  /** Agent-visible cwd used by Pi's system prompt and native session metadata. */
  runtimeCwd?: string;
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
}): AgentHarness & {
  getPiSessionAdapter(input: SendMessageInput, ctx: RunContext): Promise<PiAgentSessionAdapter>;
  hasPiSession(sessionId: string): boolean;
} {
  // Normalize at the true boundary: direct callers and custom harnessFactory
  // hosts get the canonical discovery policy even if they never heard of
  // withPiHarnessDefaults. Idempotent for the built-in factories, which
  // already pass defaulted options.
  const pi = withPiHarnessDefaults(opts.pi);
  const sessionStore = new PiSessionStore(opts.runtimeCwd ?? opts.cwd, {
    sessionNamespace: opts.sessionNamespace,
    sessionDir: opts.sessionDir,
    storageCwd: opts.cwd,
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
    const dynamic = pi.getHotReloadableResources?.() ?? {}
    effectiveSkillPaths.splice(
      0,
      effectiveSkillPaths.length,
      ...(pi.additionalSkillPaths ?? []),
      ...(dynamic.additionalSkillPaths ?? []),
    )
    effectivePackages.splice(
      0,
      effectivePackages.length,
      ...mergePiPackageSources(pi.packages ?? [], dynamic.packages ?? []),
    )
    effectiveExtensionPaths.splice(
      0,
      effectiveExtensionPaths.length,
      ...(pi.extensionPaths ?? []),
      ...(dynamic.extensionPaths ?? []),
    )
  }
  refreshEffectiveResources()

  // Single-flight guard: concurrent cold callers for the same session (e.g.
  // two browser tabs each opening /events + /state) must share one Pi session
  // create. Without it both miss the `piSessions` cache, each run the ~seconds
  // createAgentSession, and the loser's handle is overwritten — leaking a Pi
  // session and breaking the single-writer guarantee.
  const piSessionCreations = new Map<string, Promise<PiSessionHandle>>();

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

    const inFlight = piSessionCreations.get(sessionId);
    if (inFlight) {
      const handle = await inFlight;
      await applyRequestedSessionOptions(handle, input);
      return handle;
    }

    const creation = createPiSession(sessionId, input, ctx);
    piSessionCreations.set(sessionId, creation);
    try {
      return await creation;
    } finally {
      if (piSessionCreations.get(sessionId) === creation) piSessionCreations.delete(sessionId);
    }
  }

  async function createPiSession(
    sessionId: string,
    input: SendMessageInput,
    ctx: RunContext,
  ): Promise<PiSessionHandle> {
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
    const runtimeCwd = opts.runtimeCwd ?? ctx.workdir;
    const nativeSessionDir = sessionStore.getSessionDir();
    if (savedPiFile) {
      try {
        sessionManager = SessionManager.open(savedPiFile, undefined, runtimeCwd);
      } catch {
        sessionManager = SessionManager.create(runtimeCwd, nativeSessionDir);
        isNewPiSession = true;
      }
    } else {
      sessionManager = SessionManager.create(runtimeCwd, nativeSessionDir);
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
    const toolErrorResultExtension = buildToolErrorResultExtension()
    const extensionFactories = [
      toolErrorResultExtension,
      ...(dynamicPromptExtension ? [dynamicPromptExtension] : []),
      ...(pi.extensionFactories ?? []),
    ]
    const settingsManager = createResourceSettingsManager(
      opts.cwd,
      agentDir,
      effectivePackages,
    )
    const resourceLoader = new DefaultResourceLoader({
      cwd: opts.cwd,
      agentDir,
      settingsManager,
      appendSystemPromptOverride: (base: string[]) => [...base, composedSystemPromptAppend],
      ...(effectiveExtensionPaths.length ? { additionalExtensionPaths: effectiveExtensionPaths } : {}),
      ...(extensionFactories.length ? { extensionFactories } : {}),
      ...(pi.noContextFiles ? { noContextFiles: true } : {}),
      ...(pi.noSkills ? { noSkills: true } : {}),
      ...(effectiveSkillPaths.length ? { additionalSkillPaths: effectiveSkillPaths } : {}),
      // skillsOverride REPLACES Pi's resolved skill set, which includes
      // skills contributed by host-declared pi packages (e.g.
      // @hachej/boring-pi → boring-plugin-authoring). Only trigger it for
      // the explicit `noSkills` opt-out, where the host wants a clean slate.
      // Passing additionalSkillPaths is not, by itself, a request to throw
      // away package skills — those should keep flowing through Pi's loader
      // and merge with the additional paths.
      ...(pi.noSkills
        ? {
            skillsOverride: () =>
              loadSkills({
                cwd: opts.cwd,
                agentDir,
                skillPaths: effectiveSkillPaths,
                includeDefaults: false,
              }),
          }
        : {}),
    })

    await resourceLoader?.reload()

    const { session: piSession } = await createAgentSession({
      cwd: runtimeCwd,
      // Suppress Pi's built-in filesystem/shell tools while keeping Boring's
      // adapted tool catalog active.
      tools: [],
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

    const handle: PiSessionHandle = { piSession, modelRegistry, sessionManager, resourceLoader };
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
  }

  const originalDelete = sessionStore.delete.bind(sessionStore);
  sessionStore.delete = async (ctx, sessionId) => {
    await originalDelete(ctx, sessionId);
    disposePiSession(sessionId);
  };


  return ({
    id: "pi-coding-agent",
    placement: "server",
    sessions: sessionStore,

    /**
     * Pi exposes the resolved system prompt as a getter on AgentSession.
     * Sessions are created lazily on the first prompt, so callers may see
     * `undefined` for a session that hasn't been written to yet — that's
     * the expected pre-first-turn state, not an error.
     */
    getSystemPrompt(sessionId: string): string | undefined {
      return piSessions.get(sessionId)?.piSession.systemPrompt;
    },

    hasPiSession(sessionId: string): boolean {
      return piSessions.has(sessionId);
    },

    /**
     * Surface Pi's skill/extension load diagnostics for a session so silent
     * load failures (bad SKILL.md, extension import errors) reach the UI and
     * the agent. Returns [] when the session has no live pi session yet.
     * The resourceLoader getters are synchronous.
     */
    getResourceDiagnostics(sessionId: string): Array<{ source: string; message: string; path?: string }> {
      const handle = piSessions.get(sessionId);
      if (!handle) return [];
      const out: Array<{ source: string; message: string; path?: string }> = [];
      // Pi can emit the same diagnostic once per skill-path source, and its
      // messages often embed the path already — append it only when missing
      // and de-duplicate on the final (source, message) pair.
      const seen = new Set<string>();
      const push = (entry: { source: string; message: string; path?: string }) => {
        const key = `${entry.source}\n${entry.message}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(entry);
      };
      for (const diagnostic of handle.resourceLoader.getSkills().diagnostics) {
        push({
          source: "pi-skills",
          message: diagnostic.path && !diagnostic.message.includes(diagnostic.path)
            ? `${diagnostic.message} (${diagnostic.path})`
            : diagnostic.message,
          ...(diagnostic.path ? { path: diagnostic.path } : {}),
        });
      }
      for (const error of handle.resourceLoader.getExtensions().errors) {
        push({
          source: "pi-extensions",
          message: error.error.includes(error.path) ? error.error : `${error.error} (${error.path})`,
          path: error.path,
        });
      }
      return out;
    },

    reloadSession: reloadPiSession,

    async getSlashCommands(sessionId: string, ctx: RunContext): Promise<ReadonlyArray<AgentSlashCommandSummary>> {
      const handle = await getOrCreatePiSession(sessionId, { sessionId, message: "" }, ctx);
      return handle.resourceLoader.getExtensions().runtime.getCommands().map(normalizeSlashCommandInfo);
    },

    async executeSlashCommand(sessionId: string, name: string, args: string, ctx: RunContext): Promise<void> {
      const handle = await getOrCreatePiSession(sessionId, { sessionId, message: "" }, ctx);
      const command = handle.piSession.extensionRunner.getCommand(name);
      if (command) {
        await command.handler(args, handle.piSession.extensionRunner.createCommandContext());
        return;
      }

      const knownCommand = handle.resourceLoader.getExtensions().runtime.getCommands().some((candidate) => candidate.name === name);
      if (!knownCommand) throw new Error(`command '${name}' not registered in session '${sessionId}'`);

      const text = args.trim() ? `/${name} ${args}` : `/${name}`;
      await handle.piSession.prompt(text);
    },

    async getPiSessionAdapter(input: SendMessageInput, ctx: RunContext) {
      const { piSession } = await getOrCreatePiSession(input.sessionId, input, ctx);
      return createPiAgentSessionAdapter(piSession, {
        sessionId: input.sessionId,
        ...(piSession.agent && typeof piSession.agent.continue === "function"
          ? { continueQueuedFollowUp: () => piSession.agent!.continue() }
          : {}),
      });
    },
  } as AgentHarness & {
    getPiSessionAdapter(input: SendMessageInput, ctx: RunContext): Promise<PiAgentSessionAdapter>;
    hasPiSession(sessionId: string): boolean;
  });
}

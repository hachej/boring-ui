import { randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  stat as fsStat,
  lstat,
  realpath,
  rm,
  mkdir,
  writeFile,
  appendFile,
  rename,
  open,
  link,
} from "node:fs/promises";
import { closeSync, constants as fsConstants, createReadStream, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, basename, dirname, resolve, relative } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { getEnv } from "../../config/env.js";
import { normalizeSessionTitle } from "../../sessionTitle.js";
import {
  parseSessionEntries,
  type SessionEntry,
  type SessionHeader,
  type SessionMessageEntry,
  type SessionInfoEntry,
  CURRENT_SESSION_VERSION,
} from "@mariozechner/pi-coding-agent";
import type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionDetail,
  SessionListOptions,
} from "../../../shared/session.js";

/** Raw pi message objects (role/content/timestamp on the object), in file
 * order, ready to feed straight into buildPiChatHistory — the same shape the
 * live event path consumes. */
export interface PiSessionEntries {
  id: string;
  messages: unknown[];
}

function sessionBaseDir(explicitRoot?: string): string {
  const explicit = explicitRoot?.trim();
  if (explicit) return resolve(explicit);
  const configured = getEnv(SESSION_ROOT_ENV)?.trim();
  return configured ? resolve(configured) : join(homedir(), ".pi", "agent", "sessions");
}

function defaultSessionDir(cwd: string, explicitRoot?: string): string {
  if (explicitRoot && cwd.trim().length === 0) return sessionBaseDir(explicitRoot);
  const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(sessionBaseDir(explicitRoot), safePath);
}

function configuredPrivateMetadataRoot(explicitRoot?: string): string | undefined {
  const explicit = explicitRoot?.trim();
  if (explicit) return resolve(explicit);
  const configured = getEnv(PRIVATE_METADATA_ROOT_ENV)?.trim();
  return configured ? resolve(configured) : undefined;
}

function defaultPrivateMetadataRootForSession(sessionDir: string, scannedSessionRoot?: string): string {
  return `${resolve(scannedSessionRoot ?? sessionDir)}.boring-private`;
}

function privateMetadataRootForSessionDir(sessionDir: string, explicitPrivateRoot?: string, scannedSessionRoot?: string): string {
  return configuredPrivateMetadataRoot(explicitPrivateRoot) ?? defaultPrivateMetadataRootForSession(sessionDir, scannedSessionRoot);
}

function nativeScopeMetadataDirForSessionDir(sessionDir: string, explicitPrivateRoot?: string, scannedSessionRoot?: string): string {
  const resolvedSessionDir = resolve(sessionDir);
  return join(privateMetadataRootForSessionDir(resolvedSessionDir, explicitPrivateRoot, scannedSessionRoot), "native-session-scopes", basename(resolvedSessionDir));
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const SAFE_SESSION_NAMESPACE = /^[a-zA-Z0-9_-]+$/;
const SESSION_ROOT_ENV = "BORING_AGENT_SESSION_ROOT";
const PRIVATE_METADATA_ROOT_ENV = "BORING_AGENT_PRIVATE_METADATA_ROOT";
const SUMMARY_PREFIX_BYTES = 64 * 1024;
const LEGACY_BROWSER_DRAFT_SCOPE_CUSTOM_TYPE = "boring.browser-draft-scope.v1";
const MAX_SESSION_INFO_LINE_BYTES = 64 * 1024;
const DEFAULT_LEGACY_WORKSPACE_ID = "default";
const SAFE_BROWSER_DRAFT_NATIVE_ID = /^brdraft_[A-Za-z0-9_-]{16,96}$/;
const QUARANTINED_BROWSER_DRAFT_CTX = Symbol("quarantined-browser-draft-session");

type SessionFileStat = { filepath: string; stat: Awaited<ReturnType<typeof fsStat>> };
type StoredSessionCtx = SessionCtx | null | typeof QUARANTINED_BROWSER_DRAFT_CTX;

interface NativeSessionScopeMetadata {
  version: 1;
  nativeSessionId: string;
  sessionCtx: SessionCtx;
  createdAt: string;
}

interface PrefixCacheEntry {
  mtimeMs: number;
  size: number;
  referencedPiFile: string | null;
  sessionCtx?: StoredSessionCtx;
  linkedMtimeMs?: number;
  linkedSize?: number;
  summary?: SessionSummary | null;
}

interface NormalizedListOptions {
  limit: number | undefined;
  offset: number;
  includeId: string | undefined;
}

function sessionDirForNamespace(namespace: string, explicitRoot?: string): string {
  const safeNamespace = namespace.trim();
  if (!SAFE_SESSION_NAMESPACE.test(safeNamespace)) {
    throw new Error("session namespace must contain only letters, numbers, underscores, and dashes");
  }
  return join(sessionBaseDir(explicitRoot), safeNamespace);
}

function normalizeListOptions(options: SessionListOptions | undefined): NormalizedListOptions {
  return {
    limit: options?.limit === undefined ? undefined : Math.max(0, options.limit),
    offset: Math.max(0, options?.offset ?? 0),
    includeId: options?.includeId,
  };
}

export interface PiSessionStoreOptions {
  sessionDir?: string;
  sessionNamespace?: string;
  /** Explicit root for file-backed session directories. Overrides BORING_AGENT_SESSION_ROOT. */
  sessionRoot?: string;
  /** Explicit root for private native-session metadata. Overrides BORING_AGENT_PRIVATE_METADATA_ROOT. */
  privateMetadataRoot?: string;
  /** Host/storage cwd used only to derive the default file-backed session directory. */
  storageCwd?: string;
}

export class PiSessionStore implements SessionStore {
  private cwd: string;
  private sessionDir: string;
  private allowLegacyUnscopedAccess: boolean;
  private prefixCache = new Map<string, PrefixCacheEntry>();
  private listInFlight = new Map<string, Promise<SessionSummary[]>>();
  private appendInFlight = new Map<string, Promise<void>>();
  private privateMetadataRoot: string;
  private nativeScopeMetadataDir: string;
  private scannedSessionRoots: string[];

  constructor(cwd: string, options?: string | PiSessionStoreOptions) {
    this.cwd = cwd;
    if (typeof options === "string") {
      this.sessionDir = options;
      this.privateMetadataRoot = privateMetadataRootForSessionDir(this.sessionDir);
      this.nativeScopeMetadataDir = nativeScopeMetadataDirForSessionDir(this.sessionDir);
      this.scannedSessionRoots = [this.sessionDir];
      assertMetadataRootDoesNotOverlapSessionRoots(this.privateMetadataRoot, this.scannedSessionRoots);
      this.allowLegacyUnscopedAccess = true;
      return;
    }
    this.allowLegacyUnscopedAccess = true;
    const sessionRoot = options?.sessionRoot;
    const scannedSessionRoot = options?.sessionDir ? undefined : sessionBaseDir(sessionRoot);
    this.sessionDir = options?.sessionDir
      ?? (options?.sessionNamespace
        ? sessionDirForNamespace(options.sessionNamespace, sessionRoot)
        : defaultSessionDir(options?.storageCwd ?? cwd, sessionRoot));
    this.privateMetadataRoot = privateMetadataRootForSessionDir(this.sessionDir, options?.privateMetadataRoot, scannedSessionRoot);
    this.nativeScopeMetadataDir = nativeScopeMetadataDirForSessionDir(this.sessionDir, options?.privateMetadataRoot, scannedSessionRoot);
    this.scannedSessionRoots = [this.sessionDir, ...(scannedSessionRoot ? [scannedSessionRoot] : [])];
    assertMetadataRootDoesNotOverlapSessionRoots(this.privateMetadataRoot, this.scannedSessionRoots);
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  getPrivateMetadataRoot(): string {
    return this.privateMetadataRoot;
  }

  getNativeSessionScopeMetadataDir(): string {
    return this.nativeScopeMetadataDir;
  }

  hasSessionIdSync(sessionId: string): boolean {
    if (!SAFE_ID.test(sessionId)) return false;
    try {
      return safeJsonlSessionFilesSync(this.sessionDir).some(({ filepath }) => sessionFileMayClaimIdSync(filepath, sessionId));
    } catch {
      // Fail closed for admission/collision checks: unreadable duplicate/header
      // state must not allow a browser draft to claim the same native ID.
      return true;
    }
  }

  async hasSessionId(sessionId: string): Promise<boolean> {
    if (!SAFE_ID.test(sessionId)) return false;
    try {
      const files = await safeJsonlSessionFiles(this.sessionDir);
      for (const { filepath } of files) {
        if (await sessionFileMayClaimId(filepath, sessionId)) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  async list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]> {
    const normalizedOptions = normalizeListOptions(options);
    const inFlightKey = JSON.stringify([
      ctx.workspaceId,
      ctx.userId ?? null,
      ctx.storageScope ?? null,
      normalizedOptions.limit ?? null,
      normalizedOptions.offset,
      normalizedOptions.includeId ?? null,
    ]);
    const inFlight = this.listInFlight.get(inFlightKey);
    if (inFlight) return inFlight;

    const promise = this.listUncached(ctx, normalizedOptions);
    this.listInFlight.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      if (this.listInFlight.get(inFlightKey) === promise) this.listInFlight.delete(inFlightKey);
    }
  }

  private async listUncached(ctx: SessionCtx, options: NormalizedListOptions): Promise<SessionSummary[]> {
    const fileStats = await safeJsonlSessionFiles(this.sessionDir);
    const existingFiles = fileStats;
    const referencedPiFiles = await this.referencedPiFiles(existingFiles);
    const visibleFiles = await Promise.all(existingFiles
      .filter(({ filepath }) => !referencedPiFiles.has(resolve(filepath)))
      .map(async (file) => ({
        ...file,
        sortMtimeMs: await this.sessionSortMtimeMs(file),
      })));
    visibleFiles.sort((a, b) => b.sortMtimeMs - a.sortMtimeMs);

    const { offset, limit } = options;
    const pageSummaries = await this.summarizeVisiblePage(visibleFiles, { ctx, offset, limit });
    const includeId = options.includeId;
    if (!includeId || pageSummaries.some((summary) => summary.id === includeId)) return pageSummaries;

    const includeSummary = await this.summarizeIncludedSession(ctx, includeId, referencedPiFiles);
    return includeSummary ? [...pageSummaries, includeSummary] : pageSummaries;
  }

  async create(
    ctx: SessionCtx,
    init?: { title?: string },
  ): Promise<SessionSummary> {
    await mkdir(this.sessionDir, { recursive: true });

    const id = randomUUID();
    const now = new Date().toISOString();
    const header: SessionHeader & { boringSessionCtx: SessionCtx } = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id,
      timestamp: now,
      cwd: this.cwd,
      boringSessionCtx: normalizeSessionCtx(ctx) ?? {},
    };

    const lines = [JSON.stringify(header)];
    if (init?.title) {
      const infoEntry: SessionInfoEntry = {
        type: "session_info",
        id: randomUUID(),
        parentId: null,
        timestamp: now,
        name: init.title,
      };
      lines.push(JSON.stringify(infoEntry));
    }

    const filepath = join(this.sessionDir, `${id}.jsonl`);
    await writeFile(filepath, lines.join("\n") + "\n", "utf-8");

    return {
      id,
      title: init?.title ?? "New session",
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
      materialized: false,
      canRename: false,
    };
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const resolved = await this.resolveSessionTranscript(ctx, sessionId);
    const title =
      extractTitle(resolved.linkedEntries) ?? extractTitle(resolved.sessionEntries) ?? "New session";
    const turnCount = countUserTurns(resolved.transcriptEntries);
    const materialized = entriesHaveAssistantMessage(resolved.transcriptEntries);
    const updatedAtMs = Math.max(resolved.fileStat.mtime.getTime(), resolved.linkedMtimeMs ?? 0);

    return {
      id: resolved.resolvedSessionId,
      title,
      createdAt: resolved.header?.timestamp ?? resolved.fileStat.birthtime.toISOString(),
      updatedAt: new Date(updatedAtMs).toISOString(),
      turnCount,
      materialized,
      canRename: materialized,
    };
  }

  async rename(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary> {
    return this.renameInternal(ctx, sessionId, title);
  }

  /**
   * Records the restart-pending wrapper title after a live, unmaterialized Pi
   * SessionManager has accepted setSessionName. This deliberately never
   * targets native JSONL: that live SessionManager is its sole future writer.
   */
  async recordLivePendingTitle(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary> {
    const normalizedTitle = normalizeSessionTitle(title);
    const filepath = await this.resolveSessionFile(sessionId, ctx);
    const fileSessionId = await this.readSessionFileId(filepath);
    if (fileSessionId && fileSessionId !== sessionId) throw new Error(`Session not found: ${sessionId}`);

    const now = new Date().toISOString();
    const infoEntry: SessionInfoEntry = {
      type: "session_info",
      id: randomUUID(),
      parentId: null,
      timestamp: now,
      name: normalizedTitle,
    };
    await this.appendJsonlEntry(filepath, infoEntry);
    this.prefixCache.delete(filepath);
    return this.load(ctx, sessionId);
  }

  private async renameInternal(
    ctx: SessionCtx,
    sessionId: string,
    title: string,
  ): Promise<SessionSummary> {
    const normalizedTitle = normalizeSessionTitle(title);
    const filepath = await this.resolveSessionFile(sessionId, ctx);
    const fileSessionId = await this.readSessionFileId(filepath);
    if (fileSessionId && fileSessionId !== sessionId) throw new Error(`Session not found: ${sessionId}`);

    const linkedPiFile = await this.linkedPiFileFor(filepath);
    const targetPath = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath) && await fileExists(linkedPiFile)
      ? linkedPiFile
      : filepath;
    const now = new Date().toISOString();
    const infoEntry: SessionInfoEntry = {
      type: "session_info",
      id: randomUUID(),
      parentId: null,
      timestamp: now,
      name: normalizedTitle,
    };
    await this.appendJsonlEntry(targetPath, infoEntry);
    this.prefixCache.delete(filepath);
    this.prefixCache.delete(targetPath);
    return this.load(ctx, sessionId);
  }

  private async appendJsonlEntry(filepath: string, entry: SessionInfoEntry): Promise<void> {
    const previous = this.appendInFlight.get(filepath) ?? Promise.resolve();
    const append = previous.catch(() => undefined).then(async () => {
      await appendFile(filepath, JSON.stringify(entry) + "\n", "utf-8");
    });
    this.appendInFlight.set(filepath, append);
    try {
      await append;
    } finally {
      if (this.appendInFlight.get(filepath) === append) this.appendInFlight.delete(filepath);
    }
  }

  /**
   * Returns the persisted pi message objects in file order so callers can run
   * them through buildPiChatHistory — the same canonical projection the live
   * event path uses. This is the cold-load counterpart to the live snapshot.
   */
  async loadEntries(ctx: SessionCtx, sessionId: string): Promise<PiSessionEntries> {
    const resolved = await this.resolveSessionTranscript(ctx, sessionId);
    const messages = resolved.transcriptEntries
      .filter((entry): entry is SessionMessageEntry => entry.type === "message")
      .map((entry) => entry.message);
    return { id: resolved.resolvedSessionId, messages };
  }

  private async resolveSessionTranscript(ctx: SessionCtx, sessionId: string): Promise<{
    resolvedSessionId: string;
    header: SessionHeader | undefined;
    sessionEntries: SessionEntry[];
    linkedEntries: SessionEntry[];
    transcriptEntries: SessionEntry[];
    fileStat: Awaited<ReturnType<typeof fsStat>>;
    linkedMtimeMs?: number;
  }> {
    const filepath = await this.resolveSessionFile(sessionId, ctx);
    let content: string;
    try {
      content = await readFile(filepath, "utf-8");
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const fileEntries = safeParseEntries(content);

    // Legacy sessions accumulated a full ui_snapshot on every turn — a 428-message
    // session could reach 90 MB across 60 snapshots, making every cold-load parse
    // megabytes of data and stall the UI. Compact them out on first read so all
    // subsequent loads are fast. The snapshot entries are never read back in the
    // new architecture (loadEntries uses message entries; load() uses session_info).
    // Wrapped in try/catch: a disk-full or concurrent-append race must never turn a
    // successful read into a thrown error — the in-memory filter below is always correct.
    if (fileEntries.some((e) => (e as { type?: string }).type === "ui_snapshot")) {
      const compacted = fileEntries
        .filter((e) => (e as { type?: string }).type !== "ui_snapshot")
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n";
      const tmp = `${filepath}.compact-${randomUUID()}`;
      try {
        await writeFile(tmp, compacted, "utf-8");
        await rename(tmp, filepath);
      } catch {
        // Repair failed (disk-full, concurrent write, read-only FS) — skip it silently.
        // The next read will retry; the in-memory result is already correct.
        await rm(tmp, { force: true }).catch(() => {});
      }
    }

    const header = fileEntries.find(
      (e): e is SessionHeader => e.type === "session",
    );
    if (!this.fileBelongsToCtx(fileEntries, ctx, sessionId, filepath)) throw new Error(`Session not found: ${sessionId}`);
    await this.persistLegacyNativeScopeMetadataIfNeeded(fileEntries, sessionId, filepath);
    const sessionEntries = fileEntries.filter(
      (e): e is SessionEntry => e.type !== "session" && (e as { type?: string }).type !== "ui_snapshot",
    );

    const fileStat = await fsStat(filepath);
    const linkedPiFile = extractPiSessionFilePath(fileEntries);
    const linked = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)
      ? await this.readLinkedPiSession(linkedPiFile)
      : null;
    const linkedEntries = linked?.entries.filter(
      (e): e is SessionEntry => e.type !== "session",
    ) ?? [];

    // Rebuild the transcript from every persisted message entry in file order
    // (preferring a linked native transcript) rather than pi's compacted LLM
    // working context, so reloads recover the full conversation.
    const transcriptEntries = linkedEntries.length > 0 ? linkedEntries : sessionEntries;

    return {
      resolvedSessionId: header?.id ?? sessionId,
      header,
      sessionEntries,
      linkedEntries,
      transcriptEntries,
      fileStat,
      linkedMtimeMs: linked?.mtime.getTime(),
    };
  }

  // Synchronous variant used during session initialization so that no async
  // I/O hop is introduced before createAgentSession (which would break test
  // timing when fake timers are in use). The file is tiny (metadata only).
  loadPendingPiSessionTitleSync(ctx: SessionCtx, sessionId: string): string | null {
    if (!SAFE_ID.test(sessionId)) return null;
    try {
      const filepath = this.findUniqueSessionFileByHeaderIdSync(sessionId);
      if (!filepath) return null;
      const entries = safeParseEntries(readFileSync(filepath, "utf-8"));
      if (extractSessionHeaderId(entries) !== sessionId) return null;
      if (!this.fileBelongsToCtx(entries, ctx, sessionId, filepath)) return null;

      const linkedPiFile = extractPiSessionFilePath(entries);
      if (linkedPiFile && existsSync(linkedPiFile)) return null;
      if (!linkedPiFile && isTimestampNamedPiSessionFile(filepath, sessionId)) return null;

      const sessionEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
      return extractTitle(sessionEntries) ?? null;
    } catch {
      return null;
    }
  }

  loadPiSessionFileSync(ctx: SessionCtx, sessionId: string): string | null {
    if (!SAFE_ID.test(sessionId)) return null;
    try {
      const filepath = this.findUniqueSessionFileByHeaderIdSync(sessionId);
      if (!filepath) return null;
      const entries = safeParseEntries(readFileSync(filepath, "utf-8"));
      if (!this.fileBelongsToCtx(entries, ctx, sessionId, filepath)) return null;
      const linkedPiFile = extractPiSessionFilePath(entries);
      if (linkedPiFile) return linkedPiFile;
      if (!isTimestampNamedPiSessionFile(filepath, sessionId)) return null;
      const existingWrapper = this.findWrapperReferencingNativeSessionSync(filepath);
      if (existingWrapper) {
        const existingEntries = parseJsonlPrefixEntries(readJsonlPrefixSync(existingWrapper));
        if (extractSessionHeaderId(existingEntries) !== sessionId) return null;
        if (!this.fileBelongsToCtx(existingEntries, ctx, sessionId, existingWrapper)) return null;
        return extractPiSessionFilePath(existingEntries);
      }
      if (this.hasNativeSessionScopeMetadataSync(sessionId) || hasMaterializedLegacyBrowserDraftScope(entries)) return filepath;
      return null;
    } catch {
      return null;
    }
  }

  async loadPiSessionFile(ctx: SessionCtx, sessionId: string): Promise<string | null> {
    if (!SAFE_ID.test(sessionId)) return null;
    try {
      const filepath = await this.findUniqueSessionFileByHeaderId(sessionId);
      if (!filepath) return null;
      const entries = safeParseEntries(await readFile(filepath, "utf-8"));
      if (!this.fileBelongsToCtx(entries, ctx, sessionId, filepath)) return null;
      const linkedPiFile = extractPiSessionFilePath(entries);
      if (linkedPiFile) return linkedPiFile;
      if (!isTimestampNamedPiSessionFile(filepath, sessionId)) return null;
      const existingWrapper = await this.findWrapperReferencingNativeSession(filepath);
      if (existingWrapper) {
        const wrapperSessionId = await this.readSessionFileId(existingWrapper);
        if (wrapperSessionId !== sessionId) return null;
        const wrapperEntries = parseJsonlPrefixEntries(await readJsonlPrefix(existingWrapper));
        if (!this.fileBelongsToCtx(wrapperEntries, ctx, sessionId, existingWrapper)) return null;
        return extractPiSessionFilePath(wrapperEntries);
      }
      if (this.hasNativeSessionScopeMetadataSync(sessionId) || hasMaterializedLegacyBrowserDraftScope(entries)) return filepath;
      return null;
    } catch {
      return null;
    }
  }

  async savePiSessionFile(ctx: SessionCtx, sessionId: string, piFilePath: string): Promise<void> {
    const filepath = await this.resolveSessionFile(sessionId, ctx);
    const entry = JSON.stringify({
      type: "pi_session_file",
      timestamp: new Date().toISOString(),
      path: piFilePath,
    });
    await appendFile(filepath, entry + "\n");
  }

  saveNativeSessionScopeMetadataAfterAssistantCommitSync(
    ctx: SessionCtx,
    sessionId: string,
    nativePath: string,
  ): boolean {
    if (!SAFE_ID.test(sessionId)) return false;
    const normalizedCtx = normalizeSessionCtx(ctx);
    if (!normalizedCtx?.workspaceId || !normalizedCtx.userId) return false;

    if (!safeSessionFilePathSync(this.sessionDir, nativePath)) return false;
    let entries: (SessionHeader | SessionEntry)[];
    try {
      entries = parseJsonlPrefixEntries(readJsonlPrefixSync(nativePath));
    } catch {
      return false;
    }
    if (extractSessionHeaderId(entries) !== sessionId) return false;
    if (!fileHasAssistantMessageSync(nativePath)) return false;

    const existingCtx = this.readNativeSessionScopeMetadataSync(sessionId);
    if (existingCtx !== null && existingCtx !== QUARANTINED_BROWSER_DRAFT_CTX) {
      if (!sameSessionCtx(existingCtx ?? {}, normalizedCtx)) throw new Error(`native session scope mismatch: ${sessionId}`);
      return true;
    }

    ensurePrivateMetadataDirSync(this.nativeScopeMetadataDir, this.privateMetadataRoot);
    const now = new Date().toISOString();
    const record: NativeSessionScopeMetadata = {
      version: 1,
      nativeSessionId: sessionId,
      sessionCtx: normalizedCtx,
      createdAt: now,
    };
    const metadataPath = this.nativeScopeMetadataPath(sessionId);
    const metadata = JSON.stringify(record) + "\n";
    const tmpPath = join(this.nativeScopeMetadataDir, `.${sessionId}.${randomUUID()}.tmp`);
    const fd = openSync(tmpPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try {
      writeFileSync(fd, metadata, { encoding: "utf-8" });
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(tmpPath, metadataPath);
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      const racedCtx = this.readNativeSessionScopeMetadataSync(sessionId);
      if (racedCtx === QUARANTINED_BROWSER_DRAFT_CTX || !sameSessionCtx(racedCtx ?? {}, normalizedCtx)) throw new Error(`native session scope mismatch: ${sessionId}`);
    } finally {
      rmSync(tmpPath, { force: true });
    }
    fsyncDirectorySync(this.nativeScopeMetadataDir);
    this.prefixCache.delete(nativePath);
    return true;
  }

  async saveNativeSessionScopeMetadataAfterAssistantCommit(
    ctx: SessionCtx,
    sessionId: string,
    nativePath: string,
  ): Promise<boolean> {
    if (!SAFE_ID.test(sessionId)) return false;
    const normalizedCtx = normalizeSessionCtx(ctx);
    if (!normalizedCtx?.workspaceId || !normalizedCtx.userId) return false;

    if (!await safeSessionFilePath(this.sessionDir, nativePath)) return false;
    let entries: (SessionHeader | SessionEntry)[];
    try {
      entries = parseJsonlPrefixEntries(await readJsonlPrefix(nativePath));
    } catch {
      return false;
    }
    if (extractSessionHeaderId(entries) !== sessionId) return false;
    if (!await fileHasAssistantMessage(nativePath)) return false;

    const existingCtx = this.readNativeSessionScopeMetadataSync(sessionId);
    if (existingCtx !== null && existingCtx !== QUARANTINED_BROWSER_DRAFT_CTX) {
      if (!sameSessionCtx(existingCtx ?? {}, normalizedCtx)) throw new Error(`native session scope mismatch: ${sessionId}`);
      return true;
    }

    await ensurePrivateMetadataDir(this.nativeScopeMetadataDir, this.privateMetadataRoot);
    const now = new Date().toISOString();
    const record: NativeSessionScopeMetadata = {
      version: 1,
      nativeSessionId: sessionId,
      sessionCtx: normalizedCtx,
      createdAt: now,
    };
    const metadataPath = this.nativeScopeMetadataPath(sessionId);
    const metadata = JSON.stringify(record) + "\n";
    const tmpPath = join(this.nativeScopeMetadataDir, `.${sessionId}.${randomUUID()}.tmp`);
    const handle = await open(tmpPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    try {
      await handle.writeFile(metadata, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(tmpPath, metadataPath);
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      const racedCtx = this.readNativeSessionScopeMetadataSync(sessionId);
      if (racedCtx === QUARANTINED_BROWSER_DRAFT_CTX || !sameSessionCtx(racedCtx ?? {}, normalizedCtx)) throw new Error(`native session scope mismatch: ${sessionId}`);
    } finally {
      await rm(tmpPath, { force: true });
    }
    await fsyncDirectory(this.nativeScopeMetadataDir);
    this.prefixCache.delete(nativePath);
    return true;
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    const filepath = await this.resolveSessionFile(sessionId, ctx).catch(
      () => null,
    );
    if (!filepath) return;
    const fileSessionId = await this.readSessionFileId(filepath);
    if (fileSessionId && fileSessionId !== sessionId) return;
    const linkedPiFile = await this.linkedPiFileFor(filepath);
    await rm(filepath, { force: true });
    await rm(this.nativeScopeMetadataPath(sessionId), { force: true });
    this.prefixCache.delete(filepath);
    if (linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)) {
      await rm(linkedPiFile, { force: true });
      this.prefixCache.delete(linkedPiFile);
    }
  }

  private async resolveSessionFile(sessionId: string, ctx?: SessionCtx): Promise<string> {
    if (!SAFE_ID.test(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const matchedPath = await this.findUniqueSessionFileByHeaderId(sessionId);
    if (!matchedPath) throw new Error(`Session not found: ${sessionId}`);
    if (!isTimestampNamedPiSessionFile(matchedPath, sessionId)) {
      if (ctx) await this.assertFileBelongsToCtx(matchedPath, ctx, sessionId);
      return matchedPath;
    }
    const existingWrapper = await this.findWrapperReferencingNativeSession(matchedPath);
    if (existingWrapper) {
      const wrapperSessionId = await this.readSessionFileId(existingWrapper);
      if (wrapperSessionId === sessionId) {
        if (ctx) await this.assertFileBelongsToCtx(existingWrapper, ctx, sessionId);
        return existingWrapper;
      }
      throw new Error(`Session not found: ${sessionId}`);
    }
    const matchedEntries = parseJsonlPrefixEntries(await readJsonlPrefix(matchedPath));
    if (this.hasNativeSessionScopeMetadataSync(sessionId)) {
      if (ctx && !this.fileBelongsToCtx(matchedEntries, ctx, sessionId, matchedPath)) throw new Error(`Session not found: ${sessionId}`);
      return matchedPath;
    }
    const legacyMaterializedCtx = await materializedLegacyBrowserDraftCtxFromFile(matchedEntries, matchedPath);
    if (legacyMaterializedCtx !== null) {
      if (ctx && !this.storedCtxBelongsToCtx(legacyMaterializedCtx, ctx, sessionId)) throw new Error(`Session not found: ${sessionId}`);
      return matchedPath;
    }
    if (ctx && !this.fileBelongsToCtx(matchedEntries, ctx, sessionId, matchedPath)) throw new Error(`Session not found: ${sessionId}`);
    throw new Error(`Session not found: ${sessionId}`);
  }

  private async findUniqueSessionFileByHeaderId(sessionId: string): Promise<string | null> {
    const matches: string[] = [];
    let conflictingClaim = false;
    const files = await safeJsonlSessionFiles(this.sessionDir);
    for (const { filepath } of files) {
      const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
      const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
      if (header?.id !== sessionId) continue;
      if (!nativeFilenameMatchesHeader(filepath, header) || !this.headerMatchesRuntime(filepath, header)) {
        conflictingClaim = true;
        continue;
      }
      matches.push(filepath);
    }
    if (conflictingClaim || matches.length > 1) throw new Error(`Session not found: ${sessionId}`);
    return matches[0] ?? null;
  }

  private findUniqueSessionFileByHeaderIdSync(sessionId: string): string | null {
    const matches: string[] = [];
    let conflictingClaim = false;
    const files = safeJsonlSessionFilesSync(this.sessionDir);
    for (const { filepath } of files) {
      const entries = parseJsonlPrefixEntries(readJsonlPrefixSync(filepath));
      const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
      if (header?.id !== sessionId) continue;
      if (!nativeFilenameMatchesHeader(filepath, header) || !this.headerMatchesRuntime(filepath, header)) {
        conflictingClaim = true;
        continue;
      }
      matches.push(filepath);
    }
    if (conflictingClaim || matches.length > 1) throw new Error(`Session not found: ${sessionId}`);
    return matches[0] ?? null;
  }

  private headerMatchesRuntime(filepath: string, header: SessionHeader): boolean {
    if (typeof header.version !== "number" || !Number.isInteger(header.version) || header.version <= 0) return false;
    if (header.cwd !== this.cwd) return false;
    return nativeFilenameMatchesHeader(filepath, header);
  }

  private async assertFileBelongsToCtx(filepath: string, ctx: SessionCtx, sessionId: string): Promise<void> {
    const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
    if (!this.fileBelongsToCtx(entries, ctx, sessionId, filepath)) throw new Error(`Session not found: ${sessionId}`);
  }

  private nativeScopeMetadataPath(sessionId: string): string {
    return join(this.nativeScopeMetadataDir, `${sessionId}.json`);
  }

  private hasNativeSessionScopeMetadataSync(sessionId: string): boolean {
    return this.readNativeSessionScopeMetadataSync(sessionId) !== null;
  }

  private readNativeSessionScopeMetadataSync(sessionId: string): StoredSessionCtx {
    if (!SAFE_ID.test(sessionId)) return null;
    try {
      assertPrivateMetadataDirUsableSync(this.nativeScopeMetadataDir, this.privateMetadataRoot);
    } catch {
      return QUARANTINED_BROWSER_DRAFT_CTX;
    }

    let fd: number;
    try {
      fd = openSync(this.nativeScopeMetadataPath(sessionId), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      return (error as { code?: string }).code === "ENOENT" ? null : QUARANTINED_BROWSER_DRAFT_CTX;
    }

    try {
      const raw = readFileSync(fd, "utf-8");
      const parsed = JSON.parse(raw) as Partial<NativeSessionScopeMetadata>;
      if (parsed.version !== 1 || parsed.nativeSessionId !== sessionId) return QUARANTINED_BROWSER_DRAFT_CTX;
      if (!parsed.sessionCtx || typeof parsed.sessionCtx !== "object") return QUARANTINED_BROWSER_DRAFT_CTX;
      const normalizedCtx = normalizeSessionCtx(parsed.sessionCtx as SessionCtx);
      if (!normalizedCtx?.workspaceId || !normalizedCtx.userId) return QUARANTINED_BROWSER_DRAFT_CTX;
      return normalizedCtx;
    } catch {
      return QUARANTINED_BROWSER_DRAFT_CTX;
    } finally {
      closeSync(fd);
    }
  }

  private async readSessionFileId(filepath: string): Promise<string | null> {
    try {
      const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
      return extractSessionHeaderId(entries);
    } catch {
      return null;
    }
  }

  private async linkedPiFileFor(filepath: string): Promise<string | null> {
    try {
      const content = await readFile(filepath, "utf-8");
      return extractPiSessionFilePath(safeParseEntries(content));
    } catch {
      return null;
    }
  }

  private async referencedPiFiles(files: SessionFileStat[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    await Promise.all(files.map(async ({ filepath, stat }) => {
      try {
        const piFilePath = (await this.readPrefixCache(filepath, stat)).referencedPiFile;
        if (piFilePath && resolve(piFilePath) !== resolve(filepath)) {
          referenced.add(resolve(piFilePath));
        }
      } catch {
        // Ignore unreadable files; summarizeFile will drop them later.
      }
    }));
    return referenced;
  }

  private async sessionSortMtimeMs({ filepath, stat }: SessionFileStat): Promise<number> {
    let sortMtimeMs = stat.mtime.getTime();
    try {
      const linkedPiFile = (await this.readPrefixCache(filepath, stat)).referencedPiFile;
      if (linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)) {
        const linkedStat = await fsStat(linkedPiFile);
        sortMtimeMs = Math.max(sortMtimeMs, linkedStat.mtime.getTime());
      }
    } catch {
      // Fall back to the wrapper/native file mtime for unreadable links.
    }
    return sortMtimeMs;
  }

  private async summarizeFile(
    ctx: SessionCtx,
    filepath: string,
    existingStat?: Awaited<ReturnType<typeof fsStat>>,
  ): Promise<SessionSummary | null> {
    try {
      const fileStat = existingStat ?? await fsStat(filepath);
      const cached = this.cachedPrefix(filepath, fileStat);
      if (
        cached
        && "summary" in cached
        && cached.sessionCtx !== undefined
        && this.cachedCtxBelongsToCtx(cached.sessionCtx, ctx, cached.summary?.id)
        && !(cached.summary?.id && isPiTimestampNamedNativeSessionFile(filepath, cached.summary.id))
        && await this.cachedSummaryIsFresh(filepath, cached)
      ) {
        return cached.summary ?? null;
      }

      const content = await readJsonlPrefix(filepath);

      const firstNewline = content.indexOf("\n");
      if (firstNewline === -1) return null;

      const header: SessionHeader = JSON.parse(
        content.slice(0, firstNewline),
      );
      if (header.type !== "session") return null;
      if (!nativeFilenameMatchesHeader(filepath, header) || !this.headerMatchesRuntime(filepath, header)) return null;
      const entries = parseJsonlPrefixEntries(content);
      const sessionCtx = await this.readStoredSessionCtxForSummary(entries, header, filepath);
      if (!this.cachedCtxBelongsToCtx(sessionCtx, ctx, header.id)) return null;

      const latestSessionInfo = await readLatestSessionInfo(filepath, Number(fileStat.size));
      const sessionEntries = entries.filter(
        (e): e is SessionEntry => e.type !== "session",
      );
      const linkedPiFile = extractPiSessionFilePath(entries);
      const linked = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)
        ? await this.readLinkedPiSessionSummary(linkedPiFile)
        : null;
      const linkedEntries = linked?.entries.filter(
        (e): e is SessionEntry => e.type !== "session",
      ) ?? [];

      const title =
        linked?.latestSessionInfo?.name ??
        latestSessionInfo?.name ??
        extractTitle(linkedEntries) ??
        extractTitle(sessionEntries) ??
        firstUserMessage(linkedEntries) ??
        firstUserMessage(sessionEntries) ??
        "New session";

      const turnCount = [...sessionEntries, ...linkedEntries].filter(
        (e) =>
          e.type === "message" &&
          ((e as SessionMessageEntry).message as any)?.role === "user",
      ).length;
      const updatedAtMs = Math.max(fileStat.mtime.getTime(), linked?.mtime.getTime() ?? 0);
      let materialized = entriesHaveAssistantMessage(linkedEntries.length > 0 ? linkedEntries : sessionEntries);
      if (!materialized) materialized = await fileHasAssistantMessage(linkedPiFile && resolve(linkedPiFile) !== resolve(filepath) ? linkedPiFile : filepath);

      const summary = {
        id: header.id,
        title,
        createdAt: header.timestamp,
        updatedAt: new Date(updatedAtMs).toISOString(),
        turnCount,
        materialized,
        canRename: materialized,
      };
      this.prefixCache.set(filepath, {
        mtimeMs: fileStat.mtime.getTime(),
        size: Number(fileStat.size),
        referencedPiFile: linkedPiFile,
        sessionCtx,
        ...(linked ? { linkedMtimeMs: linked.mtime.getTime(), linkedSize: linked.size } : {}),
        summary,
      });
      return summary;
    } catch {
      return null;
    }
  }

  private cachedPrefix(
    filepath: string,
    fileStat: Awaited<ReturnType<typeof fsStat>>,
  ): PrefixCacheEntry | undefined {
    const cached = this.prefixCache.get(filepath);
    if (!cached) return undefined;
    if (cached.mtimeMs !== fileStat.mtime.getTime() || cached.size !== Number(fileStat.size)) return undefined;
    return cached;
  }

  private async cachedSummaryIsFresh(filepath: string, cached: PrefixCacheEntry): Promise<boolean> {
    const linkedPiFile = cached.referencedPiFile;
    if (!linkedPiFile || resolve(linkedPiFile) === resolve(filepath)) return true;
    try {
      const linkedStat = await fsStat(linkedPiFile);
      return cached.linkedMtimeMs === linkedStat.mtime.getTime() && cached.linkedSize === Number(linkedStat.size);
    } catch {
      return cached.linkedMtimeMs === undefined && cached.linkedSize === undefined;
    }
  }

  private async readPrefixCache(
    filepath: string,
    fileStat: Awaited<ReturnType<typeof fsStat>>,
  ): Promise<PrefixCacheEntry> {
    const cached = this.cachedPrefix(filepath, fileStat);
    if (cached) return cached;

    const content = await readJsonlPrefix(filepath);
    const entries = parseJsonlPrefixEntries(content);
    const entry: PrefixCacheEntry = {
      mtimeMs: fileStat.mtime.getTime(),
      size: Number(fileStat.size),
      referencedPiFile: extractPiSessionFilePath(entries),
      sessionCtx: this.readStoredSessionCtx(entries, undefined, filepath),
    };
    this.prefixCache.set(filepath, entry);
    return entry;
  }

  private async summarizeVisiblePage(
    visibleFiles: Array<{ filepath: string; stat: Awaited<ReturnType<typeof fsStat>> }>,
    options: { ctx: SessionCtx; offset: number; limit: number | undefined },
  ): Promise<SessionSummary[]> {
    if (options.limit === 0) return [];

    const page: SessionSummary[] = [];
    let validSeen = 0;
    let index = 0;
    const batchSize = options.limit === undefined
      ? Math.max(1, visibleFiles.length)
      : Math.max(1, options.limit);

    while (index < visibleFiles.length && (options.limit === undefined || page.length < options.limit)) {
      const batch = visibleFiles.slice(index, index + batchSize);
      index += batch.length;
      const summaries = await Promise.all(
        batch.map(({ filepath, stat }) => this.summarizeFile(options.ctx, filepath, stat)),
      );

      for (const summary of summaries) {
        if (!summary) continue;
        if (validSeen < options.offset) {
          validSeen += 1;
          continue;
        }
        if (options.limit !== undefined && page.length >= options.limit) break;
        page.push(summary);
        validSeen += 1;
      }
    }

    return page;
  }

  private async summarizeIncludedSession(
    ctx: SessionCtx,
    sessionId: string,
    referencedPiFiles: Set<string>,
  ): Promise<SessionSummary | null> {
    try {
      const filepath = await this.resolveSessionFile(sessionId, ctx);
      if (referencedPiFiles.has(resolve(filepath))) return null;
      return this.summarizeFile(ctx, filepath);
    } catch {
      return null;
    }
  }

  private findWrapperReferencingNativeSessionSync(nativePath: string): string | null {
    const resolvedNativePath = resolve(nativePath);
    try {
      const files = safeJsonlSessionFilesSync(this.sessionDir);
      for (const { filepath } of files) {
        if (resolve(filepath) === resolvedNativePath) continue;
        try {
          const linkedPiFile = extractPiSessionFilePath(parseJsonlPrefixEntries(readJsonlPrefixSync(filepath)));
          if (linkedPiFile && resolve(linkedPiFile) === resolvedNativePath) return filepath;
        } catch {
          // Ignore unreadable files while resolving imported native sessions.
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private async findWrapperReferencingNativeSession(nativePath: string): Promise<string | null> {
    const resolvedNativePath = resolve(nativePath);
    const files = await safeJsonlSessionFiles(this.sessionDir);
    for (const { filepath } of files) {
      if (resolve(filepath) === resolvedNativePath) continue;
      try {
        const linkedPiFile = extractPiSessionFilePath(parseJsonlPrefixEntries(await readJsonlPrefix(filepath)));
        if (linkedPiFile && resolve(linkedPiFile) === resolvedNativePath) return filepath;
      } catch {
        // Ignore unreadable files while resolving imported native sessions.
      }
    }
    return null;
  }


  private async readLinkedPiSession(filepath: string): Promise<{ entries: (SessionHeader | SessionEntry)[]; mtime: Date; size: number } | null> {
    try {
      const [fileStat, content] = await Promise.all([
        fsStat(filepath),
        readFile(filepath, "utf-8"),
      ]);
      return { entries: safeParseEntries(content), mtime: fileStat.mtime, size: Number(fileStat.size) };
    } catch {
      return null;
    }
  }

  private async readLinkedPiSessionSummary(filepath: string): Promise<{ entries: (SessionHeader | SessionEntry)[]; latestSessionInfo?: SessionInfoEntry; mtime: Date; size: number } | null> {
    try {
      const fileStat = await fsStat(filepath);
      const [content, latestSessionInfo] = await Promise.all([
        readJsonlPrefix(filepath),
        readLatestSessionInfo(filepath, Number(fileStat.size)),
      ]);
      return {
        entries: parseJsonlPrefixEntries(content),
        ...(latestSessionInfo ? { latestSessionInfo } : {}),
        mtime: fileStat.mtime,
        size: Number(fileStat.size),
      };
    } catch {
      return null;
    }
  }

  private fileBelongsToCtx(entries: (SessionHeader | SessionEntry)[], ctx: SessionCtx, fallbackSessionId?: string, filepath?: string): boolean {
    const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
    if (!header) return isEmptySessionCtx(ctx) && !fallbackSessionId;
    return this.storedCtxBelongsToCtx(this.readStoredSessionCtx(entries, header, filepath), ctx, header.id ?? fallbackSessionId);
  }

  private cachedCtxBelongsToCtx(storedCtx: StoredSessionCtx, ctx: SessionCtx, sessionId: string | undefined): boolean {
    return this.storedCtxBelongsToCtx(storedCtx, ctx, sessionId);
  }

  private async readStoredSessionCtxForSummary(
    entries: (SessionHeader | SessionEntry)[],
    header: SessionHeader,
    filepath: string,
  ): Promise<StoredSessionCtx> {
    const storedCtx = this.readStoredSessionCtx(entries, header, filepath);
    if (storedCtx !== null) return storedCtx;
    const legacyCtx = await materializedLegacyBrowserDraftCtxFromFile(entries, filepath);
    if (legacyCtx !== null) return legacyCtx;
    return SAFE_BROWSER_DRAFT_NATIVE_ID.test(header.id) && isPiTimestampNamedNativeSessionFile(filepath, header.id)
      ? QUARANTINED_BROWSER_DRAFT_CTX
      : null;
  }

  private readStoredSessionCtx(entries: (SessionHeader | SessionEntry)[], header?: SessionHeader, filepath?: string): StoredSessionCtx {
    const resolvedHeader = header ?? entries.find((entry): entry is SessionHeader => entry.type === "session");
    const nativeId = resolvedHeader?.id;
    const untrustedBrowserDraftNative = Boolean(
      nativeId
      && filepath
      && SAFE_BROWSER_DRAFT_NATIVE_ID.test(nativeId)
      && isPiTimestampNamedNativeSessionFile(filepath, nativeId),
    );
    const headerCtx = untrustedBrowserDraftNative ? null : readHeaderSessionCtx(resolvedHeader);
    if (headerCtx !== null) return headerCtx;
    const sidecarCtx = nativeId ? this.readNativeSessionScopeMetadataSync(nativeId) : null;
    if (sidecarCtx !== null) return sidecarCtx;
    const legacyCtx = extractLegacyBrowserDraftSessionCtx(entries);
    if (legacyCtx !== null) {
      const sessionEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
      return entriesHaveAssistantMessage(sessionEntries) ? legacyCtx : null;
    }
    // A materialized browser-memory draft uses a brdraft_* native Pi id before
    // Boring has written its private owner sidecar. If that sidecar is missing
    // or unreadable, fail closed instead of treating the transcript as a legacy
    // default-session file and exposing its title/summary to default context.
    if (untrustedBrowserDraftNative) return QUARANTINED_BROWSER_DRAFT_CTX;
    return null;
  }

  private async persistLegacyNativeScopeMetadataIfNeeded(
    entries: (SessionHeader | SessionEntry)[],
    sessionId: string,
    filepath: string,
  ): Promise<void> {
    if (this.hasNativeSessionScopeMetadataSync(sessionId)) return;
    const legacyCtx = extractLegacyBrowserDraftSessionCtx(entries);
    if (!legacyCtx?.workspaceId || !legacyCtx.userId) return;
    await this.saveNativeSessionScopeMetadataAfterAssistantCommit(legacyCtx, sessionId, filepath).catch(() => {});
  }

  private storedCtxBelongsToCtx(storedCtx: StoredSessionCtx, ctx: SessionCtx, sessionId?: string): boolean {
    if (storedCtx === QUARANTINED_BROWSER_DRAFT_CTX) return false;
    if (storedCtx === null) {
      return this.allowLegacyUnscopedAccess && isLegacyUnscopedCtx(ctx);
    }
    return sameSessionCtx(storedCtx, ctx);
  }
}

/**
 * Scans JSONL from EOF to header in fixed-size chunks. Memory remains bounded
 * even when a transcript contains huge message records; session_info records
 * are small metadata lines (the Boring API limits titles to 200 characters).
 */
async function readLatestSessionInfo(filepath: string, size: number): Promise<SessionInfoEntry | undefined> {
  if (size <= 0) return undefined;
  const handle = await open(filepath, "r");
  try {
    let end = size;
    let partialFirstLine = Buffer.alloc(0);
    let discardPartialFirstLine = false;
    while (end > 0) {
      const start = Math.max(0, end - SUMMARY_PREFIX_BYTES);
      const length = end - start;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      const chunk = discardPartialFirstLine
        ? buffer.subarray(0, bytesRead)
        : Buffer.concat([buffer.subarray(0, bytesRead), partialFirstLine]);
      const newlineOffsets: number[] = [];
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] === 0x0a) newlineOffsets.push(index);
      }
      const lineEndOffsets = [...newlineOffsets];
      if (end === size && lineEndOffsets[lineEndOffsets.length - 1] !== chunk.length - 1) lineEndOffsets.push(chunk.length);
      for (let index = lineEndOffsets.length - 1; index >= 0; index -= 1) {
        const lineStart = index === 0 ? 0 : lineEndOffsets[index - 1] + 1;
        if (lineStart === 0 && start > 0) continue;
        if (discardPartialFirstLine && lineEndOffsets[index] === chunk.length) continue;
        const line = chunk.subarray(lineStart, lineEndOffsets[index]).toString("utf-8").trim();
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as SessionEntry;
          if (entry.type === "session_info" && typeof (entry as SessionInfoEntry).name === "string") {
            return entry as SessionInfoEntry;
          }
        } catch {
          // Ignore malformed concurrent/truncated tail lines and continue scanning.
        }
      }
      const firstNewline = newlineOffsets[0];
      partialFirstLine = firstNewline === undefined ? chunk : chunk.subarray(0, firstNewline);
      discardPartialFirstLine = partialFirstLine.length > MAX_SESSION_INFO_LINE_BYTES;
      if (discardPartialFirstLine) partialFirstLine = Buffer.alloc(0);
      end = start;
    }
    if (!partialFirstLine.length || discardPartialFirstLine) return undefined;
    try {
      const entry = JSON.parse(partialFirstLine.toString("utf-8")) as SessionEntry;
      return entry.type === "session_info" && typeof (entry as SessionInfoEntry).name === "string"
        ? entry as SessionInfoEntry
        : undefined;
    } catch {
      return undefined;
    }
  } finally {
    await handle.close();
  }
}

async function readJsonlPrefix(filepath: string, maxBytes = SUMMARY_PREFIX_BYTES): Promise<string> {
  const handle = await open(filepath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    let content = buffer.subarray(0, bytesRead).toString("utf-8");
    if (bytesRead === maxBytes) {
      const lastNewline = content.lastIndexOf("\n");
      if (lastNewline >= 0) content = content.slice(0, lastNewline + 1);
    }
    return content;
  } finally {
    await handle.close();
  }
}

function readJsonlPrefixSync(filepath: string, maxBytes = SUMMARY_PREFIX_BYTES): string {
  const fd = openSync(filepath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    let content = buffer.subarray(0, bytesRead).toString("utf-8");
    if (bytesRead === maxBytes) {
      const lastNewline = content.lastIndexOf("\n");
      if (lastNewline >= 0) content = content.slice(0, lastNewline + 1);
    }
    return content;
  } finally {
    closeSync(fd);
  }
}

function extractPiSessionFilePath(entries: (SessionHeader | SessionEntry)[]): string | null {
  let piFilePath: string | null = null;
  for (const e of entries) {
    const rec = e as { type?: string; path?: string };
    if (rec.type === "pi_session_file" && typeof rec.path === "string") {
      piFilePath = rec.path;
    }
  }
  return piFilePath;
}

function readHeaderSessionCtx(header: SessionHeader | undefined): StoredSessionCtx {
  if (!header || !Object.prototype.hasOwnProperty.call(header, "boringSessionCtx")) return null;
  const raw = (header as { boringSessionCtx?: unknown }).boringSessionCtx;
  if (!raw || typeof raw !== "object") return {};
  return normalizeSessionCtx(raw as SessionCtx) ?? {};
}

function hasMaterializedLegacyBrowserDraftScope(entries: (SessionHeader | SessionEntry)[]): boolean {
  const sessionEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
  return entriesHaveAssistantMessage(sessionEntries) && extractLegacyBrowserDraftSessionCtx(entries) !== null;
}

async function materializedLegacyBrowserDraftCtxFromFile(
  entries: (SessionHeader | SessionEntry)[],
  filepath: string,
): Promise<SessionCtx | null> {
  const legacyCtx = extractLegacyBrowserDraftSessionCtx(entries);
  if (legacyCtx === null) return null;
  return await fileHasAssistantMessage(filepath) ? legacyCtx : null;
}

function extractLegacyBrowserDraftSessionCtx(entries: (SessionHeader | SessionEntry)[]): SessionCtx | null {
  for (const entry of entries) {
    const record = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (record.type !== "custom" || record.customType !== LEGACY_BROWSER_DRAFT_SCOPE_CUSTOM_TYPE) continue;
    if (!record.data || typeof record.data !== "object") return null;
    return normalizeSessionCtx(record.data as SessionCtx) ?? null;
  }
  return null;
}

function normalizeSessionCtx(ctx: SessionCtx | undefined): SessionCtx | undefined {
  if (!ctx?.workspaceId && !ctx?.userId && !ctx?.storageScope) return undefined;
  return {
    ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.storageScope ? { storageScope: ctx.storageScope } : {}),
  };
}

async function fileExists(filepath: string): Promise<boolean> {
  try {
    await fsStat(filepath);
    return true;
  } catch {
    return false;
  }
}

async function safeJsonlSessionFiles(sessionDir: string): Promise<SessionFileStat[]> {
  const root = await realpath(sessionDir).catch(() => null);
  if (!root) return [];
  const files = await readdir(sessionDir).catch(() => []);
  const result: SessionFileStat[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl") || file.includes("/")) continue;
    const filepath = join(sessionDir, file);
    try {
      const lst = await lstat(filepath);
      if (!lst.isFile() || lst.isSymbolicLink()) continue;
      const real = await realpath(filepath);
      if (!pathContainedBy(real, root)) continue;
      result.push({ filepath, stat: await fsStat(filepath) });
    } catch {
      // Ignore racing, unreadable, or containment-invalid files.
    }
  }
  return result;
}

async function safeSessionFilePath(sessionDir: string, filepath: string): Promise<boolean> {
  try {
    const [root, lst, real] = await Promise.all([realpath(sessionDir), lstat(filepath), realpath(filepath)]);
    return lst.isFile() && !lst.isSymbolicLink() && pathContainedBy(real, root);
  } catch {
    return false;
  }
}

function safeSessionFilePathSync(sessionDir: string, filepath: string): boolean {
  try {
    const root = realpathSync(sessionDir);
    const lst = lstatSync(filepath);
    const real = realpathSync(filepath);
    return lst.isFile() && !lst.isSymbolicLink() && pathContainedBy(real, root);
  } catch {
    return false;
  }
}

function safeJsonlSessionFilesSync(sessionDir: string): SessionFileStat[] {
  let root: string;
  try {
    root = realpathSync(sessionDir);
  } catch {
    return [];
  }
  const result: SessionFileStat[] = [];
  for (const file of readdirSync(sessionDir)) {
    if (!file.endsWith(".jsonl") || file.includes("/")) continue;
    const filepath = join(sessionDir, file);
    try {
      const lst = lstatSync(filepath);
      if (!lst.isFile() || lst.isSymbolicLink()) continue;
      const real = realpathSync(filepath);
      if (!pathContainedBy(real, root)) continue;
      result.push({ filepath, stat: fsStatSyncCompat(filepath) });
    } catch {
      // Ignore racing, unreadable, or containment-invalid files.
    }
  }
  return result;
}

function fsStatSyncCompat(filepath: string): Awaited<ReturnType<typeof fsStat>> {
  return lstatSync(filepath) as Awaited<ReturnType<typeof fsStat>>;
}

function pathContainedBy(path: string, root: string): boolean {
  return path === root || isPathInside(path, root);
}

async function sessionFileMayClaimId(filepath: string, sessionId: string): Promise<boolean> {
  const filename = basename(filepath);
  if (filename === `${sessionId}.jsonl` || filename.endsWith(`_${sessionId}.jsonl`)) return true;
  const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
  return extractSessionHeaderId(entries) === sessionId;
}

function sessionFileMayClaimIdSync(filepath: string, sessionId: string): boolean {
  const filename = basename(filepath);
  if (filename === `${sessionId}.jsonl` || filename.endsWith(`_${sessionId}.jsonl`)) return true;
  const entries = parseJsonlPrefixEntries(readJsonlPrefixSync(filepath));
  return extractSessionHeaderId(entries) === sessionId;
}

function nativeFilenameMatchesHeader(filepath: string, header: SessionHeader): boolean {
  const name = basename(filepath);
  return name.endsWith(`_${header.id}.jsonl`) || name === `${header.id}.jsonl`;
}

function assertMetadataRootDoesNotOverlapSessionRoots(metadataRoot: string, sessionRoots: string[]): void {
  const metadata = resolvePhysicalPathForOverlapSync(metadataRoot);
  for (const root of sessionRoots) {
    const session = resolvePhysicalPathForOverlapSync(root);
    if (metadata === session || isPathInside(metadata, session) || isPathInside(session, metadata)) {
      throw new Error("private native session metadata root must not overlap Pi session roots");
    }
  }
}

function resolvePhysicalPathForOverlapSync(target: string): string {
  const resolved = resolve(target);
  const chain = pathChain(resolved);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]!;
    try {
      lstatSync(candidate);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") continue;
      throw error;
    }
    const physicalBase = realpathSync(candidate);
    const remainder = relative(candidate, resolved);
    return remainder ? resolve(physicalBase, remainder) : physicalBase;
  }
  return resolved;
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/") && !rel.match(/^[A-Za-z]:/);
}

function ensurePrivateMetadataDirSync(dir: string, privateRoot: string): void {
  ensurePrivateMetadataPathSync(dir, privateRoot);
  fsyncDirectorySync(dirname(dir));
}

async function ensurePrivateMetadataDir(dir: string, privateRoot: string): Promise<void> {
  await ensurePrivateMetadataPath(dir, privateRoot);
  await fsyncDirectory(dirname(dir));
}

function assertPrivateMetadataDirUsableSync(dir: string, privateRoot: string): void {
  validatePrivateMetadataPathSync(dir, privateRoot, false);
}

function ensurePrivateMetadataPathSync(dir: string, privateRoot: string): void {
  const chain = pathChain(dir);
  for (const segment of chain) {
    try {
      const stat = lstatSync(segment);
      assertSafePrivateMetadataPathSegment(segment, stat, isPathPrivate(segment, privateRoot));
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      const parent = dirname(segment);
      assertNoFollowDirectorySync(parent);
      mkdirSync(segment, { mode: 0o700 });
      const stat = lstatSync(segment);
      assertSafePrivateMetadataPathSegment(segment, stat, true);
    }
  }
}

async function ensurePrivateMetadataPath(dir: string, privateRoot: string): Promise<void> {
  const chain = pathChain(dir);
  for (const segment of chain) {
    try {
      const stat = await lstat(segment);
      assertSafePrivateMetadataPathSegment(segment, stat, isPathPrivate(segment, privateRoot));
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      const parent = dirname(segment);
      await assertNoFollowDirectory(parent);
      await mkdir(segment, { mode: 0o700 });
      const stat = await lstat(segment);
      assertSafePrivateMetadataPathSegment(segment, stat, true);
    }
  }
}

function validatePrivateMetadataPathSync(dir: string, privateRoot: string, requireLeaf: boolean): void {
  const chain = pathChain(dir);
  for (const segment of chain) {
    try {
      const stat = lstatSync(segment);
      assertSafePrivateMetadataPathSegment(segment, stat, isPathPrivate(segment, privateRoot));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT" && !requireLeaf) return;
      throw error;
    }
  }
}

function pathChain(target: string): string[] {
  const resolved = resolve(target);
  const root = resolve(resolved, "/");
  const relativePath = relative(root, resolved);
  if (!relativePath) return [root];
  const chain = [root];
  let current = root;
  for (const part of relativePath.split(/[\\/]+/)) {
    current = join(current, part);
    chain.push(current);
  }
  return chain;
}

function isPathPrivate(path: string, privateRoot: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(privateRoot);
  return resolvedPath === resolvedRoot || isPathInside(resolvedPath, resolvedRoot);
}

function assertSafePrivateMetadataPathSegment(path: string, stat: { isDirectory(): boolean; isSymbolicLink(): boolean; mode: number; uid: number }, strictPrivate: boolean): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("private native session metadata path contains a non-directory or symlink");
  const mode = stat.mode & 0o7777;
  if (strictPrivate) {
    assertOwnedByCurrentProcess(stat.uid);
    if ((mode & 0o077) !== 0) throw new Error("private native session metadata path has unsafe permissions");
    return;
  }
  assertOwnedByCurrentProcessOrRoot(stat.uid);
  if ((mode & 0o022) !== 0 && (mode & 0o1000) === 0) {
    throw new Error("private native session metadata parent has unsafe permissions");
  }
}

function assertNoFollowDirectorySync(dir: string): void {
  const fd = openSync(dir, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  closeSync(fd);
}

async function assertNoFollowDirectory(dir: string): Promise<void> {
  const handle = await open(dir, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  await handle.close();
}

function assertOwnedByCurrentProcess(ownerUid: number): void {
  const getuid = process.getuid;
  if (typeof getuid !== "function") return;
  if (ownerUid !== getuid()) throw new Error("private native session metadata root is not owned by the current user");
}

function assertOwnedByCurrentProcessOrRoot(ownerUid: number): void {
  const getuid = process.getuid;
  if (typeof getuid !== "function") return;
  if (ownerUid !== 0 && ownerUid !== getuid()) throw new Error("private native session metadata parent is not owned by root or the current user");
}

function fsyncDirectorySync(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    fsyncSync(fd);
  } catch {
    // Some platforms/filesystems reject directory fsync; best effort after the no-follow open.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

async function fsyncDirectory(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(dir, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
    await handle.sync();
  } catch {
    // Some platforms/filesystems reject directory fsync; best effort after the no-follow open.
  } finally {
    await handle?.close().catch(() => {});
  }
}

function sameSessionCtx(a: SessionCtx | undefined, b: SessionCtx | undefined): boolean {
  return (a?.workspaceId ?? "") === (b?.workspaceId ?? "")
    && (a?.userId ?? "") === (b?.userId ?? "")
    && (a?.storageScope ?? "") === (b?.storageScope ?? "");
}

function isEmptySessionCtx(ctx: SessionCtx | undefined): boolean {
  return !ctx?.workspaceId && !ctx?.userId && !ctx?.storageScope;
}

function isLegacyUnscopedCtx(ctx: SessionCtx | undefined): boolean {
  return isEmptySessionCtx(ctx) || (ctx?.workspaceId === DEFAULT_LEGACY_WORKSPACE_ID && !ctx.userId && !ctx.storageScope);
}

function extractSessionHeaderId(entries: (SessionHeader | SessionEntry)[]): string | null {
  const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
  return header?.id ?? null;
}

function entriesHaveAssistantMessage(entries: SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === "message" && ((entry as SessionMessageEntry).message as any)?.role === "assistant");
}

async function fileHasAssistantMessage(filepath: string): Promise<boolean> {
  const lines = createInterface({ input: createReadStream(filepath, { encoding: "utf-8" }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as SessionEntry;
        if (entry.type === "message" && ((entry as SessionMessageEntry).message as any)?.role === "assistant") return true;
      } catch {
        // Ignore malformed concurrent/truncated lines and keep scanning.
      }
    }
  } catch {
    return false;
  } finally {
    lines.close();
  }
  return false;
}

function fileHasAssistantMessageSync(filepath: string): boolean {
  try {
    for (const line of readFileSync(filepath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as SessionEntry;
        if (entry.type === "message" && ((entry as SessionMessageEntry).message as any)?.role === "assistant") return true;
      } catch {
        // Ignore malformed concurrent/truncated lines and keep scanning.
      }
    }
  } catch {
    return false;
  }
  return false;
}

function isTimestampNamedPiSessionFile(filepath: string, sessionId: string): boolean {
  return isPiTimestampNamedNativeSessionFile(filepath, sessionId);
}

function isPiTimestampNamedNativeSessionFile(filepath: string, sessionId: string): boolean {
  const suffix = `_${sessionId}.jsonl`;
  const name = basename(filepath);
  if (!name.endsWith(suffix)) return false;
  const prefix = name.slice(0, -suffix.length);
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(prefix);
}

function countUserTurns(entries: SessionEntry[]): number {
  return entries.filter(
    (e) => e.type === "message" && ((e as SessionMessageEntry).message as any)?.role === "user",
  ).length;
}

function extractTitle(entries: SessionEntry[]): string | undefined {
  const last = entries
    .filter((e): e is SessionInfoEntry => e.type === "session_info")
    .pop();
  return last?.name;
}

function firstUserMessage(entries: SessionEntry[]): string | undefined {
  for (const e of entries) {
    if (e.type !== "message") continue;
    const msg = (e as SessionMessageEntry).message as any;
    if (msg?.role !== "user") continue;
    const text = textFromPiContent(msg.content);
    if (text) return text.slice(0, 80);
  }
}

function safeParseEntries(
  content: string,
): (SessionHeader | SessionEntry)[] {
  try {
    return parseSessionEntries(content);
  } catch {
    const results: (SessionHeader | SessionEntry)[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        results.push(JSON.parse(line));
      } catch {
        // Skip malformed lines silently
      }
    }
    return results;
  }
}

function parseJsonlPrefixEntries(content: string): (SessionHeader | SessionEntry)[] {
  const entries: (SessionHeader | SessionEntry)[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Prefix summaries should tolerate malformed or truncated tail lines.
    }
  }
  return entries;
}

function textFromPiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const item = part as { type?: unknown; text?: unknown } | null;
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .join("");
}

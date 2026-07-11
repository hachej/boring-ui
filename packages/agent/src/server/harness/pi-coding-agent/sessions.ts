import { randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  stat as fsStat,
  rm,
  mkdir,
  writeFile,
  appendFile,
  rename,
  open,
} from "node:fs/promises";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
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

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const SAFE_SESSION_NAMESPACE = /^[a-zA-Z0-9_-]+$/;
const SESSION_ROOT_ENV = "BORING_AGENT_SESSION_ROOT";
const SUMMARY_PREFIX_BYTES = 64 * 1024;
const MAX_SESSION_INFO_LINE_BYTES = 64 * 1024;
const DEFAULT_LEGACY_WORKSPACE_ID = "default";

type SessionFileStat = { filepath: string; stat: Awaited<ReturnType<typeof fsStat>> };
type StoredSessionCtx = SessionCtx | null;

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

  constructor(cwd: string, options?: string | PiSessionStoreOptions) {
    this.cwd = cwd;
    if (typeof options === "string") {
      this.sessionDir = options;
      this.allowLegacyUnscopedAccess = true;
      return;
    }
    this.allowLegacyUnscopedAccess = true;
    this.sessionDir = options?.sessionDir
      ?? (options?.sessionNamespace
        ? sessionDirForNamespace(options.sessionNamespace, options.sessionRoot)
        : defaultSessionDir(options?.storageCwd ?? cwd, options?.sessionRoot));
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  async list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]> {
    const normalizedOptions = normalizeListOptions(options);
    const inFlightKey = JSON.stringify([
      ctx.workspaceId,
      ctx.userId ?? null,
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
    const files = await readdir(this.sessionDir).catch(() => []);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const filepaths = jsonlFiles.map((f) => join(this.sessionDir, f));
    const fileStats = await Promise.all(filepaths.map(async (filepath) => {
      try {
        return { filepath, stat: await fsStat(filepath) };
      } catch {
        return null;
      }
    }));
    const existingFiles = fileStats
      .filter((item): item is NonNullable<typeof item> => item !== null);
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
    };
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const resolved = await this.resolveSessionTranscript(ctx, sessionId);
    const title =
      extractTitle(resolved.linkedEntries) ?? extractTitle(resolved.sessionEntries) ?? "New session";
    const turnCount = countUserTurns(resolved.transcriptEntries);
    const updatedAtMs = Math.max(resolved.fileStat.mtime.getTime(), resolved.linkedMtimeMs ?? 0);

    return {
      id: resolved.resolvedSessionId,
      title,
      createdAt: resolved.header?.timestamp ?? resolved.fileStat.birthtime.toISOString(),
      updatedAt: new Date(updatedAtMs).toISOString(),
      turnCount,
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
    if (!this.headerBelongsToCtx(header, ctx)) throw new Error(`Session not found: ${sessionId}`);
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
      const direct = join(this.sessionDir, `${sessionId}.jsonl`);
      let filepath = direct;
      let content: string;
      try {
        content = readFileSync(direct, "utf-8");
      } catch {
        const files = readdirSync(this.sessionDir).filter((f) =>
          f.endsWith(`_${sessionId}.jsonl`) || f === `${sessionId}.jsonl`,
        );
        if (files.length === 0) return null;
        filepath = join(this.sessionDir, files[0]);
        content = readFileSync(filepath, "utf-8");
      }
      const entries = safeParseEntries(content);
      const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
      if (extractSessionHeaderId(entries) !== sessionId) return null;
      if (!this.headerBelongsToCtx(header, ctx)) return null;

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
      const direct = join(this.sessionDir, `${sessionId}.jsonl`);
      let filepath = direct;
      let content: string;
      try {
        content = readFileSync(direct, "utf-8");
      } catch {
        const files = readdirSync(this.sessionDir).filter((f) =>
          f.endsWith(`_${sessionId}.jsonl`) || f === `${sessionId}.jsonl`,
        );
        if (files.length === 0) return null;
        filepath = join(this.sessionDir, files[0]);
        content = readFileSync(filepath, "utf-8");
      }
      const entries = safeParseEntries(content);
      const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
      if (!this.headerBelongsToCtx(header, ctx)) return null;
      const linkedPiFile = extractPiSessionFilePath(entries);
      if (linkedPiFile) return linkedPiFile;
      if (!isTimestampNamedPiSessionFile(filepath, sessionId)) return null;
      const existingWrapper = this.findWrapperReferencingNativeSessionSync(filepath);
      if (existingWrapper) {
        const existingEntries = parseJsonlPrefixEntries(readJsonlPrefixSync(existingWrapper));
        if (extractSessionHeaderId(existingEntries) !== sessionId) return null;
        const wrapperHeader = existingEntries.find((entry): entry is SessionHeader => entry.type === "session");
        if (!this.headerBelongsToCtx(wrapperHeader, ctx)) return null;
        return extractPiSessionFilePath(existingEntries);
      }
      this.ensureWrapperForNativeSessionSync(sessionId, filepath, entries, ctx);
      return filepath;
    } catch {
      return null;
    }
  }

  async loadPiSessionFile(ctx: SessionCtx, sessionId: string): Promise<string | null> {
    if (!SAFE_ID.test(sessionId)) return null;
    try {
      const direct = join(this.sessionDir, `${sessionId}.jsonl`);
      let filepath = direct;
      let content: string;
      try {
        content = await readFile(direct, "utf-8");
      } catch {
        const files = await readdir(this.sessionDir).catch(() => []);
        const match = files.find((f) =>
          f.endsWith(`_${sessionId}.jsonl`) || f === `${sessionId}.jsonl`,
        );
        if (!match) return null;
        filepath = join(this.sessionDir, match);
        content = await readFile(filepath, "utf-8");
      }
      const entries = safeParseEntries(content);
      const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
      if (!this.headerBelongsToCtx(header, ctx)) return null;
      const linkedPiFile = extractPiSessionFilePath(entries);
      if (linkedPiFile) return linkedPiFile;
      if (!isTimestampNamedPiSessionFile(filepath, sessionId)) return null;
      const existingWrapper = await this.findWrapperReferencingNativeSession(filepath);
      if (existingWrapper) {
        const wrapperSessionId = await this.readSessionFileId(existingWrapper);
        if (wrapperSessionId !== sessionId) return null;
        const wrapperEntries = parseJsonlPrefixEntries(await readJsonlPrefix(existingWrapper));
        const wrapperHeader = wrapperEntries.find((entry): entry is SessionHeader => entry.type === "session");
        if (!this.headerBelongsToCtx(wrapperHeader, ctx)) return null;
        return extractPiSessionFilePath(wrapperEntries);
      }
      return await this.ensureWrapperForNativeSession(sessionId, filepath, ctx);
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

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    const filepath = await this.resolveSessionFile(sessionId, ctx).catch(
      () => null,
    );
    if (!filepath) return;
    const fileSessionId = await this.readSessionFileId(filepath);
    if (fileSessionId && fileSessionId !== sessionId) return;
    const linkedPiFile = await this.linkedPiFileFor(filepath);
    await rm(filepath, { force: true });
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
    const direct = join(this.sessionDir, `${sessionId}.jsonl`);
    try {
      await fsStat(direct);
      if (ctx) await this.assertFileBelongsToCtx(direct, ctx, sessionId);
      return direct;
    } catch {
      // Pi uses ${timestamp}_${id}.jsonl naming
    }
    const files = await readdir(this.sessionDir).catch(() => []);
    const match = files.find(
      (f) => f.endsWith(`_${sessionId}.jsonl`) || f === `${sessionId}.jsonl`,
    );
    if (!match) throw new Error(`Session not found: ${sessionId}`);
    const matchedPath = join(this.sessionDir, match);
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
    return this.ensureWrapperForNativeSession(sessionId, matchedPath, ctx);
  }

  private async assertFileBelongsToCtx(filepath: string, ctx: SessionCtx, sessionId: string): Promise<void> {
    const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
    const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
    if (!this.headerBelongsToCtx(header, ctx)) throw new Error(`Session not found: ${sessionId}`);
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
        && this.storedCtxBelongsToCtx(cached.sessionCtx, ctx)
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
      const sessionCtx = readHeaderSessionCtx(header);
      if (!this.storedCtxBelongsToCtx(sessionCtx, ctx)) return null;

      const entries = parseJsonlPrefixEntries(content);
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

      const summary = {
        id: header.id,
        title,
        createdAt: header.timestamp,
        updatedAt: new Date(updatedAtMs).toISOString(),
        turnCount,
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
      sessionCtx: readHeaderSessionCtx(entries.find((item): item is SessionHeader => item.type === "session")),
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
      const files = readdirSync(this.sessionDir).filter((file) => file.endsWith(".jsonl"));
      for (const file of files) {
        const filepath = join(this.sessionDir, file);
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
    const files = await readdir(this.sessionDir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filepath = join(this.sessionDir, file);
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

  private ensureWrapperForNativeSessionSync(
    sessionId: string,
    nativePath: string,
    entries: (SessionHeader | SessionEntry)[],
    ctx: SessionCtx,
  ): string {
    const wrapperPath = join(this.sessionDir, `${sessionId}.jsonl`);
    if (resolve(wrapperPath) === resolve(nativePath)) return wrapperPath;
    try {
      readFileSync(wrapperPath, "utf-8");
      return wrapperPath;
    } catch {
      // Create the metadata wrapper below.
    }
    try {
      writeFileSync(
        wrapperPath,
        buildNativePiSessionWrapper(sessionId, this.cwd, nativePath, entries, ctx),
        { encoding: "utf-8", flag: "wx" },
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
    this.prefixCache.delete(wrapperPath);
    return wrapperPath;
  }

  private async ensureWrapperForNativeSession(sessionId: string, nativePath: string, ctx?: SessionCtx): Promise<string> {
    const wrapperPath = join(this.sessionDir, `${sessionId}.jsonl`);
    if (resolve(wrapperPath) === resolve(nativePath)) return wrapperPath;
    try {
      await fsStat(wrapperPath);
      return wrapperPath;
    } catch {
      // Create the metadata wrapper below.
    }

    const entries = parseJsonlPrefixEntries(await readJsonlPrefix(nativePath));
    try {
      await writeFile(
        wrapperPath,
        buildNativePiSessionWrapper(sessionId, this.cwd, nativePath, entries, ctx),
        { encoding: "utf-8", flag: "wx" },
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
    this.prefixCache.delete(wrapperPath);
    return wrapperPath;
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

  private headerBelongsToCtx(header: SessionHeader | undefined, ctx: SessionCtx): boolean {
    return header ? this.storedCtxBelongsToCtx(readHeaderSessionCtx(header), ctx) : isEmptySessionCtx(ctx);
  }

  private storedCtxBelongsToCtx(storedCtx: StoredSessionCtx, ctx: SessionCtx): boolean {
    if (storedCtx === null) return this.allowLegacyUnscopedAccess && isLegacyUnscopedCtx(ctx);
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

function normalizeSessionCtx(ctx: SessionCtx | undefined): SessionCtx | undefined {
  if (!ctx?.workspaceId && !ctx?.userId) return undefined;
  return {
    ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
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

function sameSessionCtx(a: SessionCtx | undefined, b: SessionCtx | undefined): boolean {
  return (a?.workspaceId ?? "") === (b?.workspaceId ?? "") && (a?.userId ?? "") === (b?.userId ?? "");
}

function isEmptySessionCtx(ctx: SessionCtx | undefined): boolean {
  return !ctx?.workspaceId && !ctx?.userId;
}

function isLegacyUnscopedCtx(ctx: SessionCtx | undefined): boolean {
  return isEmptySessionCtx(ctx) || (ctx?.workspaceId === DEFAULT_LEGACY_WORKSPACE_ID && !ctx.userId);
}

function buildNativePiSessionWrapper(
  sessionId: string,
  cwd: string,
  piFilePath: string,
  entries: (SessionHeader | SessionEntry)[],
  ctx?: SessionCtx,
): string {
  const nativeHeader = entries.find((entry): entry is SessionHeader => entry.type === "session");
  const timestamp = nativeHeader?.timestamp ?? new Date().toISOString();
  const header: SessionHeader & { boringSessionCtx?: SessionCtx } = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp,
      cwd: nativeHeader?.cwd ?? cwd,
      ...(ctx !== undefined ? { boringSessionCtx: normalizeSessionCtx(ctx) ?? {} } : {}),
    };
  return [
    header,
    {
      type: "pi_session_file",
      timestamp,
      path: piFilePath,
    },
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function extractSessionHeaderId(entries: (SessionHeader | SessionEntry)[]): string | null {
  const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
  return header?.id ?? null;
}

function isTimestampNamedPiSessionFile(filepath: string, sessionId: string): boolean {
  return basename(filepath).endsWith(`_${sessionId}.jsonl`);
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

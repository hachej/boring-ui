import { createHash, randomUUID } from "node:crypto";
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
import { closeSync, createReadStream, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { getEnv } from "../../config/env.js";
import {
  SessionManager,
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

export interface PiSessionAttachment {
  data: Buffer;
  mediaType: string;
  filename?: string;
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
const ACTIVITY_CHECKPOINT_BYTES = 4 * 1024;
const MAX_JSONL_NESTING_DEPTH = 100;
const DEFAULT_LEGACY_WORKSPACE_ID = "default";

type SessionFileStat = { filepath: string; stat: Awaited<ReturnType<typeof fsStat>> };
type StoredSessionCtx = SessionCtx | null;

interface PrefixCacheEntry {
  mtimeMs: number;
  size: number;
  identity: string;
  referencedPiFile: string | null;
  headerTimestamp?: string;
  sessionCtx?: StoredSessionCtx;
  linkedMtimeMs?: number;
  linkedSize?: number;
  activitySummary?: StreamedJsonlSummary;
  activitySummarySize?: number;
  activityFileSize?: number;
  activityMtimeMs?: number;
  activityIdentity?: string;
  activityCheckpoint?: string;
  linkedActivitySummary?: StreamedJsonlSummary;
  linkedActivitySummarySize?: number;
  linkedActivityFileSize?: number;
  linkedActivityMtimeMs?: number;
  linkedActivityIdentity?: string;
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
  /** Direct/local composition capability for bare Pi-owned transcripts. */
  allowNativeUnscopedAccess?: boolean;
}

export class PiSessionStore implements SessionStore {
  private cwd: string;
  private sessionDir: string;
  private allowLegacyUnscopedAccess: boolean;
  private allowNativeUnscopedAccess: boolean;
  private prefixCache = new Map<string, PrefixCacheEntry>();
  private listInFlight = new Map<string, Promise<SessionSummary[]>>();

  constructor(cwd: string, options?: string | PiSessionStoreOptions) {
    this.cwd = cwd;
    if (typeof options === "string") {
      this.sessionDir = options;
      this.allowLegacyUnscopedAccess = true;
      this.allowNativeUnscopedAccess = false;
      return;
    }
    this.allowLegacyUnscopedAccess = true;
    // Bare Pi transcripts have no Boring session context. A namespace/directory
    // only chooses storage; it never grants access to those unscoped files.
    this.allowNativeUnscopedAccess = options?.allowNativeUnscopedAccess === true;
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
        sortActivityMs: await this.sessionSortActivityMs(file),
      })));
    visibleFiles.sort((a, b) => b.sortActivityMs - a.sortActivityMs || a.filepath.localeCompare(b.filepath));

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

  async rename(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary> {
    const filepath = await this.resolveSessionFile(sessionId, ctx);
    const linkedPiFile = await this.linkedPiFileFor(filepath);
    const target = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath) ? linkedPiFile : filepath;
    const manager = SessionManager.open(target, this.sessionDir, this.cwd);
    manager.appendSessionInfo(title);
    this.prefixCache.delete(filepath);
    this.prefixCache.delete(target);
    return this.load(ctx, sessionId);
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const resolved = await this.resolveSessionTranscript(ctx, sessionId);
    const activityEntries = resolved.linkedFilepath ? resolved.linkedEntries : resolved.sessionEntries;
    const title = extractTitle(activityEntries) ?? extractTitle(resolved.sessionEntries) ?? "New session";
    const turnCount = countUserTurns(resolved.transcriptEntries);
    const latestMessageTimestamp = latestMessageTimestampFromEntries(activityEntries);
    const directNative = isTimestampNamedPiSessionFile(resolved.filepath, resolved.resolvedSessionId)
      && resolved.linkedEntries.length === 0;

    return {
      id: resolved.resolvedSessionId,
      title,
      createdAt: resolved.header?.timestamp ?? resolved.fileStat.birthtime.toISOString(),
      updatedAt: activityTimestampOrFallback(
        latestMessageTimestamp,
        resolved.header?.timestamp,
        resolved.fileStat.birthtime.getTime(),
      ),
      turnCount,
      ...(directNative ? { nativeSessionId: resolved.resolvedSessionId, hasAssistantReply: hasAssistantReply(resolved.transcriptEntries) } : {}),
    };
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
      .map((entry) => withStableMessageId(entry.message, entry.id));
    return { id: resolved.resolvedSessionId, messages };
  }

  async loadAttachment(ctx: SessionCtx, sessionId: string, messageId: string, index: number): Promise<PiSessionAttachment> {
    const resolved = await this.resolveSessionTranscript(ctx, sessionId);
    const entry = resolved.transcriptEntries
      .filter((item): item is SessionMessageEntry => item.type === "message")
      .find((item) => item.id === messageId || messageIdFromPiMessage(item.message) === messageId);
    const part = entry ? piImagePartAt(entry.message, index) : null;
    if (!part) throw new Error(`Session attachment not found: ${sessionId}`);
    const data = imagePartBuffer(part);
    if (!data) throw new Error(`Session attachment not found: ${sessionId}`);
    return {
      data,
      mediaType: part.mimeType ?? "application/octet-stream",
      ...(part.filename ? { filename: part.filename } : {}),
    };
  }

  private async resolveSessionTranscript(ctx: SessionCtx, sessionId: string): Promise<{
    resolvedSessionId: string;
    header: SessionHeader | undefined;
    sessionEntries: SessionEntry[];
    linkedEntries: SessionEntry[];
    transcriptEntries: SessionEntry[];
    filepath: string;
    fileStat: Awaited<ReturnType<typeof fsStat>>;
    linkedMtimeMs?: number;
    linkedFilepath?: string;
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
    if (!this.headerBelongsToCtx(header, ctx, isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId))) throw new Error(`Session not found: ${sessionId}`);
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
      filepath,
      sessionEntries,
      linkedEntries,
      transcriptEntries,
      fileStat,
      linkedMtimeMs: linked?.mtime.getTime(),
      linkedFilepath: linkedPiFile ?? undefined,
    };
  }

  // Synchronous variant used during session initialization so that no async
  // I/O hop is introduced before createAgentSession (which would break test
  // timing when fake timers are in use). The file is tiny (metadata only).
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
      if (!this.headerBelongsToCtx(header, ctx, isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId))) return null;
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
      if (this.allowNativeUnscopedAccess) return filepath;
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
      if (!this.headerBelongsToCtx(header, ctx, isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId))) return null;
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
      if (this.allowNativeUnscopedAccess) return filepath;
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
    if (ctx) await this.assertFileBelongsToCtx(matchedPath, ctx, sessionId);
    return matchedPath;
  }

  private async assertFileBelongsToCtx(filepath: string, ctx: SessionCtx, sessionId: string): Promise<void> {
    const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
    const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
    if (!this.headerBelongsToCtx(header, ctx, isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId))) throw new Error(`Session not found: ${sessionId}`);
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

  private async sessionSortActivityMs({ filepath, stat }: SessionFileStat): Promise<number> {
    let headerTimestamp: string | undefined;
    try {
      const prefix = await this.readPrefixCache(filepath, stat);
      headerTimestamp = prefix.headerTimestamp;
      const linkedPiFile = prefix.referencedPiFile;
      const activity = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)
        ? await this.cachedActivitySummary(linkedPiFile, await fsStat(linkedPiFile), prefix, true)
        : await this.cachedActivitySummary(filepath, stat, prefix, false);
      return timestampMs(activity.latestMessageTimestamp)
        ?? timestampMs(headerTimestamp)
        ?? stat.birthtime.getTime();
    } catch {
      // The summary pass will ignore unreadable files; preserve a stable fallback here.
      return timestampMs(headerTimestamp) ?? stat.birthtime.getTime();
    }
  }

  private async cachedActivitySummary(
    filepath: string,
    fileStat: { size: number | bigint; mtime: Date; dev: number | bigint; ino: number | bigint },
    cache: PrefixCacheEntry,
    linked: boolean,
  ): Promise<StreamedJsonlSummary> {
    const priorSummary = linked ? cache.linkedActivitySummary : cache.activitySummary;
    const priorSize = linked ? cache.linkedActivitySummarySize : cache.activitySummarySize;
    const priorFileSize = linked ? cache.linkedActivityFileSize : cache.activityFileSize;
    const priorMtimeMs = linked ? cache.linkedActivityMtimeMs : cache.activityMtimeMs;
    const identity = fileIdentity(fileStat);
    const priorIdentity = linked ? cache.linkedActivityIdentity : cache.activityIdentity;
    const priorCheckpoint = linked ? undefined : cache.activityCheckpoint;
    const size = Number(fileStat.size);
    const unchanged = priorSummary !== undefined
      && priorSize !== undefined
      && priorFileSize === size
      && priorMtimeMs === fileStat.mtime.getTime()
      && priorIdentity === identity;
    const appendCandidate = !linked
      && priorSummary !== undefined
      && priorSize !== undefined
      && priorFileSize !== undefined
      && priorFileSize < size
      && priorIdentity === identity;
    // A linked transcript can be rewritten in its unchecked middle while
    // growing. Only direct native transcripts retain append checkpoints.
    const appended = appendCandidate
      && priorCheckpoint !== undefined
      && priorCheckpoint === await activityCheckpoint(filepath, priorFileSize);
    const result = await summarizeJsonlFromCache(
      filepath,
      size,
      unchanged || appended ? priorSummary : undefined,
      unchanged || appended ? priorSize : undefined,
    );
    const checkpoint = linked ? undefined : await activityCheckpoint(filepath, size);
    if (linked) {
      cache.linkedActivitySummary = result.summary;
      cache.linkedActivitySummarySize = result.nextStart;
      cache.linkedActivityFileSize = size;
      cache.linkedActivityMtimeMs = fileStat.mtime.getTime();
      cache.linkedActivityIdentity = identity;
    } else {
      cache.activitySummary = result.summary;
      cache.activitySummarySize = result.nextStart;
      cache.activityFileSize = size;
      cache.activityMtimeMs = fileStat.mtime.getTime();
      cache.activityIdentity = identity;
      cache.activityCheckpoint = checkpoint;
    }
    return result.summary;
  }

  private async summarizeFile(
    ctx: SessionCtx,
    filepath: string,
    existingStat?: Awaited<ReturnType<typeof fsStat>>,
  ): Promise<SessionSummary | null> {
    try {
      const fileStat = existingStat ?? await fsStat(filepath);
      const prior = this.prefixCache.get(filepath);
      const cached = this.cachedPrefix(filepath, fileStat);
      if (
        cached
        && "summary" in cached
        && cached.sessionCtx !== undefined
        && (this.storedCtxBelongsToCtx(cached.sessionCtx, ctx)
          || (cached.sessionCtx === null
            && cached.summary?.nativeSessionId !== undefined
            && this.allowNativeUnscopedAccess))
        && await this.cachedSummaryIsFresh(filepath, cached)
      ) {
        return cached.summary ?? null;
      }

      const activityCache = prior ?? await this.readPrefixCache(filepath, fileStat);
      const content = await readJsonlPrefix(filepath);

      const firstNewline = content.indexOf("\n");
      if (firstNewline === -1) return null;

      const header: SessionHeader = JSON.parse(
        content.slice(0, firstNewline),
      );
      if (header.type !== "session") return null;
      const sessionCtx = readHeaderSessionCtx(header);
      const timestampNamedPiFile = isTimestampNamedPiSessionFile(filepath, header.id);
      if (!this.headerBelongsToCtx(header, ctx, timestampNamedPiFile)) return null;

      const entries = parseJsonlPrefixEntries(content);
      const sessionEntries = entries.filter(
        (e): e is SessionEntry => e.type !== "session",
      );
      const linkedPiFile = extractPiSessionFilePath(entries);
      const linkedPiPath = linkedPiFile !== null && resolve(linkedPiFile) !== resolve(filepath)
        ? linkedPiFile
        : null;
      const linked = linkedPiPath
        ? await this.readLinkedPiSessionSummary(linkedPiPath)
        : null;
      const linkedEntries = linked?.entries.filter(
        (e): e is SessionEntry => e.type !== "session",
      ) ?? [];
      const directNative = timestampNamedPiFile && linkedPiPath === null;
      // The prefix deliberately avoids parsing arbitrarily large entries. For
      // a direct native transcript, stream JSONL summary metadata so a first
      // prompt beyond the prefix cannot erase its title, turn count, or
      // rename eligibility after a refresh.
      const streamedNativeSummary = directNative
        ? await this.cachedActivitySummary(filepath, fileStat, activityCache, false)
        : undefined;

      const activitySummary = directNative
        ? streamedNativeSummary
        : linked
          ? await this.cachedActivitySummary(linkedPiPath!, linked, activityCache, true)
          : await this.cachedActivitySummary(filepath, fileStat, activityCache, false);
      const title = directNative
        ? streamedNativeSummary?.lastTitle
          ?? extractTitle(sessionEntries)
          ?? firstUserMessage(sessionEntries)
          ?? streamedNativeSummary?.firstUserTitle
          ?? "New session"
        : linked
          ? activitySummary?.lastTitle
            ?? extractTitle(linkedEntries)
            ?? firstUserMessage(linkedEntries)
            ?? activitySummary?.firstUserTitle
            ?? extractTitle(sessionEntries)
            ?? firstUserMessage(sessionEntries)
            ?? "New session"
          : extractTitle(sessionEntries)
            ?? firstUserMessage(sessionEntries)
            ?? activitySummary?.firstUserTitle
            ?? "New session";

      const turnCount = directNative || linked
        ? activitySummary?.userTurnCount ?? 0
        : countUserTurns(sessionEntries);
      const latestMessageTimestamp = activitySummary?.latestMessageTimestamp;

      const summary = {
        id: header.id,
        title,
        createdAt: header.timestamp,
        updatedAt: activityTimestampOrFallback(
          latestMessageTimestamp,
          header.timestamp,
          fileStat.birthtime.getTime(),
        ),
        turnCount,
        ...(directNative ? {
          nativeSessionId: header.id,
          hasAssistantReply: streamedNativeSummary?.hasAssistantReply
            ?? hasAssistantReply(linkedEntries.length > 0 ? linkedEntries : sessionEntries),
        } : {}),
      };
      this.prefixCache.set(filepath, {
        mtimeMs: fileStat.mtime.getTime(),
        size: Number(fileStat.size),
        identity: fileIdentity(fileStat),
        referencedPiFile: linkedPiFile,
        headerTimestamp: header.timestamp,
        sessionCtx,
        ...(linked ? { linkedMtimeMs: linked.mtime.getTime(), linkedSize: linked.size } : {}),
        ...(activityCache.activitySummary !== undefined && activityCache.activitySummarySize !== undefined
          ? {
            activitySummary: activityCache.activitySummary,
            activitySummarySize: activityCache.activitySummarySize,
            activityFileSize: activityCache.activityFileSize,
            activityMtimeMs: activityCache.activityMtimeMs,
            activityIdentity: activityCache.activityIdentity,
            activityCheckpoint: activityCache.activityCheckpoint,
          }
          : {}),
        ...(activityCache.linkedActivitySummary !== undefined && activityCache.linkedActivitySummarySize !== undefined
          ? {
            linkedActivitySummary: activityCache.linkedActivitySummary,
            linkedActivitySummarySize: activityCache.linkedActivitySummarySize,
            linkedActivityFileSize: activityCache.linkedActivityFileSize,
            linkedActivityMtimeMs: activityCache.linkedActivityMtimeMs,
            linkedActivityIdentity: activityCache.linkedActivityIdentity,
          }
          : {}),
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
    if (
      cached.mtimeMs !== fileStat.mtime.getTime()
      || cached.size !== Number(fileStat.size)
      || cached.identity !== fileIdentity(fileStat)
    ) return undefined;
    return cached;
  }

  private async cachedSummaryIsFresh(filepath: string, cached: PrefixCacheEntry): Promise<boolean> {
    const linkedPiFile = cached.referencedPiFile;
    if (!linkedPiFile || resolve(linkedPiFile) === resolve(filepath)) return true;
    try {
      const linkedStat = await fsStat(linkedPiFile);
      return cached.linkedMtimeMs === linkedStat.mtime.getTime()
        && cached.linkedSize === Number(linkedStat.size)
        && cached.linkedActivityIdentity === fileIdentity(linkedStat);
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

    const previous = this.prefixCache.get(filepath);
    const content = await readJsonlPrefix(filepath);
    const entries = parseJsonlPrefixEntries(content);
    const entry: PrefixCacheEntry = {
      mtimeMs: fileStat.mtime.getTime(),
      size: Number(fileStat.size),
      identity: fileIdentity(fileStat),
      referencedPiFile: extractPiSessionFilePath(entries),
      headerTimestamp: entries.find((item): item is SessionHeader => item.type === "session")?.timestamp,
      sessionCtx: readHeaderSessionCtx(entries.find((item): item is SessionHeader => item.type === "session")),
      ...(previous?.activitySummary !== undefined && previous.activitySummarySize !== undefined
        ? {
          activitySummary: previous.activitySummary,
          activitySummarySize: previous.activitySummarySize,
          activityFileSize: previous.activityFileSize,
          activityMtimeMs: previous.activityMtimeMs,
          activityIdentity: previous.activityIdentity,
          activityCheckpoint: previous.activityCheckpoint,
        }
        : {}),
      ...(previous?.referencedPiFile === extractPiSessionFilePath(entries)
        && previous.linkedActivitySummary !== undefined
        && previous.linkedActivitySummarySize !== undefined
        ? {
          linkedActivitySummary: previous.linkedActivitySummary,
          linkedActivitySummarySize: previous.linkedActivitySummarySize,
          linkedActivityFileSize: previous.linkedActivityFileSize,
          linkedActivityMtimeMs: previous.linkedActivityMtimeMs,
          linkedActivityIdentity: previous.linkedActivityIdentity,
        }
        : {}),
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

  private async readLinkedPiSession(filepath: string): Promise<{
    entries: (SessionHeader | SessionEntry)[];
    mtime: Date;
    size: number;
    dev: number | bigint;
    ino: number | bigint;
  } | null> {
    try {
      const [fileStat, content] = await Promise.all([
        fsStat(filepath),
        readFile(filepath, "utf-8"),
      ]);
      return {
        entries: safeParseEntries(content),
        mtime: fileStat.mtime,
        size: Number(fileStat.size),
        dev: fileStat.dev,
        ino: fileStat.ino,
      };
    } catch {
      return null;
    }
  }

  private async readLinkedPiSessionSummary(filepath: string): Promise<{
    entries: (SessionHeader | SessionEntry)[];
    mtime: Date;
    size: number;
    dev: number | bigint;
    ino: number | bigint;
  } | null> {
    try {
      const [fileStat, content] = await Promise.all([
        fsStat(filepath),
        readJsonlPrefix(filepath),
      ]);
      return {
        entries: parseJsonlPrefixEntries(content),
        mtime: fileStat.mtime,
        size: Number(fileStat.size),
        dev: fileStat.dev,
        ino: fileStat.ino,
      };
    } catch {
      return null;
    }
  }

  private headerBelongsToCtx(header: SessionHeader | undefined, ctx: SessionCtx, directNative = false): boolean {
    if (!header) return isEmptySessionCtx(ctx);
    const storedCtx = readHeaderSessionCtx(header);
    if (storedCtx === null && directNative) return this.allowNativeUnscopedAccess;
    return this.storedCtxBelongsToCtx(storedCtx, ctx);
  }

  private storedCtxBelongsToCtx(storedCtx: StoredSessionCtx, ctx: SessionCtx): boolean {
    if (storedCtx === null) return this.allowLegacyUnscopedAccess && isLegacyUnscopedCtx(ctx);
    return sameSessionCtx(storedCtx, ctx);
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

interface StreamedJsonlSummary {
  lastTitle?: string;
  firstUserTitle?: string;
  latestMessageTimestamp?: string;
  userTurnCount: number;
  hasAssistantReply: boolean;
}

async function summarizeJsonl(
  filepath: string,
  options: { end: number; summary?: StreamedJsonlSummary; start?: number },
): Promise<{ summary: StreamedJsonlSummary; nextStart: number }> {
  const summary: StreamedJsonlSummary = options.summary
    ? { ...options.summary }
    : { userTurnCount: 0, hasAssistantReply: false };
  const decoder = new TextDecoder();
  let line = new JsonlAssistantEntryScanner();
  let byteOffset = options.start ?? 0;
  let lastNewlineOffset = byteOffset;
  const consumeLine = (): boolean => {
    const entry = line.summary();
    if (entry?.sessionInfoTitle !== undefined) summary.lastTitle = entry.sessionInfoTitle;
    const messageTimestamp = normalizedTimestamp(entry?.messageTimestamp);
    if (messageTimestamp && (!summary.latestMessageTimestamp || messageTimestamp > summary.latestMessageTimestamp)) {
      summary.latestMessageTimestamp = messageTimestamp;
    }
    if (entry?.messageRole === "user") {
      summary.userTurnCount += 1;
      if (summary.firstUserTitle === undefined && entry.messageText) {
        summary.firstUserTitle = entry.messageText;
      }
    }
    if (entry?.messageRole === "assistant") summary.hasAssistantReply = true;
    line = new JsonlAssistantEntryScanner();
    return entry !== null;
  };
  const scan = (content: string, final = false) => {
    let start = 0;
    while (start < content.length) {
      const newline = content.indexOf("\n", start);
      if (newline === -1) break;
      line.write(content.slice(start, newline));
      consumeLine();
      lastNewlineOffset = byteOffset + Buffer.byteLength(content.slice(0, newline + 1));
      start = newline + 1;
    }
    line.write(content.slice(start));
    if (final) {
      const completedTrailingLine = consumeLine();
      if (completedTrailingLine) lastNewlineOffset = byteOffset + Buffer.byteLength(content);
    }
    byteOffset += Buffer.byteLength(content);
  };

  for await (const chunk of createReadStream(filepath, {
    highWaterMark: SUMMARY_PREFIX_BYTES,
    end: options.end,
    ...(options.start !== undefined ? { start: options.start } : {}),
  })) {
    scan(decoder.decode(chunk, { stream: true }));
  }
  scan(decoder.decode(), true);
  return { summary, nextStart: lastNewlineOffset };
}

async function summarizeJsonlFromCache(
  filepath: string,
  size: number,
  priorSummary?: StreamedJsonlSummary,
  priorSize?: number,
): Promise<{ summary: StreamedJsonlSummary; nextStart: number }> {
  if (size <= 0) {
    return {
      summary: priorSummary ? { ...priorSummary } : { userTurnCount: 0, hasAssistantReply: false },
      nextStart: 0,
    };
  }
  if (priorSummary && priorSize !== undefined && priorSize === size) {
    return { summary: { ...priorSummary }, nextStart: priorSize };
  }
  if (priorSummary && priorSize !== undefined && priorSize < size) {
    return summarizeJsonl(filepath, { summary: priorSummary, start: priorSize, end: size - 1 });
  }
  return summarizeJsonl(filepath, { end: size - 1 });
}

function latestMessageTimestampFromEntries(entries: SessionEntry[]): string | undefined {
  let latest: string | undefined;
  for (const entry of entries) {
    if (activityMessageRole(entry) === undefined) continue;
    const timestamp = normalizedTimestamp(typeof entry.timestamp === "string" ? entry.timestamp : undefined);
    if (timestamp && (!latest || timestamp > latest)) latest = timestamp;
  }
  return latest;
}

function activityMessageRole(entry: SessionEntry): string | undefined {
  if (entry.type !== "message") return undefined;
  const message = (entry as { message?: unknown }).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" && role.length > 0 ? role : undefined;
}

function fileIdentity(fileStat: { dev: number | bigint; ino: number | bigint }): string {
  return `${fileStat.dev}:${fileStat.ino}`;
}

async function activityCheckpoint(filepath: string, size: number): Promise<string | undefined> {
  if (size < 0) return undefined;
  const chunkSize = Math.min(size, ACTIVITY_CHECKPOINT_BYTES);
  try {
    const handle = await open(filepath, "r");
    try {
      const head = Buffer.alloc(chunkSize);
      const tail = Buffer.alloc(chunkSize);
      const [{ bytesRead: headBytes }, { bytesRead: tailBytes }] = await Promise.all([
        handle.read(head, 0, chunkSize, 0),
        handle.read(tail, 0, chunkSize, Math.max(0, size - chunkSize)),
      ]);
      if (headBytes !== chunkSize || tailBytes !== chunkSize) return undefined;
      return createHash("sha256")
        .update(head.subarray(0, headBytes))
        .update(tail.subarray(0, tailBytes))
        .digest("hex");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

function normalizedTimestamp(value: string | undefined): string | undefined {
  const timestamp = timestampMs(value);
  return timestamp === undefined ? undefined : new Date(timestamp).toISOString();
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function activityTimestampOrFallback(
  latestMessageTimestamp: string | undefined,
  headerTimestamp: string | undefined,
  fallbackTimestamp: number,
): string {
  return normalizedTimestamp(latestMessageTimestamp)
    ?? normalizedTimestamp(headerTimestamp)
    ?? new Date(fallbackTimestamp).toISOString();
}

type JsonContainer =
  | { kind: "array"; state: "valueOrEnd" | "commaOrEnd"; afterComma: boolean; isMessageContent: boolean }
  | {
    kind: "object";
    state: "keyOrEnd" | "colon" | "value" | "commaOrEnd";
    key: string | null;
    afterComma: boolean;
    isRoot: boolean;
    isMessageObject: boolean;
    isContentItem: boolean;
  };

type JsonNumberState = "minus" | "zero" | "integer" | "fractionStart" | "fraction" | "exponentStart" | "exponentSign" | "exponent";

type JsonToken =
  | { kind: "literal"; expected: string; index: number }
  | { kind: "number"; state: JsonNumberState };

type JsonString = {
  role: "key" | "value";
  value: string;
  overflow: boolean;
  maxLength: number;
  truncate: boolean;
  escaped: boolean;
  unicode: string | null;
};

const MAX_STREAMED_TITLE_CHARS = 4 * 1024;
const MAX_STREAMED_PROMPT_CHARS = 80;

/**
 * Validates one JSON value incrementally while retaining only short object keys
 * and the title/role fields used for a session summary. This keeps malformed or
 * oversized JSONL records from growing memory with the file.
 */
class JsonlAssistantEntryScanner {
  private valid = true;
  private rootState: "value" | "done" = "value";
  private rootType: "message" | "session_info" | null = null;
  private messageRole: "user" | "assistant" | null = null;
  private hasMessageObject = false;
  private hasMessageRole = false;
  private sessionInfoTitle: string | undefined;
  private rootTimestamp: string | undefined;
  private messageText: string | undefined;
  private stack: JsonContainer[] = [];
  private token: JsonToken | null = null;
  private string: JsonString | null = null;

  write(content: string): void {
    for (let index = 0; this.valid && index < content.length;) {
      const char = content[index]!;
      if (this.string) {
        this.consumeString(char);
        index += 1;
      } else if (this.token) {
        if (isJsonDelimiter(char)) {
          this.finishToken();
        } else {
          this.consumeToken(char);
          index += 1;
        }
      } else if (isJsonWhitespace(char)) {
        index += 1;
      } else {
        this.consumeStructure(char);
        index += 1;
      }
    }
  }

  summary(): { sessionInfoTitle?: string; messageRole?: "user" | "assistant"; messageText?: string; messageTimestamp?: string } | null {
    if (this.token) this.finishToken();
    if (!this.valid || this.string !== null || this.stack.length !== 0 || this.rootState !== "done") return null;
    if (this.rootType === "session_info") return { sessionInfoTitle: this.sessionInfoTitle };
    if (this.rootType === "message" && this.hasMessageObject && this.hasMessageRole) {
      return {
        ...(this.messageRole ? { messageRole: this.messageRole } : {}),
        ...(this.messageText ? { messageText: this.messageText } : {}),
        ...(this.rootTimestamp ? { messageTimestamp: this.rootTimestamp } : {}),
      };
    }
    return null;
  }

  private consumeStructure(char: string): void {
    const container = this.stack.at(-1);
    if (!container) {
      if (this.rootState !== "value") {
        this.valid = false;
        return;
      }
      this.startValue(char);
      return;
    }
    if (container.kind === "object") {
      if (container.state === "keyOrEnd") {
        if (char === "}") {
          if (container.afterComma) this.valid = false;
          else this.closeContainer();
        } else if (char === '"') this.startString("key");
        else this.valid = false;
      } else if (container.state === "colon") {
        if (char === ":") container.state = "value";
        else this.valid = false;
      } else if (container.state === "value") {
        this.startValue(char);
      } else if (char === ",") {
        container.state = "keyOrEnd";
        container.afterComma = true;
      } else if (char === "}") {
        this.closeContainer();
      } else {
        this.valid = false;
      }
      return;
    }
    if (container.state === "valueOrEnd") {
      if (char === "]") {
        if (container.afterComma) this.valid = false;
        else this.closeContainer();
      } else this.startValue(char);
    } else if (char === ",") {
      container.state = "valueOrEnd";
      container.afterComma = true;
    } else if (char === "]") {
      this.closeContainer();
    } else {
      this.valid = false;
    }
  }

  private startValue(char: string): void {
    const parent = this.stack.at(-1);
    if (parent?.kind === "array") parent.afterComma = false;
    if (parent?.kind === "object" && parent.isRoot && parent.key === "message") {
      this.messageRole = null;
      this.messageText = undefined;
      this.hasMessageObject = char === "{";
      this.hasMessageRole = false;
    }
    if (char === '"') {
      this.startString("value");
    } else if (char === "{" || char === "[") {
      this.markNonStringValue(parent);
      if (this.stack.length >= MAX_JSONL_NESTING_DEPTH) {
        this.valid = false;
        return;
      }
      if (char === "{") {
        this.stack.push({
          kind: "object",
          state: "keyOrEnd",
          key: null,
          afterComma: false,
          isRoot: parent === undefined,
          isMessageObject: parent?.kind === "object" && parent.isRoot && parent.key === "message",
          isContentItem: parent?.kind === "array" && parent.isMessageContent,
        });
      } else {
        this.stack.push({
          kind: "array",
          state: "valueOrEnd",
          afterComma: false,
          isMessageContent: parent?.kind === "object" && parent.isMessageObject && parent.key === "content",
        });
      }
    } else if (char === "t" || char === "f" || char === "n") {
      this.markNonStringValue(parent);
      this.token = { kind: "literal", expected: char === "t" ? "true" : char === "f" ? "false" : "null", index: 1 };
    } else if (char === "-" || isJsonDigit(char)) {
      this.markNonStringValue(parent);
      this.token = {
        kind: "number",
        state: char === "-" ? "minus" : char === "0" ? "zero" : "integer",
      };
    } else {
      this.valid = false;
    }
  }

  private startString(role: JsonString["role"]): void {
    const parent = this.stack.at(-1);
    const isTitle = role === "value" && parent?.kind === "object" && parent.isRoot && parent.key === "name";
    const isTimestamp = role === "value" && parent?.kind === "object" && parent.isRoot && parent.key === "timestamp";
    const isMessageRole = role === "value" && parent?.kind === "object" && parent.isMessageObject && parent.key === "role";
    const isUserText = role === "value" && parent?.kind === "object"
      && ((parent.isContentItem && parent.key === "text") || (parent.isMessageObject && parent.key === "content"));
    this.string = {
      role,
      value: "",
      overflow: false,
      maxLength: isTitle ? MAX_STREAMED_TITLE_CHARS : isTimestamp ? 64 : isUserText ? MAX_STREAMED_PROMPT_CHARS : 32,
      truncate: isTitle || isTimestamp || isMessageRole || isUserText,
      escaped: false,
      unicode: null,
    };
  }

  private consumeString(char: string): void {
    const string = this.string!;
    if (string.unicode !== null) {
      if (!/^[0-9a-fA-F]$/.test(char)) {
        this.valid = false;
        return;
      }
      string.unicode += char;
      if (string.unicode.length === 4) {
        this.appendStringCharacter(String.fromCharCode(Number.parseInt(string.unicode, 16)));
        string.unicode = null;
      }
      return;
    }
    if (string.escaped) {
      const escaped = JSON_ESCAPES[char];
      if (escaped === undefined) {
        if (char === "u") {
          string.unicode = "";
          string.escaped = false;
        } else {
          this.valid = false;
        }
      } else {
        this.appendStringCharacter(escaped);
        string.escaped = false;
      }
      return;
    }
    if (char === '"') {
      this.finishString();
    } else if (char === "\\") {
      string.escaped = true;
    } else if (char.charCodeAt(0) < 0x20) {
      this.valid = false;
    } else {
      this.appendStringCharacter(char);
    }
  }

  private appendStringCharacter(char: string): void {
    const string = this.string!;
    if (string.overflow || string.value.length >= string.maxLength) return;
    if (string.value.length + char.length > string.maxLength) {
      if (string.truncate) string.value += char.slice(0, string.maxLength - string.value.length);
      else {
        string.overflow = true;
        string.value = "";
      }
    } else {
      string.value += char;
    }
  }

  private finishString(): void {
    const string = this.string!;
    this.string = null;
    const value = string.overflow ? null : string.value;
    if (string.role === "key") {
      const container = this.stack.at(-1);
      if (!container || container.kind !== "object" || container.state !== "keyOrEnd") {
        this.valid = false;
        return;
      }
      container.key = value;
      container.afterComma = false;
      container.state = "colon";
    } else {
      this.completeValue(value);
    }
  }

  private consumeToken(char: string): void {
    const token = this.token!;
    if (token.kind === "literal") {
      if (token.expected[token.index] !== char) this.valid = false;
      else token.index += 1;
      return;
    }
    const transitions: Record<JsonNumberState, string> = {
      minus: "digit",
      zero: "eE.",
      integer: "digit.eE",
      fractionStart: "digit",
      fraction: "digit eE",
      exponentStart: "digit+-",
      exponentSign: "digit",
      exponent: "digit",
    };
    if (!transitions[token.state].includes(isJsonDigit(char) ? "digit" : char)) {
      this.valid = false;
      return;
    }
    if (token.state === "minus") token.state = char === "0" ? "zero" : "integer";
    else if (token.state === "zero" || token.state === "integer") {
      if (char === ".") token.state = "fractionStart";
      else if (char === "e" || char === "E") token.state = "exponentStart";
    } else if (token.state === "fractionStart") token.state = "fraction";
    else if (token.state === "fraction" && (char === "e" || char === "E")) token.state = "exponentStart";
    else if (token.state === "exponentStart") token.state = char === "+" || char === "-" ? "exponentSign" : "exponent";
    else if (token.state === "exponentSign") token.state = "exponent";
  }

  private finishToken(): void {
    const token = this.token!;
    this.token = null;
    if (token.kind === "literal" ? token.index !== token.expected.length : !["zero", "integer", "fraction", "exponent"].includes(token.state)) {
      this.valid = false;
      return;
    }
    this.completeValue(null);
  }

  private markNonStringValue(parent: JsonContainer | undefined): void {
    if (parent?.kind !== "object") return;
    if (parent.isRoot && parent.key === "type") this.rootType = null;
    if (parent.isRoot && parent.key === "timestamp") this.rootTimestamp = undefined;
    if (parent.isMessageObject && parent.key === "role") {
      this.messageRole = null;
      this.hasMessageRole = false;
    }
  }

  private completeValue(value: string | null): void {
    const parent = this.stack.at(-1);
    if (!parent) {
      this.rootState = "done";
      return;
    }
    if (parent.kind === "object") {
      if (parent.state !== "value") {
        this.valid = false;
        return;
      }
      if (parent.isRoot && parent.key === "type") {
        this.rootType = value === "message" || value === "session_info" ? value : null;
      }
      if (parent.isRoot && parent.key === "name" && value !== null) this.sessionInfoTitle = value;
      if (parent.isRoot && parent.key === "timestamp" && value !== null) this.rootTimestamp = value;
      if (parent.isMessageObject && parent.key === "role") {
        this.hasMessageRole = value !== null && value.length > 0;
        this.messageRole = value === "user" || value === "assistant" ? value : null;
      }
      if (
        ((parent.isContentItem && parent.key === "text") || (parent.isMessageObject && parent.key === "content"))
        && value !== null
      ) {
        this.messageText = `${this.messageText ?? ""}${value}`.slice(0, MAX_STREAMED_PROMPT_CHARS);
      }
      parent.state = "commaOrEnd";
    } else {
      if (parent.state !== "valueOrEnd") {
        this.valid = false;
        return;
      }
      parent.state = "commaOrEnd";
    }
  }

  private closeContainer(): void {
    this.stack.pop();
    this.completeValue(null);
  }
}

const JSON_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

function isJsonWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r";
}

function isJsonDelimiter(char: string): boolean {
  return isJsonWhitespace(char) || char === "," || char === "]" || char === "}";
}

function isJsonDigit(char: string): boolean {
  return char >= "0" && char <= "9";
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
  return entries.filter((entry) => activityMessageRole(entry) === "user").length;
}

function hasAssistantReply(entries: SessionEntry[]): boolean {
  return entries.some((entry) => activityMessageRole(entry) === "assistant");
}

function extractTitle(entries: SessionEntry[]): string | undefined {
  const last = entries
    .filter((e): e is SessionInfoEntry => e.type === "session_info")
    .pop();
  return last?.name;
}

function firstUserMessage(entries: SessionEntry[]): string | undefined {
  for (const e of entries) {
    if (activityMessageRole(e) !== "user") continue;
    const msg = (e as SessionMessageEntry).message as { content?: unknown };
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

function withStableMessageId(message: unknown, entryId: string | undefined): unknown {
  if (!entryId || !message || typeof message !== "object" || Array.isArray(message)) return message;
  if (typeof (message as { id?: unknown }).id === "string") return message;
  return { ...message, id: entryId };
}

function messageIdFromPiMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function piImagePartAt(message: unknown, index: number): { type: "image"; data?: string; mimeType?: string; filename?: string } | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const part = content[index];
  if (!part || typeof part !== "object" || Array.isArray(part)) return null;
  const record = part as { type?: unknown; data?: unknown; mimeType?: unknown; filename?: unknown };
  if (record.type !== "image") return null;
  return {
    type: "image",
    ...(typeof record.data === "string" ? { data: record.data } : {}),
    ...(typeof record.mimeType === "string" && record.mimeType.length > 0 ? { mimeType: record.mimeType } : {}),
    ...(typeof record.filename === "string" && record.filename.length > 0 ? { filename: record.filename } : {}),
  };
}

function imagePartBuffer(part: { data?: string }): Buffer | null {
  const raw = part.data;
  if (!raw) return null;
  const match = raw.match(/^data:[^;]+;base64,(.+)$/);
  try {
    return Buffer.from(match ? match[1] : raw, "base64");
  } catch {
    return null;
  }
}

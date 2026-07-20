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
  utimes,
} from "node:fs/promises";
import { closeSync, createReadStream, openSync, readFileSync, readSync, readdirSync, writeFileSync, type Stats } from "node:fs";
import { createInterface } from "node:readline";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { getEnv } from "../../config/env.js";
import {
  parseSessionEntries,
  SessionManager,
  type SessionEntry,
  type SessionHeader,
  type SessionMessageEntry,
  type SessionInfoEntry,
  CURRENT_SESSION_VERSION,
} from "@mariozechner/pi-coding-agent";
import { ErrorCode } from "../../../shared/error-codes.js";
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
const NATIVE_TAIL_CHUNK_BYTES = 64 * 1024;
export const NATIVE_TAIL_MAX_RECORD_BYTES = 256 * 1024;
export const NATIVE_TAIL_MAX_RECORD_FRAGMENTS = 4;
const NATIVE_RENAME_MAX_APPEND_BYTES = 64 * 1024;
const NATIVE_RENAME_MAX_ATTEMPTS = 3;
const SUMMARY_CONCURRENCY = 8;
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

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(SUMMARY_CONCURRENCY, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }));
  return results;
}

interface NativeRenameAppend {
  id: string;
  parentId: string | null;
}

/** Restore mtime only while the exact verified append is still the file tail. */
async function restoreVerifiedNativeRenameMtime(
  filepath: string,
  before: Stats,
  verifiedSize: number,
): Promise<void> {
  try {
    const current = await fsStat(filepath);
    if (current.dev !== before.dev || current.ino !== before.ino || current.size !== verifiedSize) return;

    const atimeSeconds = fileTimeSeconds(before.atimeMs);
    const mtimeSeconds = fileTimeSeconds(before.mtimeMs);
    if (atimeSeconds === undefined || mtimeSeconds === undefined) return;
    await utimes(filepath, atimeSeconds, mtimeSeconds);

    const restored = await fsStat(filepath);
    if (restored.size !== verifiedSize) {
      const restoredAtimeSeconds = fileTimeSeconds(restored.atimeMs);
      if (restoredAtimeSeconds !== undefined) await utimes(filepath, restoredAtimeSeconds, Date.now() / 1000);
      return;
    }
  } catch {
    // A rename succeeded; timestamp restoration is strictly best-effort.
  }
}

/** Reads only the bounded suffix written since the attempt's pre-append stat. */
async function verifiedNativeRenameAppend(
  filepath: string,
  before: Stats,
  append: NativeRenameAppend,
  title: string,
): Promise<number | null> {
  const after = await fsStat(filepath);
  if (after.dev !== before.dev || after.ino !== before.ino) return null;

  const appendedBytes = after.size - before.size;
  if (!Number.isSafeInteger(before.size) || !Number.isSafeInteger(after.size)
    || appendedBytes <= 0 || appendedBytes > NATIVE_RENAME_MAX_APPEND_BYTES) return null;

  const handle = await open(filepath, "r");
  try {
    const record = Buffer.allocUnsafe(appendedBytes);
    const { bytesRead } = await handle.read(record, 0, record.length, before.size);
    if (bytesRead !== record.length || record.at(-1) !== 0x0a || record.indexOf(0x0a) !== record.length - 1) return null;
    const parsed: unknown = JSON.parse(record.toString("utf-8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const entry = parsed as { type?: unknown; id?: unknown; parentId?: unknown; name?: unknown };
    return entry.type === "session_info"
      && entry.id === append.id
      && entry.parentId === append.parentId
      && entry.name === title
      ? after.size
      : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

function latestConcurrentEntryId(manager: SessionManager, staleRenameIds: ReadonlySet<string>): string | null {
  for (const entry of manager.getEntries().reverse()) {
    if (!staleRenameIds.has(entry.id)) return entry.id;
  }
  return null;
}

async function appendVerifiedNativeRename(
  filepath: string,
  sessionDir: string,
  cwd: string,
  title: string,
): Promise<void> {
  const staleRenameIds = new Set<string>();
  for (let attempt = 0; attempt < NATIVE_RENAME_MAX_ATTEMPTS; attempt += 1) {
    try {
      // Stat before opening so any append between open and append is inside the
      // bounded inspected suffix and forces a fresh branch attempt.
      const before = await fsStat(filepath);
      const manager = SessionManager.open(filepath, sessionDir, cwd);
      if (staleRenameIds.size > 0) {
        const concurrentLeaf = latestConcurrentEntryId(manager, staleRenameIds);
        if (!concurrentLeaf) break;
        manager.branch(concurrentLeaf);
      }
      const append: NativeRenameAppend = {
        parentId: manager.getLeafId(),
        id: manager.appendSessionInfo(title),
      };
      staleRenameIds.add(append.id);
      const verifiedSize = await verifiedNativeRenameAppend(filepath, before, append, title);
      if (verifiedSize !== null) {
        await restoreVerifiedNativeRenameMtime(filepath, before, verifiedSize);
        return;
      }
    } catch {
      // The next bounded optimistic attempt reopens Pi's latest session tree.
    }
  }
  throw Object.assign(new Error("native session changed while renaming; retry"), {
    code: ErrorCode.enum.SESSION_LOCKED,
    statusCode: 409,
    retryable: true,
  });
}

function fileTimeSeconds(milliseconds: number): number | undefined {
  const seconds = milliseconds / 1000;
  return Number.isFinite(seconds) ? seconds : undefined;
}

export interface PiSessionStoreOptions {
  sessionDir?: string;
  sessionNamespace?: string;
  /** Explicit root for file-backed session directories. Overrides BORING_AGENT_SESSION_ROOT. */
  sessionRoot?: string;
  /** Host/storage cwd used only to derive the default file-backed session directory. */
  storageCwd?: string;
  /**
   * Explicit direct/local capability for bare Pi transcripts. This is
   * deliberately unscoped: only enable it for a trusted single-user/session
   * directory host, never a shared hosted session root.
   */
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
    const fileStats = await mapWithConcurrency(filepaths, async (filepath) => {
      try {
        return { filepath, stat: await fsStat(filepath) };
      } catch {
        return null;
      }
    });
    const existingFiles = fileStats
      .filter((item): item is NonNullable<typeof item> => item !== null);
    const referencedPiFiles = await this.referencedPiFiles(existingFiles);
    const visibleFiles = await mapWithConcurrency(
      existingFiles.filter(({ filepath }) => !referencedPiFiles.has(resolve(filepath))),
      async (file) => ({ ...file, sortMtimeMs: await this.sessionSortMtimeMs(file) }),
    );
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

  async rename(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary> {
    const normalizedTitle = title.replace(/[\r\n]+/g, ' ').trim();
    const filepath = await this.resolveSessionFile(sessionId, ctx);
    const linkedPiFile = await this.linkedPiFileFor(filepath);
    const target = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath) ? linkedPiFile : filepath;
    const preservesNativeMtime = Boolean(linkedPiFile) || isTimestampNamedPiSessionFile(target, sessionId);
    try {
      if (preservesNativeMtime) {
        await appendVerifiedNativeRename(target, this.sessionDir, this.cwd, normalizedTitle);
      } else {
        SessionManager.open(target, this.sessionDir, this.cwd).appendSessionInfo(normalizedTitle);
      }
    } finally {
      this.prefixCache.delete(filepath);
      this.prefixCache.delete(target);
    }
    return this.load(ctx, sessionId);
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const resolved = await this.resolveSessionTranscript(ctx, sessionId);
    const nativeSummary = resolved.directNative ? await summarizeNativeTranscript(resolved.filepath) : null;
    const title = nativeSummary
      ? nativeSummary.title ?? nativeSummary.firstUserTitle ?? "New session"
      : extractTitle(resolved.sessionEntries) ?? extractTitle(resolved.linkedEntries) ?? "New session";
    const turnCount = countUserTurns(resolved.transcriptEntries);
    const updatedAtMs = nativeSummary?.latestMessageAtMs
      ?? Math.max(resolved.fileStat.mtime.getTime(), resolved.linkedMtimeMs ?? 0);

    return {
      id: resolved.resolvedSessionId,
      title,
      createdAt: resolved.header?.timestamp ?? resolved.fileStat.birthtime.toISOString(),
      updatedAt: new Date(updatedAtMs).toISOString(),
      turnCount,
      ...(resolved.directNative
        ? { nativeSessionId: resolved.resolvedSessionId, hasAssistantReply: hasAssistantReply(resolved.transcriptEntries) }
        : {}),
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
    directNative: boolean;
  }> {
    const filepath = await this.resolveSessionFile(sessionId, ctx);
    let content: string;
    try {
      content = await readFile(filepath, "utf-8");
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const fileEntries = safeParseEntries(content);
    const header = fileEntries.find(
      (e): e is SessionHeader => e.type === "session",
    );
    const timestampNamedNative = isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId);

    // Legacy sessions accumulated a full ui_snapshot on every turn — a 428-message
    // session could reach 90 MB across 60 snapshots, making every cold-load parse
    // megabytes of data and stall the UI. Compact them out on first read so all
    // subsequent loads are fast. Native Pi transcripts are only filtered in memory:
    // rewriting one could discard a concurrent append.
    if (!timestampNamedNative && fileEntries.some((e) => (e as { type?: string }).type === "ui_snapshot")) {
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

    if (!this.headerBelongsToCtx(header, ctx, timestampNamedNative)) throw new Error(`Session not found: ${sessionId}`);
    const sessionEntries = fileEntries.filter(
      (e): e is SessionEntry => e.type !== "session" && (e as { type?: string }).type !== "ui_snapshot",
    );

    const fileStat = await fsStat(filepath);
    const linkedPiFile = extractPiSessionFilePath(fileEntries);
    const directNative = isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId) && !linkedPiFile;
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
      directNative,
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
      const linkedPiFile = extractPiSessionFilePath(entries);
      const directNative = this.allowNativeUnscopedAccess
        && !linkedPiFile
        && isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId);
      if (!this.headerBelongsToCtx(header, ctx, directNative)) return null;
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
      const linkedPiFile = extractPiSessionFilePath(entries);
      const directNative = this.allowNativeUnscopedAccess
        && !linkedPiFile
        && isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId);
      if (!this.headerBelongsToCtx(header, ctx, directNative)) return null;
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
    if (ctx && this.allowNativeUnscopedAccess) {
      await this.assertFileBelongsToCtx(matchedPath, ctx, sessionId);
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
    const directNative = !extractPiSessionFilePath(entries) && isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId);
    if (!this.headerBelongsToCtx(header, ctx, directNative)) throw new Error(`Session not found: ${sessionId}`);
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
      return extractPiSessionFilePath(parseJsonlPrefixEntries(await readJsonlPrefix(filepath)));
    } catch {
      return null;
    }
  }

  private async referencedPiFiles(files: SessionFileStat[]): Promise<Set<string>> {
    const referenced = new Set<string>();
    await mapWithConcurrency(files, async ({ filepath, stat }) => {
      try {
        const piFilePath = (await this.readPrefixCache(filepath, stat)).referencedPiFile;
        if (piFilePath && resolve(piFilePath) !== resolve(filepath)) {
          referenced.add(resolve(piFilePath));
        }
      } catch {
        // Ignore unreadable files; summarizeFile will drop them later.
      }
    });
    return referenced;
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
        && (cached.summary?.nativeSessionId
          ? this.allowNativeUnscopedAccess
          : this.storedCtxBelongsToCtx(cached.sessionCtx, ctx))
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
      const directNative = isTimestampNamedPiSessionFile(filepath, header.id);
      if (!this.headerBelongsToCtx(header, ctx, directNative)) return null;

      const entries = parseJsonlPrefixEntries(content);
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
      const nativeSummary = directNative && !linked
        ? await summarizeNativeTranscript(filepath)
        : null;

      const title = nativeSummary
        ? nativeSummary.title ?? nativeSummary.firstUserTitle ?? "New session"
        : extractTitle(sessionEntries) ??
          extractTitle(linkedEntries) ??
          firstUserMessage(linkedEntries) ??
          firstUserMessage(sessionEntries) ??
          "New session";
      const turnCount = nativeSummary
        ? nativeSummary.turnCount
        : [...sessionEntries, ...linkedEntries].filter(
          (e) => e.type === "message" && ((e as SessionMessageEntry).message as any)?.role === "user",
        ).length;
      const updatedAtMs = nativeSummary?.latestMessageAtMs ?? Math.max(fileStat.mtime.getTime(), linked?.mtime.getTime() ?? 0);

      const summary = {
        id: header.id,
        title,
        createdAt: header.timestamp,
        updatedAt: new Date(updatedAtMs).toISOString(),
        turnCount,
        ...(nativeSummary
          ? { nativeSessionId: header.id, hasAssistantReply: nativeSummary.hasAssistantReply }
          : {}),
      };
      this.prefixCache.set(filepath, {
        mtimeMs: fileStat.mtime.getTime(),
        size: Number(fileStat.size),
        referencedPiFile: linkedPiFile,
        sessionCtx,
        ...(linked ? { linkedMtimeMs: linked.mtime.getTime(), linkedSize: linked.size } : {}),
        ...(!nativeSummary ? { summary } : {}),
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

  private async sessionSortMtimeMs({ filepath, stat }: SessionFileStat): Promise<number> {
    let sortMtimeMs = stat.mtime.getTime();
    try {
      const content = await readJsonlPrefix(filepath);
      const entries = parseJsonlPrefixEntries(content);
      const linkedPiFile = extractPiSessionFilePath(entries);
      if (linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)) {
        const linkedStat = await fsStat(linkedPiFile);
        return Math.max(sortMtimeMs, linkedStat.mtime.getTime());
      }
      const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
      if (header && isTimestampNamedPiSessionFile(filepath, header.id)) {
        sortMtimeMs = await latestNativeMessageTimestamp(filepath, Number(stat.size)) ?? sortMtimeMs;
      }
    } catch {
      // Fall back to the wrapper/native file mtime for unreadable transcripts.
    }
    return sortMtimeMs;
  }

  private async summarizeVisiblePage(
    visibleFiles: Array<{ filepath: string; stat: Awaited<ReturnType<typeof fsStat>> }>,
    options: { ctx: SessionCtx; offset: number; limit: number | undefined },
  ): Promise<SessionSummary[]> {
    if (options.limit === 0) return [];

    const page: SessionSummary[] = [];
    let validSeen = 0;
    let index = 0;
    const batchSize = Math.min(
      SUMMARY_CONCURRENCY,
      options.limit === undefined ? Math.max(1, visibleFiles.length) : Math.max(1, options.limit),
    );

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

  private async readLinkedPiSessionSummary(filepath: string): Promise<{ entries: (SessionHeader | SessionEntry)[]; mtime: Date; size: number } | null> {
    try {
      const [fileStat, content] = await Promise.all([
        fsStat(filepath),
        readJsonlPrefix(filepath),
      ]);
      return { entries: parseJsonlPrefixEntries(content), mtime: fileStat.mtime, size: Number(fileStat.size) };
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

async function latestNativeMessageTimestamp(filepath: string, size: number): Promise<number | undefined> {
  const handle = await open(filepath, "r");
  let end = size;
  let lineFragments: Buffer[] = [];
  try {
    while (end > 0) {
      const start = Math.max(0, end - NATIVE_TAIL_CHUNK_BYTES);
      const chunk = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, start);
      let lineEnd = bytesRead;
      while (lineEnd > 0) {
        const newline = chunk.lastIndexOf(0x0a, lineEnd - 1);
        if (newline < 0) break;
        // Once a record start is found, retain only its bounded prefix and
        // the immediately following chunks. Never reconstruct a full record.
        const timestamp = nativeMessageTimestampFromBoundedPrefix(
          nativeTailRecordPrefix(chunk.subarray(newline + 1, lineEnd), lineFragments),
        );
        lineFragments = [];
        if (timestamp !== undefined) return timestamp;
        lineEnd = newline;
      }
      if (lineEnd > 0) {
        lineFragments = retainNativeTailFragment(chunk.subarray(0, lineEnd), lineFragments);
      }
      end = start;
    }
    // At file start, the last retained fragment is the record prefix and the
    // preceding fragments are its immediate continuation in reverse-read order.
    return nativeMessageTimestampFromBoundedPrefix(
      nativeTailRecordPrefix(lineFragments.at(-1) ?? Buffer.alloc(0), lineFragments.slice(0, -1)),
    );
  } finally {
    await handle.close();
  }
}

function retainNativeTailFragment(fragment: Buffer, fragments: Buffer[]): Buffer[] {
  const next = [...fragments, fragment.subarray(0, NATIVE_TAIL_MAX_RECORD_BYTES)];
  while (next.length > NATIVE_TAIL_MAX_RECORD_FRAGMENTS || nativeTailFragmentBytes(next) > NATIVE_TAIL_MAX_RECORD_BYTES) {
    next.shift();
  }
  return next;
}

function nativeTailFragmentBytes(fragments: Buffer[]): number {
  return fragments.reduce((total, fragment) => total + fragment.length, 0);
}

/** Combines a record start with its retained following chunks in file order. */
function nativeTailRecordPrefix(recordStart: Buffer, followingFragments: Buffer[]): Buffer {
  const total = Math.min(
    NATIVE_TAIL_MAX_RECORD_BYTES,
    recordStart.length + nativeTailFragmentBytes(followingFragments),
  );
  const prefix = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const fragment of [recordStart, ...followingFragments.slice().reverse()]) {
    const length = Math.min(fragment.length, total - offset);
    if (length <= 0) break;
    fragment.copy(prefix, offset, 0, length);
    offset += length;
  }
  return prefix;
}

export function nativeMessageTimestampFromBoundedPrefix(prefix: Buffer): number | undefined {
  if (prefix.length === 0) return undefined;
  const line = prefix.subarray(0, NATIVE_TAIL_MAX_RECORD_BYTES).toString("utf-8");
  // Pi writes `type` first and its timestamp before message payloads. This is
  // intentionally a root-prefix check, not a JSON parser for a whole record.
  if (!/^\s*\{\s*"type"\s*:\s*"message"(?:\s*,|\s*})/.test(line)) return undefined;
  const timestampMatch = /"timestamp"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(line);
  if (!timestampMatch) return undefined;
  const timestamp = Date.parse(timestampMatch[1]);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

async function summarizeNativeTranscript(filepath: string): Promise<{
  title?: string;
  firstUserTitle?: string;
  turnCount: number;
  hasAssistantReply: boolean;
  latestMessageAtMs?: number;
}> {
  let title: string | undefined;
  let firstUserTitle: string | undefined;
  let turnCount = 0;
  let hasAssistantReply = false;
  let latestMessageAtMs: number | undefined;
  const input = createReadStream(filepath, { encoding: "utf-8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: unknown; name?: unknown; timestamp?: unknown; message?: { role?: unknown; content?: unknown } };
      if (entry.type === "session_info" && typeof entry.name === "string") {
        title = entry.name;
        continue;
      }
      if (entry.type !== "message") continue;
      const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
      if (!Number.isNaN(timestamp)) latestMessageAtMs = timestamp;
      if (entry.message?.role === "user") {
        turnCount += 1;
        firstUserTitle ??= textFromPiContent(entry.message.content).slice(0, 80) || undefined;
      } else if (entry.message?.role === "assistant") {
        hasAssistantReply = true;
      }
    } catch {
      // A malformed transcript record must not hide later valid records.
    }
  }
  return { title, firstUserTitle, turnCount, hasAssistantReply, latestMessageAtMs };
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

function hasAssistantReply(entries: SessionEntry[]): boolean {
  return entries.some(
    (entry): entry is SessionMessageEntry => entry.type === "message" && entry.message.role === "assistant",
  );
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

import { randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  stat as fsStat,
  rm,
  mkdir,
  writeFile,
  appendFile,
  open,
} from "node:fs/promises";
import { closeSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { getEnv } from "../../config/env.js";
import {
  parseSessionEntries,
  type SessionEntry,
  type SessionHeader,
  type SessionMessageEntry,
  CURRENT_SESSION_VERSION,
} from "@mariozechner/pi-coding-agent";
import { ErrorCode } from "../../../shared/error-codes.js";
import type { ChatModelSelection } from "../../../shared/chat/chatSubmitPayload.js";
import {
  SAFE_NATIVE_SESSION_ID,
  type SessionStore,
  type SessionCtx,
  type SessionSummary,
  type SessionDetail,
  type SessionListOptions,
} from "../../../shared/session.js";
import { appendVerifiedNativeRename, appendVerifiedWrapperRename } from "./nativeSessionRename.js";
import { createUserSessionTitleEntries, normalizeUserSessionTitle } from "./sessionTitleAuthority.js";
import {
  latestNativeMessageTimestamp,
  parseSessionTranscript,
  summarizeSessionTranscript,
  type SessionTranscriptSummary,
} from "./nativeSessionTranscript.js";
export {
  NATIVE_TAIL_MAX_RECORD_BYTES,
  NATIVE_TAIL_MAX_RECORD_FRAGMENTS,
  nativeMessageTimestampFromBoundedPrefix,
} from "./nativeSessionTranscript.js";

/** Raw pi message objects (role/content/timestamp on the object), in file
 * order, ready to feed straight into buildPiChatHistory — the same shape the
 * live event path consumes. */
export interface PiSessionEntries {
  id: string;
  messages: unknown[];
  currentModel?: ChatModelSelection;
}

function legacyAssistantModel(entry: SessionMessageEntry): ChatModelSelection | undefined {
  const message = entry.message as unknown as Record<string, unknown>;
  if (message.role !== "assistant") return undefined;
  if (typeof message.provider === "string" && typeof message.model === "string") {
    return { provider: message.provider, id: message.model };
  }
  if (typeof message.model !== "object" || message.model === null) return undefined;
  const model = message.model as Record<string, unknown>;
  return typeof model.provider === "string" && typeof model.id === "string"
    ? { provider: model.provider, id: model.id }
    : undefined;
}

function currentModelFromTranscript(entries: readonly SessionEntry[]): ChatModelSelection | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (entry.type === "model_change") return { provider: entry.provider, id: entry.modelId };
    if (entry.type === "message") {
      const model = legacyAssistantModel(entry);
      if (model) return model;
    }
  }
  return undefined;
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

const SAFE_SESSION_NAMESPACE = /^[a-zA-Z0-9_-]+$/;
const SESSION_ROOT_ENV = "BORING_AGENT_SESSION_ROOT";
const SUMMARY_PREFIX_BYTES = 64 * 1024;
const MAX_CONCURRENT_SESSION_SUMMARIES = 4;
const DEFAULT_LEGACY_WORKSPACE_ID = "default";
const TRUSTED_LOCAL_USER_ID = "local";

type SessionFileStat = { filepath: string; stat: Awaited<ReturnType<typeof fsStat>> };
type StoredSessionCtx = SessionCtx | null;

interface PrefixCacheEntry {
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  referencedPiFile: string | null;
  /** Header id of this transcript, so listing never re-reads a prefix to learn it. */
  headerId?: string | null;
  /**
   * Recency key of a native transcript, derived from its own bytes by
   * {@link latestNativeMessageTimestamp}. Cached because it is a pure function
   * of this file at this (mtime, size), and recomputing it for every file on
   * every listing was a per-request full-store tail scan (#1338).
   */
  nativeSortMtimeMs?: number;
  sessionCtx?: StoredSessionCtx;
  linkedDev?: number;
  linkedIno?: number;
  linkedMtimeMs?: number;
  linkedCtimeMs?: number;
  linkedSize?: number;
  summary?: SessionSummary | null;
}

interface NormalizedListOptions {
  limit: number | undefined;
  offset: number;
  includeId: string | undefined;
  includeEmpty: boolean;
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
    includeEmpty: options?.includeEmpty === true,
  };
}

export interface PiSessionStoreOptions {
  sessionDir?: string;
  sessionNamespace?: string;
  /** Explicit root for file-backed session directories. Overrides BORING_AGENT_SESSION_ROOT. */
  sessionRoot?: string;
  /** Host/storage cwd used only to derive the default file-backed session directory. */
  storageCwd?: string;
  /** Trusted-local capability for bare native Pi transcripts in an explicit store. */
  allowUnscopedNativeAccess?: boolean;
}

export class PiSessionStore implements SessionStore {
  private cwd: string;
  private sessionDir: string;
  private allowLegacyUnscopedAccess: boolean;
  private pathDerivedLegacyAccess: boolean;
  private allowUnscopedNativeAccess: boolean;
  private prefixCache = new Map<string, PrefixCacheEntry>();
  private listInFlight = new Map<string, Promise<SessionSummary[]>>();
  private writerTails = new Map<string, Promise<void>>();

  constructor(cwd: string, options?: string | PiSessionStoreOptions) {
    this.cwd = cwd;
    if (typeof options === "string") {
      this.sessionDir = options;
      this.allowLegacyUnscopedAccess = true;
      this.pathDerivedLegacyAccess = false;
      this.allowUnscopedNativeAccess = false;
      return;
    }
    this.allowLegacyUnscopedAccess = true;
    this.pathDerivedLegacyAccess = options?.sessionDir === undefined
      && options?.sessionNamespace === undefined;
    this.allowUnscopedNativeAccess = options?.allowUnscopedNativeAccess === true;
    this.sessionDir = options?.sessionDir
      ?? (options?.sessionNamespace
        ? sessionDirForNamespace(options.sessionNamespace, options.sessionRoot)
        : defaultSessionDir(options?.storageCwd ?? cwd, options?.sessionRoot));
  }

  getSessionDir(): string {
    return this.sessionDir;
  }

  async has(ctx: SessionCtx, sessionId: string): Promise<boolean> {
    try {
      await this.resolveSessionFile(sessionId, ctx);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === `Session not found: ${sessionId}`) return false;
      throw error;
    }
  }

  async list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]> {
    const normalizedOptions = normalizeListOptions(options);
    const inFlightKey = JSON.stringify([
      ctx.workspaceId,
      ctx.userId ?? null,
      normalizedOptions.limit ?? null,
      normalizedOptions.offset,
      normalizedOptions.includeId ?? null,
      normalizedOptions.includeEmpty,
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
      .map(async (file) => ({ ...file, ...(await this.sessionSortKey(file)) })));
    // The gateway merge (embeddedGateway.listSessions) orders rows by the
    // total order `updatedAt desc, then session id asc`, and its bounded
    // fan-out assumes every store truncates under that SAME order: a row at
    // merged rank r must sit at rank <= r inside its own store's listing.
    // The tiebreak must therefore use each row's CANONICAL id — the header id
    // already parsed into the prefix cache — not a filename-derived guess:
    // ids may legally contain `_`, which a last-underscore split truncates.
    // Sorting on recency alone left equal-updatedAt sessions in readdir
    // order, so one could fall outside the requested prefix and then fail
    // the gateway's cursor filter forever — a session that never appears.
    visibleFiles.sort((a, b) =>
      b.sortMtimeMs - a.sortMtimeMs
      || a.sortId.localeCompare(b.sortId));

    const { offset, limit } = options;
    const includeId = options.includeId;
    const pageSummaries = await this.summarizeVisiblePage(visibleFiles, {
      ctx, offset, limit, includeId, includeEmpty: options.includeEmpty,
    });
    if (!includeId || pageSummaries.some((summary) => summary.id === includeId)) return pageSummaries;

    const includeSummary = await this.summarizeIncludedSession(ctx, includeId, referencedPiFiles);
    return includeSummary ? [...pageSummaries, includeSummary] : pageSummaries;
  }

  async create(
    ctx: SessionCtx,
    init?: { title?: string },
  ): Promise<SessionSummary> {
    const manualTitle = init?.title !== undefined
      ? normalizeUserSessionTitle(init.title)
      : undefined;
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
    if (manualTitle) {
      const pair = createUserSessionTitleEntries({
        title: manualTitle,
        parentId: null,
        timestamp: now,
        authorityId: randomUUID(),
        titleId: randomUUID(),
      });
      lines.push(JSON.stringify(pair.authority), JSON.stringify(pair.title));
    }

    // Write the transcript in pi's OWN `${timestamp}_${id}.jsonl` form, not a
    // `${id}.jsonl` wrapper. A wrapper would need a `pi_session_file` link to a
    // transcript that does not exist yet, so the first prompt would mint a
    // SECOND file and the wrapper would shadow it forever (empty cold reads,
    // forked history on restart, 404 renames, undead deletes). Being native
    // from birth means `loadPiSessionFile` hands this exact path to
    // `SessionManager.open`, which appends to it: one session, one file.
    const filepath = join(this.sessionDir, `${nativeSessionFilename(id, now)}`);
    await writeFile(filepath, lines.join("\n") + "\n", "utf-8");

    return {
      id,
      title: manualTitle ?? "New session",
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
      nativeSessionId: id,
      hasAssistantReply: false,
    };
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const resolved = await this.resolveSessionTranscript(ctx, sessionId);
    const title = projectedTranscriptTitle(resolved.sessionSummary, resolved.linkedSummary)
      ?? "New session";
    const updatedAtMs = resolved.transcriptSummary.latestMessageAtMs
      ?? Math.max(resolved.fileStat.mtime.getTime(), resolved.linkedMtimeMs ?? 0);

    return {
      id: resolved.resolvedSessionId,
      title,
      createdAt: resolved.header?.timestamp ?? resolved.fileStat.birthtime.toISOString(),
      updatedAt: new Date(updatedAtMs).toISOString(),
      turnCount: resolved.transcriptSummary.turnCount,
      ...(resolved.directNative
        ? {
            nativeSessionId: resolved.resolvedSessionId,
            hasAssistantReply: resolved.transcriptSummary.hasAssistantReply,
          }
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
    return {
      id: resolved.resolvedSessionId,
      messages,
      currentModel: currentModelFromTranscript(resolved.transcriptEntries),
    };
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
    transcriptEntries: SessionEntry[];
    sessionSummary: SessionTranscriptSummary;
    linkedSummary?: SessionTranscriptSummary;
    transcriptSummary: SessionTranscriptSummary;
    fileStat: Awaited<ReturnType<typeof fsStat>>;
    linkedMtimeMs?: number;
    filepath: string;
    directNative: boolean;
  }> {
    const filepath = await this.resolveSessionFile(sessionId, ctx);
    let content: string;
    try {
      content = await readFile(filepath, "utf-8");
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const parsedFile = parseSessionTranscript(content);
    const fileEntries = parsedFile.entries;
    const header = fileEntries.find(
      (e): e is SessionHeader => e.type === "session",
    );
    const timestampNamedNative = isTimestampNamedPiSessionFile(
      filepath,
      header?.id ?? sessionId,
    );

    if (!this.headerBelongsToCtx(header, ctx, timestampNamedNative)) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const sessionEntries = fileEntries.filter(
      (e): e is SessionEntry => e.type !== "session" && (e as { type?: string }).type !== "ui_snapshot",
    );

    const fileStat = await fsStat(filepath);
    const linkedPiFile = extractPiSessionFilePath(fileEntries);
    const directNative = timestampNamedNative && !linkedPiFile;
    const linked = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)
      ? await this.readLinkedPiSession(linkedPiFile)
      : null;
    const linkedEntries = linked?.entries.filter(
      (e): e is SessionEntry => e.type !== "session",
    ) ?? [];

    // Rebuild the transcript from every persisted entry in the same source the
    // summary projection selects, so list/load metrics cannot disagree.
    const transcriptSummary = selectTranscriptSummary(parsedFile.summary, linked?.summary);
    const transcriptEntries = transcriptSummary === linked?.summary ? linkedEntries : sessionEntries;

    return {
      resolvedSessionId: header?.id ?? sessionId,
      header,
      transcriptEntries,
      sessionSummary: parsedFile.summary,
      ...(linked ? { linkedSummary: linked.summary } : {}),
      transcriptSummary,
      fileStat,
      linkedMtimeMs: linked?.mtimeMs,
      filepath,
      directNative,
    };
  }

  /**
   * Addressed rename capability. Every resolved wrapper/native transcript is
   * appended through the same JSONL path under one process-local writer lock.
   */
  async rename(ctx: SessionCtx, sessionId: string, title: string): Promise<SessionSummary> {
    const trimmed = normalizeUserSessionTitle(title);
    return await this.withWriter(sessionId, async () => {
      const resolved = await this.resolveSessionTranscript(ctx, sessionId);
      if (resolved.directNative) {
        try {
          await appendVerifiedNativeRename(
            resolved.filepath,
            this.sessionDir,
            this.cwd,
            trimmed,
          );
        } finally {
          this.prefixCache.delete(resolved.filepath);
        }
        return await this.load(ctx, sessionId);
      }
      // A wrapper is the sole manual-title authority for wrapped sessions.
      // Linked Pi auto-titles remain transcript metadata, never a second write target.
      await appendVerifiedWrapperRename(resolved.filepath, trimmed);
      this.prefixCache.delete(resolved.filepath);
      return await this.load(ctx, sessionId);
    });
  }

  private async withWriter<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.writerTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.writerTails.set(key, tail);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.writerTails.get(key) === tail) this.writerTails.delete(key);
    }
  }

  // Synchronous variant used during session initialization so that no async
  // I/O hop is introduced before createAgentSession (which would break test
  // timing when fake timers are in use). The file is tiny (metadata only).
  loadPiSessionFileSync(ctx: SessionCtx, sessionId: string): string | null {
    if (!SAFE_NATIVE_SESSION_ID.test(sessionId)) return null;
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
      const directNative = isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId);
      const linkedPiFile = extractPiSessionFilePath(entries);
      if (!directNative) {
        if (!this.headerBelongsToCtx(header, ctx)) return null;
        return linkedPiFile;
      }
      if (this.nativeFileBelongsToCtx(header, ctx)) return filepath;
      if (readHeaderSessionCtx(header) !== null) return null;
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
    if (!SAFE_NATIVE_SESSION_ID.test(sessionId)) return null;
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
      const directNative = isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId);
      const linkedPiFile = extractPiSessionFilePath(entries);
      if (!directNative) {
        if (!this.headerBelongsToCtx(header, ctx)) return null;
        return linkedPiFile;
      }
      if (this.nativeFileBelongsToCtx(header, ctx)) return filepath;
      if (readHeaderSessionCtx(header) !== null) return null;
      const existingWrapper = await this.findWrapperReferencingNativeSession(filepath);
      if (existingWrapper) {
        const wrapperSessionId = await this.readSessionFileId(existingWrapper);
        if (wrapperSessionId !== sessionId) return null;
        const wrapperEntries = parseJsonlPrefixEntries(await readJsonlPrefix(existingWrapper));
        const wrapperHeader = wrapperEntries.find((entry): entry is SessionHeader => entry.type === "session");
        if (!this.headerBelongsToCtx(wrapperHeader, ctx)) return null;
        return extractPiSessionFilePath(wrapperEntries);
      }
      await this.ensureWrapperForNativeSession(sessionId, filepath, ctx);
      return filepath;
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
    if (!SAFE_NATIVE_SESSION_ID.test(sessionId)) {
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
    // A pinned transcript is authoritative about its own tenancy: serve it
    // directly (assert throws on a mismatch) and never launder it into a
    // wrapper minted for whichever ctx happened to read it first.
    if (ctx && (
      this.pathDerivedLegacyAccess
      || this.allowUnscopedNativeAccess
      || await this.nativeFilePin(matchedPath) !== null
    )) {
      await this.assertFileBelongsToCtx(matchedPath, ctx, sessionId);
      return matchedPath;
    }
    if (!ctx && this.pathDerivedLegacyAccess) return matchedPath;
    throw new Error(`Session not found: ${sessionId}`);
  }

  private async assertFileBelongsToCtx(filepath: string, ctx: SessionCtx, sessionId: string): Promise<void> {
    const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
    const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
    const directNative = !extractPiSessionFilePath(entries)
      && isTimestampNamedPiSessionFile(filepath, header?.id ?? sessionId);
    if (!this.headerBelongsToCtx(header, ctx, directNative)) {
      throw new Error(`Session not found: ${sessionId}`);
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

  private async sessionSortKey(
    { filepath, stat }: SessionFileStat,
  ): Promise<{ sortMtimeMs: number; sortId: string }> {
    let sortMtimeMs = stat.mtime.getTime();
    // Once a readable header supplies an id, it stays canonical even if a
    // later step (linked-file stat, native timestamp scan) throws — the
    // filename stem is only for files with no readable header at all.
    let headerId: string | undefined = undefined;
    const stemFallback = (): { sortMtimeMs: number; sortId: string } => ({
      sortMtimeMs,
      sortId: wrapperSessionId(filepath),
    });
    try {
      // One prefix read per file per listing: `referencedPiFiles` already
      // populated this cache entry. Its header id supplies BOTH the native-
      // file test and the canonical tiebreak id (the row's `summary.id`);
      // re-reading and re-parsing the prefix here was a second full-store
      // pass on every request (#1338).
      const cached = await this.readPrefixCache(filepath, stat);
      headerId = cached.headerId ?? undefined;
      const linkedPiFile = cached.referencedPiFile;
      if (linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)) {
        const linkedStat = await fsStat(linkedPiFile);
        sortMtimeMs = Math.max(sortMtimeMs, linkedStat.mtime.getTime());
      }
      if (!headerId) {
        // Headerless file: the stem is the id `resolveSessionFile` accepts —
        // never a last-underscore truncation.
        return stemFallback();
      }
      if (!isTimestampNamedPiSessionFile(filepath, headerId)) {
        // Readable header in a non-timestamp-named (wrapper) transcript: the
        // header id is canonical — it is exactly what `summary.id` emits — so
        // the gateway's full-id total order and this store's prefix agree.
        // Sorting by the filename here would order by a different key than
        // the id we report for the row (#1338 review round 2).
        return { sortMtimeMs, sortId: headerId };
      }
      if (cached.nativeSortMtimeMs !== undefined) {
        return { sortMtimeMs: cached.nativeSortMtimeMs, sortId: headerId };
      }
      const latest = await latestNativeMessageTimestamp(filepath, Number(stat.size));
      if (latest === undefined) return { sortMtimeMs, sortId: headerId };
      // Only a value derived purely from this file's own bytes is cacheable:
      // the (mtime, size) key does not invalidate on a linked file's change.
      this.prefixCache.set(filepath, { ...cached, nativeSortMtimeMs: latest });
      return { sortMtimeMs: latest, sortId: headerId };
    } catch {
      // Unreadable linked file / failed timestamp scan: keep the file's own
      // mtime. If a header was already read, its id remains the tiebreak key;
      // only a file with no readable header falls back to the stem.
      return headerId ? { sortMtimeMs, sortId: headerId } : stemFallback();
    }
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
      const directNative = isTimestampNamedPiSessionFile(filepath, header.id);
      if (directNative
        ? !this.nativeFileBelongsToCtx(header, ctx)
        : !this.storedCtxBelongsToCtx(sessionCtx, ctx)
      ) return null;

      const entries = parseJsonlPrefixEntries(content);
      const linkedPiFile = extractPiSessionFilePath(entries);
      const [sessionScan, linked] = await Promise.all([
        this.readTranscriptSummary(filepath),
        linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)
          ? this.readLinkedPiSessionSummary(linkedPiFile)
          : null,
      ]);
      if (!sessionScan) return null;
      const sessionTranscript = sessionScan.summary;
      const transcript = selectTranscriptSummary(sessionTranscript, linked?.summary);
      const title = projectedTranscriptTitle(sessionTranscript, linked?.summary) ?? "New session";
      const updatedAtMs = transcript.latestMessageAtMs
        ?? Math.max(Number(fileStat.mtimeMs), linked?.mtimeMs ?? 0);

      const summary = {
        id: header.id,
        title,
        createdAt: header.timestamp,
        updatedAt: new Date(updatedAtMs).toISOString(),
        turnCount: transcript.turnCount,
        ...(directNative
          ? {
              nativeSessionId: header.id,
              hasAssistantReply: transcript.hasAssistantReply,
            }
          : {}),
      };
      const stableForCache = sessionScan.stable
        && sameFileSnapshot(fileStat, sessionScan.stat)
        && (!linked || linked.stable);
      if (stableForCache) {
        this.prefixCache.set(filepath, {
          dev: Number(sessionScan.stat.dev),
          ino: Number(sessionScan.stat.ino),
          mtimeMs: Number(sessionScan.stat.mtimeMs),
          ctimeMs: Number(sessionScan.stat.ctimeMs),
          size: Number(sessionScan.stat.size),
          referencedPiFile: linkedPiFile,
          // Preserve the canonical row/tiebreak id and native sort scan added
          // by #1338 while retaining the exact snapshot identity required by
          // title-authority cache correctness.
          headerId: header.id,
          ...(cached?.nativeSortMtimeMs !== undefined ? { nativeSortMtimeMs: cached.nativeSortMtimeMs } : {}),
          sessionCtx,
          ...(linked ? {
            linkedDev: Number(linked.dev),
            linkedIno: Number(linked.ino),
            linkedMtimeMs: linked.mtimeMs,
            linkedCtimeMs: linked.ctimeMs,
            linkedSize: linked.size,
          } : {}),
          summary,
        });
      }
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
    if (cached.dev !== Number(fileStat.dev) || cached.ino !== Number(fileStat.ino)
      || cached.mtimeMs !== Number(fileStat.mtimeMs)
      || cached.ctimeMs !== Number(fileStat.ctimeMs)
      || cached.size !== Number(fileStat.size)) return undefined;
    return cached;
  }

  private async cachedSummaryIsFresh(filepath: string, cached: PrefixCacheEntry): Promise<boolean> {
    const linkedPiFile = cached.referencedPiFile;
    if (!linkedPiFile || resolve(linkedPiFile) === resolve(filepath)) return true;
    try {
      const linkedStat = await fsStat(linkedPiFile);
      return cached.linkedDev === Number(linkedStat.dev)
        && cached.linkedIno === Number(linkedStat.ino)
        && cached.linkedMtimeMs === Number(linkedStat.mtimeMs)
        && cached.linkedCtimeMs === Number(linkedStat.ctimeMs)
        && cached.linkedSize === Number(linkedStat.size);
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

    let before = fileStat;
    let entry: PrefixCacheEntry | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const content = await readJsonlPrefix(filepath);
      const after = await fsStat(filepath);
      const entries = parseJsonlPrefixEntries(content);
      const header = entries.find((item): item is SessionHeader => item.type === "session");
      entry = {
        dev: Number(after.dev),
        ino: Number(after.ino),
        mtimeMs: Number(after.mtimeMs),
        ctimeMs: Number(after.ctimeMs),
        size: Number(after.size),
        referencedPiFile: extractPiSessionFilePath(entries),
        headerId: header?.id ?? null,
        sessionCtx: readHeaderSessionCtx(header),
      };
      if (sameFileSnapshot(before, after)) {
        this.prefixCache.set(filepath, entry);
        return entry;
      }
      before = after;
    }
    return entry!;
  }

  private async summarizeVisiblePage(
    visibleFiles: Array<{ filepath: string; stat: Awaited<ReturnType<typeof fsStat>> }>,
    options: {
      ctx: SessionCtx;
      offset: number;
      limit: number | undefined;
      includeId: string | undefined;
      includeEmpty: boolean;
    },
  ): Promise<SessionSummary[]> {
    if (options.limit === 0) return [];

    const page: SessionSummary[] = [];
    let validSeen = 0;
    let index = 0;
    const batchSize = Math.min(
      MAX_CONCURRENT_SESSION_SUMMARIES,
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
        // A session is written eagerly at create, so a New chat the user never
        // sent leaves a real transcript with no turns. It is not user content
        // yet, so keep it out of every listing — except when the client asks
        // for it by id, which is exactly how a just-created session resolves.
        if (summary.turnCount === 0 && !options.includeEmpty && summary.id !== options.includeId) {
          continue;
        }
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
    summary: SessionTranscriptSummary;
    dev: number;
    ino: number;
    mtimeMs: number;
    ctimeMs: number;
    size: number;
    stable: boolean;
  } | null> {
    let last: Awaited<ReturnType<typeof fsStat>> | undefined;
    let parsed: ReturnType<typeof parseSessionTranscript> | undefined;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const before = await fsStat(filepath);
        parsed = parseSessionTranscript(await readFile(filepath, "utf-8"));
        const after = await fsStat(filepath);
        last = after;
        if (sameFileSnapshot(before, after)) {
          return {
            ...parsed,
            dev: Number(after.dev),
            ino: Number(after.ino),
            mtimeMs: Number(after.mtimeMs),
            ctimeMs: Number(after.ctimeMs),
            size: Number(after.size),
            stable: true,
          };
        }
      }
      return parsed && last ? {
        ...parsed,
        dev: Number(last.dev),
        ino: Number(last.ino),
        mtimeMs: Number(last.mtimeMs),
        ctimeMs: Number(last.ctimeMs),
        size: Number(last.size),
        stable: false,
      } : null;
    } catch {
      return null;
    }
  }

  private async readTranscriptSummary(filepath: string): Promise<{
    summary: SessionTranscriptSummary;
    stat: Awaited<ReturnType<typeof fsStat>>;
    stable: boolean;
  } | null> {
    let last: Awaited<ReturnType<typeof fsStat>> | undefined;
    let summary: SessionTranscriptSummary | undefined;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const before = await fsStat(filepath);
        summary = await summarizeSessionTranscript(filepath);
        const after = await fsStat(filepath);
        last = after;
        if (sameFileSnapshot(before, after)) return { summary, stat: after, stable: true };
      }
      return summary && last ? { summary, stat: last, stable: false } : null;
    } catch {
      return null;
    }
  }

  private async readLinkedPiSessionSummary(filepath: string): Promise<{
    summary: SessionTranscriptSummary;
    dev: number;
    ino: number;
    mtimeMs: number;
    ctimeMs: number;
    size: number;
    stable: boolean;
  } | null> {
    const scan = await this.readTranscriptSummary(filepath);
    return scan ? {
      summary: scan.summary,
      dev: Number(scan.stat.dev),
      ino: Number(scan.stat.ino),
      mtimeMs: Number(scan.stat.mtimeMs),
      ctimeMs: Number(scan.stat.ctimeMs),
      size: Number(scan.stat.size),
      stable: scan.stable,
    } : null;
  }

  private headerBelongsToCtx(
    header: SessionHeader | undefined,
    ctx: SessionCtx,
    directNative = false,
  ): boolean {
    if (directNative) return this.nativeFileBelongsToCtx(header, ctx);
    return header ? this.storedCtxBelongsToCtx(readHeaderSessionCtx(header), ctx) : isEmptySessionCtx(ctx);
  }

  /**
   * A bare Pi transcript carries no tenancy, so only a path-derived trusted
   * local store may reach it. Boring-created native transcripts carry exact
   * persisted tenancy and remain reachable by hosted/namespaced stores without
   * minting a compatibility wrapper.
   */
  private nativeFileBelongsToCtx(header: SessionHeader | undefined, ctx: SessionCtx): boolean {
    const pinned = readHeaderSessionCtx(header);
    if (pinned === null && this.allowUnscopedNativeAccess) return true;
    // Main's path-derived store is itself a trusted-local capability: terminal
    // Pi and the local app intentionally share its unscoped/workspace-pinned
    // transcripts. Explicit/namespaced hosted stores keep the stricter native
    // gate from this branch and require an exact persisted tenancy pin.
    if (this.pathDerivedLegacyAccess) return this.storedCtxBelongsToCtx(pinned, ctx);
    return pinned !== null && sameSessionCtx(pinned, ctx);
  }

  /** The Boring tenancy pin on a native transcript, or null when unpinned. */
  private async nativeFilePin(filepath: string): Promise<StoredSessionCtx> {
    try {
      const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
      return readHeaderSessionCtx(entries.find((entry): entry is SessionHeader => entry.type === "session"));
    } catch {
      return null;
    }
  }

  private storedCtxBelongsToCtx(storedCtx: StoredSessionCtx, ctx: SessionCtx): boolean {
    const trustedLocalCtx = !ctx.userId || ctx.userId === TRUSTED_LOCAL_USER_ID;
    if (storedCtx === null) {
      return this.allowLegacyUnscopedAccess
        && (isLegacyUnscopedCtx(ctx) || (this.pathDerivedLegacyAccess && trustedLocalCtx));
    }
    if (sameSessionCtx(storedCtx, ctx)) return true;
    if (!this.pathDerivedLegacyAccess || !trustedLocalCtx) return false;
    if (isEmptySessionCtx(storedCtx)) return true;
    return Boolean(
      storedCtx.workspaceId
      && storedCtx.workspaceId === ctx.workspaceId
      && (
        !storedCtx.userId
        || (!ctx.userId && storedCtx.userId === TRUSTED_LOCAL_USER_ID)
      ),
    );
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

/**
 * Pi's own transcript filename convention (see SessionManager.newSession):
 * the ISO timestamp with `:`/`.` replaced by `-`, then `_${sessionId}.jsonl`.
 * Mirrored here so a Boring-minted transcript is indistinguishable from one pi
 * created itself, and `isTimestampNamedPiSessionFile` recognises it.
 */
function nativeSessionFilename(sessionId: string, isoTimestamp: string): string {
  return `${isoTimestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`;
}

/**
 * Recency-plus-tiebreak key implementing the gateway's store-side order.
 * See {@link PiSessionStore.sessionSortKey} for how `sortId` is derived.
 */
interface SessionSortKey {
  sortMtimeMs: number;
  /** Canonical session id: header id whenever a readable header exists (wrapper or native); stem only for headerless files. */
  sortId: string;
}

/**
 * Session id of a HEADERLESS transcript: `resolveSessionFile` looks wrapper
 * files up as `${sessionId}.jsonl`, so for those the stem is the only id
 * available. Never split on `_`: SAFE_NATIVE_SESSION_ID allows it
 * (`a_z.jsonl` wraps the id `a_z`). Used ONLY as a last resort — any file
 * with a readable header takes its id (and sort key) from that header
 * instead (see {@link PiSessionStore.sessionSortKey}).
 */
function wrapperSessionId(filepath: string): string {
  const base = basename(filepath);
  return base.endsWith(".jsonl") ? base.slice(0, -".jsonl".length) : base;
}

function isTimestampNamedPiSessionFile(filepath: string, sessionId: string): boolean {
  const filename = basename(filepath);
  return /^\d{4}-\d{2}-\d{2}/.test(filename)
    && filename.endsWith(`_${sessionId}.jsonl`);
}

function sameFileSnapshot(
  first: Awaited<ReturnType<typeof fsStat>>,
  second: Awaited<ReturnType<typeof fsStat>>,
): boolean {
  return first.dev === second.dev && first.ino === second.ino
    && first.size === second.size
    && first.mtimeMs === second.mtimeMs
    && first.ctimeMs === second.ctimeMs;
}

function selectTranscriptSummary(
  wrapper: SessionTranscriptSummary,
  native?: SessionTranscriptSummary,
): SessionTranscriptSummary {
  return native && native.entryCount > 0 ? native : wrapper;
}

function projectedTranscriptTitle(
  wrapper: SessionTranscriptSummary,
  native?: SessionTranscriptSummary,
): string | undefined {
  const selected = selectTranscriptSummary(wrapper, native);
  // Wrapped sessions have one canonical authority owner. A later linked-native
  // auto title cannot override a manual title committed to the wrapper.
  return wrapper.userTitle
    ?? selected.title
    ?? wrapper.title
    ?? native?.title
    ?? selected.firstUserTitle;
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

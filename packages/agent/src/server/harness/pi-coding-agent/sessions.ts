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
} from "node:fs/promises";
import { readFileSync, readdirSync, writeFileSync, type Stats } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { getEnv } from "../../config/env.js";
import {
  SessionManager,
  type SessionEntry,
  type SessionHeader,
  type SessionInfoEntry,
  type SessionMessageEntry,
  CURRENT_SESSION_VERSION,
} from "@mariozechner/pi-coding-agent";
import type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionDetail,
  SessionListOptions,
} from "../../../shared/session.js";
import {
  activityTimestampOrFallback,
  countUserTurns,
  extractPiSessionFilePath,
  extractSessionHeaderId,
  extractTitle,
  hasAssistantReply,
  latestMessageTimestampFromEntries,
  parseJsonlPrefixEntries,
  readJsonlPrefix,
  readJsonlPrefixSync,
  readTranscript,
  readTranscriptEntries,
  safeParseEntries,
  sessionEntries,
  sessionHeader,
  timestampMs,
  type TranscriptEntry,
} from "./transcript.js";
import { mapWithConcurrency, TranscriptIndex, type TranscriptSummary } from "./transcriptIndex.js";

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
const TRANSCRIPT_ACTIVITY_CONCURRENCY = 8;
const DEFAULT_LEGACY_WORKSPACE_ID = "default";

type SessionFileStat = { filepath: string; stat: Stats };
type StoredSessionCtx = SessionCtx | null;

/** Metadata is wrapper-local. Transcript activity lives in TranscriptIndex. */
interface SessionFileMetadata {
  mtimeMs: number;
  ctimeMs: number | bigint;
  size: number;
  identity: string;
  referencedPiFile: string | null;
  header?: SessionHeader;
}

interface NormalizedListOptions {
  limit: number | undefined;
  offset: number;
  includeId: string | undefined;
}

type ListCandidate = SessionFileStat & { metadata: SessionFileMetadata };

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
  private metadataCache = new Map<string, SessionFileMetadata>();
  private transcriptIndex = new TranscriptIndex();
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
    const filepaths = files.filter((file) => file.endsWith(".jsonl")).map((file) => join(this.sessionDir, file));
    const existingFiles = (await mapWithConcurrency(filepaths, TRANSCRIPT_ACTIVITY_CONCURRENCY, async (filepath) => {
      try {
        return { filepath, stat: await fsStat(filepath) };
      } catch {
        return null;
      }
    })).filter((item): item is SessionFileStat => item !== null);

    // Phase one is bounded-concurrency ordering only. It scans every visible
    // transcript for its activity timestamp, but does not build list rows.
    const candidates = (await mapWithConcurrency(existingFiles, TRANSCRIPT_ACTIVITY_CONCURRENCY, async (file) => {
      const metadata = await this.readMetadata(file.filepath, file.stat);
      return metadata ? { ...file, metadata } : null;
    })).filter((candidate): candidate is ListCandidate => candidate !== null);
    const referencedPiFiles = new Set(
      candidates
        .map(({ filepath, metadata }) => metadata.referencedPiFile && resolve(metadata.referencedPiFile) !== resolve(filepath)
          ? resolve(metadata.referencedPiFile)
          : null)
        .filter((filepath): filepath is string => filepath !== null),
    );
    const visible = candidates.filter(({ filepath }) => !referencedPiFiles.has(resolve(filepath)));
    const ordered = await mapWithConcurrency(visible, TRANSCRIPT_ACTIVITY_CONCURRENCY, async (candidate) => ({
      ...candidate,
      sortActivityMs: await this.sessionSortActivityMs(candidate),
    }));
    ordered.sort((a, b) => b.sortActivityMs - a.sortActivityMs || a.filepath.localeCompare(b.filepath));

    const pageSummaries = await this.summarizeVisiblePage(ordered, { ctx, offset: options.offset, limit: options.limit });
    if (!options.includeId || pageSummaries.some((summary) => summary.id === options.includeId)) return pageSummaries;

    const includeSummary = await this.summarizeIncludedSession(ctx, options.includeId, referencedPiFiles);
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
    this.metadataCache.delete(filepath);
    this.metadataCache.delete(target);
    this.transcriptIndex.clear(target);
    return this.load(ctx, sessionId);
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const resolved = await this.resolveSessionTranscript(ctx, sessionId);
    const activityEntries = resolved.linkedAvailable ? resolved.linkedEntries : resolved.sessionEntries;
    const title = extractTitle(activityEntries) ?? extractTitle(resolved.sessionEntries) ?? "New session";
    const turnCount = countUserTurns(resolved.transcriptEntries);
    const latestMessageTimestamp = latestMessageTimestampFromEntries(activityEntries);
    const directNative = isTimestampNamedPiSessionFile(resolved.filepath, resolved.resolvedSessionId)
      && !resolved.linkedFilepath;

    const summary = {
      id: resolved.resolvedSessionId,
      title,
      createdAt: resolved.header?.timestamp ?? resolved.fileStat.birthtime.toISOString(),
      updatedAt: activityTimestampOrFallback(
        latestMessageTimestamp,
        resolved.header?.timestamp,
        resolved.fileStat.birthtime.getTime(),
      ),
      turnCount,
    };
    return directNative
      ? { ...summary, nativeSessionId: resolved.resolvedSessionId, hasAssistantReply: hasAssistantReply(resolved.transcriptEntries) }
      : summary;
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
    linkedAvailable: boolean;
  }> {
    const filepath = await this.resolveSessionFile(sessionId, ctx);
    let fileEntries: TranscriptEntry[];
    try {
      fileEntries = await readTranscriptEntries(filepath);
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

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
    const storedSessionEntries = sessionEntries(fileEntries);

    const fileStat = await fsStat(filepath);
    const linkedPiFile = extractPiSessionFilePath(fileEntries);
    const linked = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)
      ? await readTranscript(linkedPiFile).catch(() => null)
      : null;
    const linkedEntries = linked ? sessionEntries(linked.entries) : [];

    // Rebuild the transcript from every persisted message entry in file order
    // (preferring a linked native transcript) rather than pi's compacted LLM
    // working context, so reloads recover the full conversation.
    const transcriptEntries = linked ? linkedEntries : storedSessionEntries;

    return {
      resolvedSessionId: header?.id ?? sessionId,
      header,
      filepath,
      sessionEntries: storedSessionEntries,
      linkedEntries,
      transcriptEntries,
      fileStat,
      linkedMtimeMs: linked?.stat.mtime.getTime(),
      linkedFilepath: linkedPiFile ?? undefined,
      linkedAvailable: linked !== null,
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
    // The wrapper's linkage changes which transcript owns its list projection.
    // Drop both local metadata and its former direct-transcript projection.
    this.metadataCache.delete(filepath);
    this.transcriptIndex.clear(filepath);
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
    this.metadataCache.delete(filepath);
    this.transcriptIndex.clear(filepath);
    if (linkedPiFile && resolve(linkedPiFile) !== resolve(filepath)) {
      await rm(linkedPiFile, { force: true });
      this.metadataCache.delete(linkedPiFile);
      this.transcriptIndex.clear(linkedPiFile);
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
      return extractPiSessionFilePath(await readTranscriptEntries(filepath));
    } catch {
      return null;
    }
  }

  private async readMetadata(
    filepath: string,
    fileStat: Awaited<ReturnType<typeof fsStat>>,
  ): Promise<SessionFileMetadata | null> {
    const cached = this.metadataCache.get(filepath);
    if (cached && this.metadataIsCurrent(cached, fileStat)) return cached;
    try {
      const entries = parseJsonlPrefixEntries(await readJsonlPrefix(filepath));
      const header = sessionHeader(entries);
      const metadata: SessionFileMetadata = {
        mtimeMs: fileStat.mtime.getTime(),
        ctimeMs: fileStat.ctimeMs,
        size: Number(fileStat.size),
        identity: fileIdentity(fileStat),
        referencedPiFile: extractPiSessionFilePath(entries),
        header,
      };
      this.metadataCache.set(filepath, metadata);
      return metadata;
    } catch {
      return null;
    }
  }

  private metadataIsCurrent(metadata: SessionFileMetadata, fileStat: Awaited<ReturnType<typeof fsStat>>): boolean {
    return metadata.mtimeMs === fileStat.mtime.getTime()
      && metadata.ctimeMs === fileStat.ctimeMs
      && metadata.size === Number(fileStat.size)
      && metadata.identity === fileIdentity(fileStat);
  }

  private async sessionSortActivityMs(candidate: ListCandidate): Promise<number> {
    const { filepath, stat, metadata } = candidate;
    const linkedPiFile = metadata.referencedPiFile;
    const transcriptPath = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath) ? linkedPiFile : filepath;
    const directTranscript = transcriptPath === filepath;
    try {
      const transcriptStat = directTranscript ? stat : await fsStat(transcriptPath);
      const activity = await this.transcriptIndex.activity(transcriptPath, transcriptStat, {
        allowAppendReuse: directTranscript,
      });
      return timestampMs(activity.latestMessageTimestamp)
        ?? timestampMs(metadata.header?.timestamp)
        ?? stat.birthtime.getTime();
    } catch {
      if (!directTranscript) {
        try {
          const wrapperActivity = await this.transcriptIndex.activity(filepath, stat, {
            allowAppendReuse: true,
          });
          return timestampMs(wrapperActivity.latestMessageTimestamp)
            ?? timestampMs(metadata.header?.timestamp)
            ?? stat.birthtime.getTime();
        } catch {
          // Preserve stable header ordering when both linked and wrapper files are unreadable.
        }
      }
      return timestampMs(metadata.header?.timestamp) ?? stat.birthtime.getTime();
    }
  }

  private async summarizeFile(
    ctx: SessionCtx,
    filepath: string,
    existingStat?: Awaited<ReturnType<typeof fsStat>>,
    existingMetadata?: SessionFileMetadata,
  ): Promise<SessionSummary | null> {
    try {
      const fileStat = existingStat ?? await fsStat(filepath);
      const metadata = existingMetadata ?? await this.readMetadata(filepath, fileStat);
      const header = metadata?.header;
      if (!metadata || !header) return null;
      const timestampNamedPiFile = isTimestampNamedPiSessionFile(filepath, header.id);
      if (!this.headerBelongsToCtx(header, ctx, timestampNamedPiFile)) return null;

      const linkedPiFile = metadata.referencedPiFile;
      const linkedPath = linkedPiFile && resolve(linkedPiFile) !== resolve(filepath) ? linkedPiFile : null;
      let transcript: TranscriptSummary;
      let linkedAvailable = false;
      if (linkedPath) {
        try {
          transcript = await this.transcriptIndex.summary(linkedPath, await fsStat(linkedPath));
          linkedAvailable = true;
        } catch {
          // A stale link still represents its wrapper session. Keep it listable
          // from wrapper metadata until the native transcript returns.
          transcript = await this.transcriptIndex.summary(filepath, fileStat);
        }
      } else {
        transcript = await this.transcriptIndex.summary(filepath, fileStat, {
          allowAppendReuse: true,
        });
      }
      const directNative = timestampNamedPiFile && linkedPath === null;
      let title = transcript.lastTitle ?? transcript.firstUserTitle;
      if (linkedAvailable && title === undefined) {
        // Most linked rows never stream their wrapper. It is only a legacy
        // fallback when native metadata cannot provide a display title.
        const wrapper = await this.transcriptIndex.summary(filepath, fileStat);
        title = wrapper.lastTitle ?? wrapper.firstUserTitle;
      }
      title ??= "New session";

      const summary = {
        id: header.id,
        title,
        createdAt: header.timestamp,
        updatedAt: activityTimestampOrFallback(
          transcript.latestMessageTimestamp,
          header.timestamp,
          fileStat.birthtime.getTime(),
        ),
        turnCount: transcript.userTurnCount,
      };
      return directNative
        ? { ...summary, nativeSessionId: header.id, hasAssistantReply: transcript.hasAssistantReply }
        : summary;
    } catch {
      return null;
    }
  }

  private async summarizeVisiblePage(
    visibleFiles: Array<ListCandidate & { sortActivityMs: number }>,
    options: { ctx: SessionCtx; offset: number; limit: number | undefined },
  ): Promise<SessionSummary[]> {
    if (options.limit === 0) return [];

    const page: SessionSummary[] = [];
    let validSeen = 0;
    let index = 0;
    const batchSize = options.limit === undefined
      ? TRANSCRIPT_ACTIVITY_CONCURRENCY
      : Math.max(1, Math.min(TRANSCRIPT_ACTIVITY_CONCURRENCY, options.limit));

    while (index < visibleFiles.length && (options.limit === undefined || page.length < options.limit)) {
      const batch = visibleFiles.slice(index, index + batchSize);
      index += batch.length;
      // Phase two: full bounded projections only for the requested page (and
      // any malformed candidates that must be skipped to make it exact).
      const summaries = await mapWithConcurrency(batch, TRANSCRIPT_ACTIVITY_CONCURRENCY, ({ filepath, stat, metadata }) =>
        this.summarizeFile(options.ctx, filepath, stat, metadata),
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
    this.metadataCache.delete(wrapperPath);
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
    this.metadataCache.delete(wrapperPath);
    return wrapperPath;
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

function fileIdentity(fileStat: { dev: number | bigint; ino: number | bigint }): string {
  return `${fileStat.dev}:${fileStat.ino}`;
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
  entries: TranscriptEntry[],
  ctx?: SessionCtx,
): string {
  const nativeHeader = sessionHeader(entries);
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
    { type: "pi_session_file", timestamp, path: piFilePath },
  ].map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function isTimestampNamedPiSessionFile(filepath: string, sessionId: string): boolean {
  return basename(filepath).endsWith(`_${sessionId}.jsonl`);
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

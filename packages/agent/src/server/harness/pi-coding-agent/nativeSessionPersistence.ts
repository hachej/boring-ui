import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { ErrorCode } from "../../../shared/error-codes.js";
import { isValidClientNativeSessionId } from "../../../shared/session.js";

export const NATIVE_SESSION_PRE_PERSISTENCE_FAILURE = Symbol("native-session-pre-persistence-failure");
export const NATIVE_SESSION_CLAIM_TTL_MS = 30_000;

export interface NativeSessionIdClaim {
  release(): Promise<void>;
}

export async function createPersistedNativeSessionManager(
  runtimeCwd: string,
  nativeSessionDir: string,
  onPersisted?: (id: string) => void,
  desiredSessionId?: string,
): Promise<SessionManager> {
  await mkdir(nativeSessionDir, { recursive: true });
  if (desiredSessionId !== undefined) {
    return createPersistedNativeSessionManagerWithId(
      runtimeCwd,
      nativeSessionDir,
      desiredSessionId,
      onPersisted,
    );
  }
  let sessionManager = SessionManager.create(runtimeCwd, nativeSessionDir);
  const nativeFile = sessionManager.getSessionFile();
  const initialId = sessionManager.getSessionId();
  const header = sessionManager.getHeader();
  let nativeSessionId: string | undefined;

  if (nativeFile && header) {
    let createdPlaceholder = false;
    try {
      try {
        await writeFile(nativeFile, '', { flag: 'wx' });
        createdPlaceholder = true;
      } catch (error) {
        if ((error as { code?: string }).code !== 'EEXIST') throw error;
      }
      sessionManager = SessionManager.open(nativeFile, nativeSessionDir, runtimeCwd);
      const openedId = sessionManager.getSessionId();
      nativeSessionId = openedId;
      if (openedId !== initialId) {
        const reconciledFile = join(nativeSessionDir, basename(nativeFile).replace(initialId, openedId));
        let renamed = false;
        try {
          await rename(nativeFile, reconciledFile);
          renamed = true;
        } catch {
          try {
            await writeFile(nativeFile, `${JSON.stringify({ ...header, id: initialId })}\n`);
            nativeSessionId = initialId;
            sessionManager = SessionManager.open(nativeFile, nativeSessionDir, runtimeCwd);
          } catch {
            // The opened ID no longer matches this filename and restoring the
            // initial ID failed. It is not safe to expose either ID.
            const cleanupFailed = createdPlaceholder && await unlink(nativeFile).then(
              () => false,
              () => true,
            );
            nativeSessionId = undefined;
            throw Object.assign(new Error(
              cleanupFailed
                ? "Native Pi session setup failed before persistence; cleanup of the unusable transcript also failed."
                : "Native Pi session setup failed before persistence.",
            ), {
              code: ErrorCode.enum.TOOL_EXECUTION_ERROR,
              statusCode: 500,
              ...(cleanupFailed ? { cleanupError: "Could not remove the unusable native session file." } : {}),
              [NATIVE_SESSION_PRE_PERSISTENCE_FAILURE]: true,
            });
          }
        }
        if (renamed) sessionManager = SessionManager.open(reconciledFile, nativeSessionDir, runtimeCwd);
      }
      nativeSessionId = sessionManager.getSessionId();
    } catch (error) {
      if (!nativeSessionId && createdPlaceholder) await unlink(nativeFile).catch(() => {});
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        ...(nativeSessionId ? { nativeSessionId } : {}),
      });
    }
  }

  nativeSessionId ??= sessionManager.getSessionId();
  const persistedFile = sessionManager.getSessionFile();
  const persistedHeader = sessionManager.getHeader();
  if (
    nativeSessionId
    && persistedFile
    && persistedHeader?.id === nativeSessionId
    && basename(persistedFile).endsWith(`_${nativeSessionId}.jsonl`)
  ) {
    onPersisted?.(nativeSessionId);
  }
  return sessionManager;
}

async function createPersistedNativeSessionManagerWithId(
  runtimeCwd: string,
  nativeSessionDir: string,
  desiredSessionId: string,
  onPersisted?: (id: string) => void,
): Promise<SessionManager> {
  if (!isValidClientNativeSessionId(desiredSessionId)) {
    throw Object.assign(new Error('invalid native Pi session id'), {
      code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
      statusCode: 400,
      [NATIVE_SESSION_PRE_PERSISTENCE_FAILURE]: true,
    });
  }

  // Pi accepts duplicate caller-supplied ids because its filenames include a
  // timestamp. Claim the id in the shared namespace before inventory/create.
  const claim = await acquireNativeSessionIdClaim(nativeSessionDir, desiredSessionId);
  if (!claim) throw duplicateNativeSessionId(desiredSessionId);

  try {
    const duplicate = (await SessionManager.listAll(nativeSessionDir))
      .some((session) => session.id === desiredSessionId);
    if (duplicate) throw duplicateNativeSessionId(desiredSessionId);

    let sessionManager = SessionManager.create(runtimeCwd, nativeSessionDir, { id: desiredSessionId });
    const nativeFile = sessionManager.getSessionFile();
    const header = sessionManager.getHeader();
    if (!nativeFile || !header) {
      throw Object.assign(new Error('native Pi session did not provide a persistent transcript'), {
        code: ErrorCode.enum.TOOL_EXECUTION_ERROR,
        statusCode: 500,
        [NATIVE_SESSION_PRE_PERSISTENCE_FAILURE]: true,
      });
    }

    try {
      // Persist the caller-supplied header directly. Opening an empty placeholder
      // would make Pi mint a replacement id before the first append.
      await writeFile(nativeFile, `${JSON.stringify(header)}\n`, { flag: 'wx' });
    } catch (error) {
      if ((error as { code?: string }).code === 'EEXIST') throw duplicateNativeSessionId(desiredSessionId);
      throw error;
    }
    onPersisted?.(desiredSessionId);
    sessionManager = SessionManager.open(nativeFile, nativeSessionDir, runtimeCwd);
    return sessionManager;
  } finally {
    await claim.release().catch(() => {});
  }
}

export async function acquireNativeSessionIdClaim(
  nativeSessionDir: string,
  desiredSessionId: string,
): Promise<NativeSessionIdClaim | undefined> {
  if (!isValidClientNativeSessionId(desiredSessionId)) {
    throw new TypeError('invalid native Pi session id');
  }
  await mkdir(nativeSessionDir, { recursive: true });
  const claimPath = nativeSessionClaimPath(nativeSessionDir, desiredSessionId);
  const token = randomUUID();
  if (createExclusiveMarker(claimPath, token)) return ownedClaim(claimPath, token);

  const claimStat = tryStat(claimPath);
  if (!claimStat || !markerIsStale(claimStat.mtimeMs)) return undefined;

  const stalePath = `${claimPath}.${token}.stale`;
  try {
    renameSync(claimPath, stalePath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return createExclusiveMarker(claimPath, token) ? ownedClaim(claimPath, token) : undefined;
  } finally {
    tryUnlink(stalePath);
  }
}

export function nativeSessionClaimPath(nativeSessionDir: string, desiredSessionId: string): string {
  return join(nativeSessionDir, `.native-session-${desiredSessionId}.lock`);
}

function createExclusiveMarker(path: string, token: string): boolean {
  let descriptor: number;
  try {
    // Node maps "wx" to open(2) with O_CREAT | O_EXCL, which is atomic across
    // processes sharing this filesystem. EEXIST is the clean losing outcome.
    descriptor = openSync(path, 'wx');
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false;
    throw error;
  }
  try {
    writeFileSync(descriptor, token, 'utf8');
    return true;
  } catch (error) {
    tryUnlink(path);
    throw error;
  } finally {
    closeSync(descriptor);
  }
}

function ownedClaim(path: string, token: string): NativeSessionIdClaim {
  const heartbeat = setInterval(() => {
    try {
      if (readMarkerToken(path) !== token) return clearInterval(heartbeat);
      const now = new Date();
      utimesSync(path, now, now);
    } catch {
      clearInterval(heartbeat);
    }
  }, NATIVE_SESSION_CLAIM_TTL_MS / 2);
  heartbeat.unref();
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      if (readMarkerToken(path) === token) tryUnlink(path);
    },
  };
}

function readMarkerToken(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

function tryStat(path: string): { mtimeMs: number } | undefined {
  try {
    return statSync(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

function markerIsStale(mtimeMs: number): boolean {
  return mtimeMs <= Date.now() - NATIVE_SESSION_CLAIM_TTL_MS;
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

function duplicateNativeSessionId(sessionId: string): Error {
  return Object.assign(new Error(`native Pi session already exists: ${sessionId}`), {
    code: ErrorCode.enum.SESSION_LOCKED,
    statusCode: 409,
    [NATIVE_SESSION_PRE_PERSISTENCE_FAILURE]: true,
  });
}

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { ErrorCode } from "../../../shared/error-codes.js";
import { SAFE_CLIENT_NATIVE_SESSION_ID } from "../../../shared/session.js";

export const NATIVE_SESSION_PRE_PERSISTENCE_FAILURE = Symbol("native-session-pre-persistence-failure");

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
  if (
    desiredSessionId.length > 128
    || !SAFE_CLIENT_NATIVE_SESSION_ID.test(desiredSessionId)
  ) {
    throw Object.assign(new Error('invalid native Pi session id'), {
      code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
      statusCode: 400,
      [NATIVE_SESSION_PRE_PERSISTENCE_FAILURE]: true,
    });
  }

  // Pi accepts duplicate caller-supplied ids because its filenames include a
  // timestamp. Reserve the id independently so concurrent clients cannot both
  // pass the inventory check and create separate transcripts with one id.
  const reservationFile = join(nativeSessionDir, `.native-session-${desiredSessionId}.lock`);
  try {
    await writeFile(reservationFile, '', { flag: 'wx' });
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') throw duplicateNativeSessionId(desiredSessionId);
    throw error;
  }

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
    await unlink(reservationFile).catch(() => {});
  }
}

function duplicateNativeSessionId(sessionId: string): Error {
  return Object.assign(new Error(`native Pi session already exists: ${sessionId}`), {
    code: ErrorCode.enum.SESSION_LOCKED,
    statusCode: 409,
    [NATIVE_SESSION_PRE_PERSISTENCE_FAILURE]: true,
  });
}

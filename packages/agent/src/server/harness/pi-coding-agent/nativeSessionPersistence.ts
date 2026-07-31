import { mkdir, rename, unlink, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { SessionManager } from "@mariozechner/pi-coding-agent"
import { ErrorCode } from "../../../shared/error-codes.js"

export const NATIVE_SESSION_PRE_PERSISTENCE_FAILURE = Symbol("native-session-pre-persistence-failure")

/**
 * Pi chooses its session id and timestamped filename. Materialize and reopen
 * the transcript before exposing that id so an addressed create never returns
 * a session that cannot be loaded immediately.
 */
export async function createPersistedNativeSessionManager(
  runtimeCwd: string,
  nativeSessionDir: string,
): Promise<SessionManager> {
  await mkdir(nativeSessionDir, { recursive: true })
  let sessionManager = SessionManager.create(runtimeCwd, nativeSessionDir)
  const nativeFile = sessionManager.getSessionFile()
  const initialId = sessionManager.getSessionId()
  const header = sessionManager.getHeader()
  let nativeSessionId: string | undefined

  if (nativeFile && header) {
    let createdPlaceholder = false
    try {
      try {
        await writeFile(nativeFile, "", { flag: "wx" })
        createdPlaceholder = true
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error
      }
      sessionManager = SessionManager.open(nativeFile, nativeSessionDir, runtimeCwd)
      const openedId = sessionManager.getSessionId()
      nativeSessionId = openedId
      if (openedId !== initialId) {
        const reconciledFile = join(nativeSessionDir, basename(nativeFile).replace(initialId, openedId))
        let renamed = false
        try {
          await rename(nativeFile, reconciledFile)
          renamed = true
        } catch {
          try {
            await writeFile(nativeFile, `${JSON.stringify({ ...header, id: initialId })}\n`)
            nativeSessionId = initialId
            sessionManager = SessionManager.open(nativeFile, nativeSessionDir, runtimeCwd)
          } catch {
            const cleanupFailed = createdPlaceholder && await unlink(nativeFile).then(
              () => false,
              () => true,
            )
            nativeSessionId = undefined
            throw Object.assign(new Error(
              cleanupFailed
                ? "Native Pi session setup failed before persistence; cleanup of the unusable transcript also failed."
                : "Native Pi session setup failed before persistence.",
            ), {
              code: ErrorCode.enum.TOOL_EXECUTION_ERROR,
              statusCode: 500,
              ...(cleanupFailed ? { cleanupError: "Could not remove the unusable native session file." } : {}),
              [NATIVE_SESSION_PRE_PERSISTENCE_FAILURE]: true,
            })
          }
        }
        if (renamed) sessionManager = SessionManager.open(reconciledFile, nativeSessionDir, runtimeCwd)
      }
      nativeSessionId = sessionManager.getSessionId()
    } catch (error) {
      if (!nativeSessionId && createdPlaceholder) await unlink(nativeFile).catch(() => {})
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        ...(nativeSessionId ? { nativeSessionId } : {}),
      })
    }
  }

  nativeSessionId ??= sessionManager.getSessionId()
  const persistedFile = sessionManager.getSessionFile()
  const persistedHeader = sessionManager.getHeader()
  if (
    !nativeSessionId
    || !persistedFile
    || persistedHeader?.id !== nativeSessionId
    || !basename(persistedFile).endsWith(`_${nativeSessionId}.jsonl`)
  ) {
    throw Object.assign(new Error("Native Pi session setup did not produce a durable transcript."), {
      code: ErrorCode.enum.TOOL_EXECUTION_ERROR,
      statusCode: 500,
      [NATIVE_SESSION_PRE_PERSISTENCE_FAILURE]: true,
    })
  }
  return sessionManager
}

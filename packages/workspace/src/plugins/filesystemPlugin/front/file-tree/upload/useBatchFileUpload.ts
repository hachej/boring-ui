import { useCallback, useEffect, useRef, useState } from "react"
import type { ExactBinaryWritePolicy } from "@hachej/boring-bash/shared"
import { FetchError, type FetchClient } from "../../data/fetchClient"
import { joinPath } from "../treeModel"
import {
  MAX_CONCURRENT_FILE_UPLOADS,
  MAX_FILE_UPLOAD_BYTES,
  type ConflictDecision,
  type UploadConflictState,
  type UploadQueueRow,
} from "./uploadTypes"

interface UseBatchFileUploadOptions {
  client: FetchClient
  onWritten: (destinations: string[]) => Promise<void>
}

interface BatchFileUploadController {
  rows: UploadQueueRow[]
  conflict: UploadConflictState | null
  addFiles(files: File[], destination: string): void
  retry(row: UploadQueueRow): void
  decide(decision: ConflictDecision): void
  dismiss(): void
}

export function useBatchFileUpload({ client, onWritten }: UseBatchFileUploadOptions): BatchFileUploadController {
  const sequence = useRef(0)
  const intake = useRef<Promise<void>>(Promise.resolve())
  const lifecycle = useRef(new AbortController())
  const mounted = useRef(true)
  const conflictResolver = useRef<((decision: ConflictDecision) => void) | null>(null)
  const [rows, setRows] = useState<UploadQueueRow[]>([])
  const [conflict, setConflict] = useState<UploadConflictState | null>(null)

  useEffect(() => {
    mounted.current = true
    lifecycle.current = new AbortController()
    return () => {
      mounted.current = false
      lifecycle.current.abort()
      conflictResolver.current?.("cancel")
      conflictResolver.current = null
    }
  }, [])

  const update = useCallback((id: string, patch: Partial<UploadQueueRow>) => {
    if (!mounted.current) return
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
  }, [])

  const runPass = useCallback(async (
    passRows: UploadQueueRow[],
    ifExists: ExactBinaryWritePolicy,
    signal: AbortSignal,
  ): Promise<UploadQueueRow[]> => {
    const groups = new Map<string, UploadQueueRow[]>()
    for (const row of passRows) {
      const group = groups.get(row.path)
      if (group) group.push(row)
      else groups.set(row.path, [row])
    }
    const pendingGroups = [...groups.values()]
    const conflicts: UploadQueueRow[] = []
    const writtenDestinations = new Set<string>()
    let nextGroup = 0

    const worker = async () => {
      while (!signal.aborted) {
        const group = pendingGroups[nextGroup++]
        if (!group) return
        for (const row of group) {
          if (signal.aborted) return
          update(row.id, { status: "uploading", message: undefined, retryable: undefined })
          try {
            const outcome = await client.writeBinaryFile(row.path, row.file, { ifExists, signal })
            if (signal.aborted) return
            if (outcome.status === "written") {
              writtenDestinations.add(row.destination)
              update(row.id, { status: "done", message: undefined })
            } else {
              conflicts.push(row)
              update(row.id, { status: "queued", message: "Waiting for conflict decision." })
            }
          } catch (error) {
            if (signal.aborted) return
            const deterministic = error instanceof FetchError
              && ((error.status >= 400 && error.status < 500) || error.status === 501)
            update(row.id, {
              status: "failed",
              message: error instanceof Error ? error.message : "Upload failed.",
              retryable: !deterministic,
            })
          }
        }
      }
    }

    await Promise.all(Array.from(
      { length: Math.min(MAX_CONCURRENT_FILE_UPLOADS, pendingGroups.length) },
      worker,
    ))
    if (!signal.aborted && writtenDestinations.size > 0) {
      await onWritten([...writtenDestinations])
    }
    return conflicts
  }, [client, onWritten, update])

  const requestDecision = useCallback((conflicts: UploadQueueRow[], signal: AbortSignal) => new Promise<ConflictDecision>((resolve) => {
    if (signal.aborted || !mounted.current) return resolve("cancel")
    const finish = (decision: ConflictDecision) => {
      signal.removeEventListener("abort", abort)
      if (conflictResolver.current === finish) conflictResolver.current = null
      resolve(decision)
    }
    const abort = () => finish("cancel")
    conflictResolver.current = finish
    signal.addEventListener("abort", abort, { once: true })
    setConflict({ rows: conflicts })
  }), [])

  const process = useCallback(async (batch: UploadQueueRow[], signal: AbortSignal) => {
    const conflicts = await runPass(batch, "error", signal)
    if (signal.aborted || conflicts.length === 0) return
    const decision = await requestDecision(conflicts, signal)
    if (signal.aborted) return
    setConflict(null)
    if (decision === "replace") {
      await runPass(conflicts, "replace", signal)
      return
    }
    for (const row of conflicts) {
      update(row.id, decision === "skip"
        ? { status: "skipped", message: "A file with this name already exists." }
        : { status: "canceled", message: "Upload canceled after other files completed." })
    }
  }, [requestDecision, runPass, update])

  const enqueue = useCallback((batch: UploadQueueRow[]) => {
    const signal = lifecycle.current.signal
    const next = () => process(batch, signal)
    const queued = intake.current.then(next, next)
    intake.current = queued.then(() => undefined, () => undefined)
  }, [process])

  const addFiles = useCallback((files: File[], destination: string) => {
    const added = files.map<UploadQueueRow>((file) => {
      const oversized = file.size > MAX_FILE_UPLOAD_BYTES
      return {
        id: `upload:${++sequence.current}`,
        file,
        destination,
        path: joinPath(destination, file.name),
        status: oversized ? "failed" : "queued",
        ...(oversized ? { message: "File exceeds the 10 MiB limit.", retryable: false } : {}),
      }
    })
    setRows((current) => [...current, ...added])
    const uploadable = added.filter((row) => row.status === "queued")
    if (uploadable.length > 0) enqueue(uploadable)
  }, [enqueue])

  const retry = useCallback((row: UploadQueueRow) => {
    if (row.retryable === false) return
    update(row.id, { status: "queued", message: undefined })
    enqueue([row])
  }, [enqueue, update])

  const decide = useCallback((decision: ConflictDecision) => {
    const resolve = conflictResolver.current
    conflictResolver.current = null
    resolve?.(decision)
  }, [])

  const dismiss = useCallback(() => setRows([]), [])

  return { rows, conflict, addFiles, retry, decide, dismiss }
}

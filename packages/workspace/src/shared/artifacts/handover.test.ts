import { describe, expect, it } from "vitest"
import {
  applyHandoverOperations,
  currentHandoverArtifactsFromStructuredDetails,
  handoverOperationsFromDetails,
  projectHandovers,
  type HandoverOperation,
  type HandoverProjectionEvent,
} from "./handover"

const artifact = (id: string, title = id) => ({ id, surfaceKind: "workspace.open.path", target: `docs/${id}.md`, title })
const operation = (value: HandoverOperation) => ({ kind: "boring.handover.operation", wireVersion: 1, operation: value })

describe("handover registry reducer", () => {
  it("upserts in registration order, replaces in place, and removes explicitly", () => {
    const operations: HandoverOperation[] = [
      { action: "upsert", artifact: artifact("a", "A") },
      { action: "upsert", artifact: artifact("b", "B") },
      { action: "upsert", artifact: artifact("a", "A updated") },
      { action: "remove", artifactId: "b" },
    ]
    expect(applyHandoverOperations([], operations)).toEqual([artifact("a", "A updated")])
  })

  it("extracts direct manage_handover and nested ask_user operations only from structured details", () => {
    const upsert = { action: "upsert" as const, artifact: artifact("plan") }
    expect(handoverOperationsFromDetails(operation(upsert))).toEqual([upsert])
    expect(handoverOperationsFromDetails({ status: "answered", handover: { kind: "boring.handover.operations", wireVersion: 1, operations: [upsert] } })).toEqual([upsert])
    expect(handoverOperationsFromDetails({ text: "Registered plan in final prose" })).toEqual([])
  })

  it("projects one deterministic card only at a successful terminal stop", () => {
    const events: HandoverProjectionEvent[] = [
      { type: "run-start", runId: "user-1" },
      { type: "tool-result", entryId: "result-1", isError: false, details: operation({ action: "upsert", artifact: artifact("plan") }) },
      { type: "tool-result", entryId: "failed", isError: true, details: operation({ action: "upsert", artifact: artifact("ignored") }) },
      { type: "run-terminal", entryId: "terminal-1", state: "success", createdAt: "2026-01-01T00:00:09.000Z" },
    ]
    expect(projectHandovers(events)).toEqual([{
      id: "handover:terminal-1",
      runId: "user-1",
      terminalEntryId: "terminal-1",
      createdAt: "2026-01-01T00:00:09.000Z",
      artifacts: [artifact("plan")],
    }])
  })

  it("suppresses empty, failed, aborted, interrupted, and superseded runs without leaking state", () => {
    const events: HandoverProjectionEvent[] = [
      { type: "run-start", runId: "user-1" },
      { type: "tool-result", entryId: "one", isError: false, details: operation({ action: "upsert", artifact: artifact("old") }) },
      { type: "run-terminal", entryId: "failed", state: "error" },
      { type: "run-start", runId: "user-2" },
      { type: "tool-result", entryId: "two", isError: false, details: operation({ action: "upsert", artifact: artifact("aborted") }) },
      { type: "run-terminal", entryId: "aborted", state: "aborted" },
      { type: "run-start", runId: "user-3" },
      { type: "tool-result", entryId: "three", isError: false, details: operation({ action: "upsert", artifact: artifact("interrupted") }) },
      { type: "run-start", runId: "user-4" },
      { type: "run-terminal", entryId: "empty", state: "success" },
    ]
    expect(projectHandovers(events)).toEqual([])
  })

  it("folds only the already-authorized structured detail projection for current-run list", () => {
    expect(currentHandoverArtifactsFromStructuredDetails([
      { detail: operation({ action: "upsert", artifact: artifact("a") }) },
      { detail: operation({ action: "upsert", artifact: artifact("b") }) },
      { detail: operation({ action: "remove", artifactId: "a" }) },
    ])).toEqual([artifact("b")])
  })
})

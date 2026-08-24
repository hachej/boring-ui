import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

/**
 * HOST-WIRING CONFORMANCE for the #1355 console spike demo host.
 *
 * Three separate capabilities shipped "done" and were then found dead by a
 * human clicking them on the running page: Rename, Delete, and Pin. Every one
 * was the same failure — the pane and its row components were correct, and the
 * DEMO HOST simply never handed them what they needed. Component tests could
 * not see it, because component tests supply their own props; that is exactly
 * the seam they mock away.
 *
 * So the guard sits on the host's own source. It is a source-level assertion,
 * not a behavioural one — it proves the wire is present, not that the feature
 * works — and it exists to make the NEXT missing wire fail here instead of
 * under the owner's finger. Behavioural proof stays the live probe.
 *
 * Adding an interactive capability to the pane means adding it to this list.
 */
const SPIKE_HOST_REQUIRED_PROPS = [
  // Identity and content.
  "sessions",
  "activeSessionId",
  "activeSessionAgentTypeId",
  "appLeftProjects",
  // Every verb the row menu and the pane's controls offer.
  "onSwitchSession",
  "onCreateSession",
  "onDeleteSession",
  "onRenameSession",
  "appLeftConsoleSpike",
  "appLeftConsoleSpikeRenameProject",
  "chatPanel",
] as const

let spikeHostJsx = ""

beforeAll(async () => {
  const source = await readFile(resolve(__dirname, "App.tsx"), "utf8")
  const start = source.indexOf("if (consoleSpike) {")
  expect(start, "the spike host branch moved or was renamed").toBeGreaterThan(-1)
  const end = source.indexOf("\n  }", start)
  spikeHostJsx = source.slice(start, end)
})

describe("console spike demo host wiring", () => {
  it.each(SPIKE_HOST_REQUIRED_PROPS)("wires %s", (prop) => {
    // Matched as a JSX attribute at the start of a line — `prop={…}` or a bare
    // boolean `prop` — so a mention inside a comment or a longer prop name
    // (`appLeftConsoleSpikeRenameProject` satisfying `appLeftConsoleSpike`)
    // cannot pass for a wire.
    expect(spikeHostJsx).toMatch(new RegExp(`^\\s+${prop}(=|\\s*$)`, "m"))
  })

  it("leaves shell persistence on, so state the operator SET survives a reload", () => {
    // Pins, the chosen grouping and the pane layout all live behind
    // `persistenceEnabled` in WorkspaceAgentFront. With it off, pinning a chat
    // worked until you reloaded and then looked like it had never worked.
    expect(spikeHostJsx).toContain("persistenceEnabled")
    expect(spikeHostJsx).not.toContain("persistenceEnabled={false}")
  })

  /**
   * KNOWN GAP, recorded so it cannot be forgotten again.
   *
   * The top bar's "New quick chat" is the one create placement that never
   * reaches the host's `onCreateSession` prop: `createChatSessionInPopover`
   * calls `createAddressedSessionWithoutActivating` -> `coordinateRemoteCreate`,
   * which is the REMOTE create path, and swallows the failure
   * (`if (!result.success) return`). On the spike route that request 403s
   * against the unprovisioned demo workspace, so the control does nothing at
   * all — no chat, no overlay, no error. The row-level "Open as quick chat"
   * is unaffected; it opens an existing session and works.
   *
   * Fixing it means routing the popover create through `resolvedCreate` (which
   * honours `onCreateSession`) instead of the remote path — shared host logic
   * that production hosts depend on, so it wants its own change and its own
   * review rather than a drive-by.
   */
  it.todo("wires the top-bar New quick chat placement for prop-driven hosts")

  it("keeps the demo's chats renamable, which is what gates the Rename verb", () => {
    // The pane refuses Rename unless a chat is durable and has been replied to
    // (nativeSessionId === id && hasAssistantReply). A fixture set that misses
    // this makes Rename look unimplemented rather than correctly ineligible.
    return readFile(resolve(__dirname, "App.tsx"), "utf8").then((source) => {
      expect(source).toContain("nativeSessionId: session.id")
      expect(source).toContain("hasAssistantReply: true")
    })
  })
})

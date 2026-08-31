import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

// Matches playwright.config.ts's E2E_SESSION_ROOT default (this file's own
// env has no BORING_AGENT_SESSION_ROOT — that var is only set on the
// webServer child process's env via `env -i`).
const E2E_SESSION_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sessions")
const SHOWCASE_REGISTRY_PATH = join(E2E_SESSION_ROOT, ".playground-showcase-session-ids.json")

function decodeRegistryEntry(entry: string): { agentKey: string; workspaceId: string; sessionId: string } | undefined {
  const parts = entry.split(REGISTRY_KEY_SEPARATOR)
  if (parts.length !== 3) return undefined
  const [agentKey, workspaceId, sessionId] = parts
  return { agentKey, workspaceId, sessionId }
}
// Must match SHOWCASE_REGISTRY_KEY_SEPARATOR in scriptedPiHarness.ts (U+0001).
const REGISTRY_KEY_SEPARATOR = ""

/**
 * Regression for gh-1452: `?showcase=1` pre-seeded a client-side session id
 * (SHOWCASE_SESSION_ID) that never had a matching backend session, so the
 * chat pane's network hydrate always 404'd — a permanent "session was not
 * found" banner and a composer that never enabled. The fix boots a real
 * backend session before the chat panel renders, so the showcase route must
 * come up connected with a working composer.
 */

test.describe("workspace-playground showcase route", () => {
  test("boots a working session with no error banner and a live composer", async ({ page }) => {
    test.setTimeout(120_000)

    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))

    await page.goto("/?showcase=1")

    // Cold dev-server boot (first request ever, unbundled deps) can take a
    // while beyond the usual per-assertion timeout — give it real headroom
    // rather than flaking on a slow first compile.
    const chat = page.locator('[data-boring-agent-part="chat"]')
    await chat.waitFor({ state: "visible", timeout: 40_000 }).catch(() => {
      throw new Error(`showcase chat panel did not render; page errors: ${pageErrors.join(" | ") || "none"}`)
    })

    await expect(page.getByText("session was not found")).toHaveCount(0)
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })

    const composer = page.getByRole("textbox", { name: "Agent prompt" })
    await expect(composer).toBeVisible()
    await expect(composer).toBeEnabled()

    // The scripted harness marks its deterministic final reply with
    // `PI_NATIVE_ASSISTANT_DONE:<agentTypeId>` (apps/workspace-playground/
    // src/server/testing/scriptedPiHarness.ts). Waiting on that marker
    // (rather than "any assistant message container") proves the turn
    // actually completed streaming, not just that a message_start landed —
    // the container renders before the final text does.
    const meta = await (await page.request.get("/api/v1/workspace/meta")).json() as { defaultAgentTypeId: string }
    const doneMarker = `PI_NATIVE_ASSISTANT_DONE:${meta.defaultAgentTypeId}`
    const conversation = page.getByLabel("Agent conversation")

    const prompt = `showcase smoke ${Date.now()}`
    await composer.fill(prompt)
    await page.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(conversation.getByText(prompt)).toBeVisible()
    await expect(page.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText(doneMarker)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("chat-working")).toHaveCount(0, { timeout: 15_000 })
    await expect(composer).toBeEnabled()
  })

  test("reuses the same backend session across a reload in the same tab", async ({ page }) => {
    test.setTimeout(120_000)

    await page.goto("/?showcase=1")
    const chat = page.locator('[data-boring-agent-part="chat"]')
    await chat.waitFor({ state: "visible", timeout: 40_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    const firstSessionId = await chat.getAttribute("data-pi-chat-session-id")
    expect(firstSessionId).toBeTruthy()

    // Bounded-retention regression: a reload in the same tab must resume the
    // already-booted (still-empty) session rather than minting a new durable
    // one every time (gh-1458 review finding #3).
    await page.reload({ waitUntil: "domcontentloaded" })
    await chat.waitFor({ state: "visible", timeout: 40_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    const secondSessionId = await chat.getAttribute("data-pi-chat-session-id")
    expect(secondSessionId).toBe(firstSessionId)
  })

  test("switching to a decorative padding session materializes a real backend session", async ({ page }) => {
    test.setTimeout(120_000)

    // `sessions=3` pads the list with two client-only placeholder rows
    // (gh-1458 review finding #2) — selecting one must not hand the chat
    // pane an id that 404s the way the original SHOWCASE_SESSION_ID did.
    await page.goto("/?showcase=1&sessions=3")
    const chat = page.locator('[data-boring-agent-part="chat"]')
    await chat.waitFor({ state: "visible", timeout: 40_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    // Captured before the click: the pre-existing boot session is already
    // connected/enabled/error-free, so asserting only those properties after
    // the click can pass while the row's async materialization POST is still
    // in flight and the pane hasn't switched onto it at all. Waiting for the
    // session id to actually change (and the placeholder row to disappear)
    // proves the switch happened, not just that the old session was fine.
    const bootSessionId = await chat.getAttribute("data-pi-chat-session-id")
    expect(bootSessionId).toBeTruthy()

    const placeholderId = "__showcase__-2"
    const decorativeRow = page.locator(`[data-boring-workspace-part="app-session-row"][data-boring-session-id="${placeholderId}"]`)
    await decorativeRow.waitFor({ state: "visible", timeout: 10_000 })
    await decorativeRow.locator("button").first().click()

    await expect.poll(
      () => chat.getAttribute("data-pi-chat-session-id"),
      { timeout: 15_000 },
    ).not.toBe(bootSessionId)
    await expect(page.locator(`[data-boring-workspace-part="app-session-row"][data-boring-session-id="${placeholderId}"]`)).toHaveCount(0)

    await expect(page.getByText("session was not found")).toHaveCount(0)
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    await expect(page.getByRole("textbox", { name: "Agent prompt" })).toBeEnabled()

    const activeSessionId = await chat.getAttribute("data-pi-chat-session-id")
    expect(activeSessionId).not.toBe(placeholderId)
    expect(activeSessionId).not.toBe(bootSessionId)
  })

  // gh-1458 review round 6: createWorkspaceAgentServer accepts TWO different
  // values for `x-boring-workspace-id` — the canonical workspace scope id
  // and `basename(workspaceRoot)` — and always resolves either one to the
  // SAME canonical scope before a session record is ever created
  // (trustedWorkspaceScopeId in createWorkspaceAgentServer.ts). The wrapper
  // route used to key the showcase provenance registry by whichever raw
  // header the client presented, so an allowed basename-selector request
  // would create a session scoped to canonical while marking the registry
  // under the basename — a permanent mismatch the sweep's full-match rule
  // would never resolve (it deliberately never prunes an entry it can't
  // positively verify). This drives the wrapper route directly with the
  // basename selector and reads the on-disk registry to prove the entry is
  // keyed by the canonical id regardless.
  test("provenance registry keys by the canonical workspace scope, not whichever selector the client presented", async ({ page }) => {
    test.setTimeout(60_000)

    const meta = await (await page.request.get("/api/v1/workspace/meta")).json() as { workspaceId: string; defaultAgentTypeId: string }
    // In local (non-remote-worker) mode, meta.workspaceId reflects
    // basename(workspaceRoot) — the OTHER allowed selector, distinct from
    // the canonical "default" scope this server actually resolves to.
    const basenameSelector = meta.workspaceId
    expect(basenameSelector).toBeTruthy()
    expect(basenameSelector).not.toBe("default")

    const response = await page.request.post("/api/v1/playground/showcase-sessions", {
      headers: {
        "content-type": "application/json",
        "x-boring-workspace-id": basenameSelector,
      },
      data: {
        agentTypeId: meta.defaultAgentTypeId,
        title: "Basename selector parity check",
      },
    })
    expect(response.status(), await response.text()).toBe(201)
    const payload = await response.json() as { sessionId?: string }
    expect(payload.sessionId).toBeTruthy()

    const registryText = await readFile(SHOWCASE_REGISTRY_PATH, "utf8")
    const registry = JSON.parse(registryText) as string[]
    const decoded = registry.map(decodeRegistryEntry).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    const matching = decoded.find((entry) => entry.sessionId === payload.sessionId)
    expect(matching, `no registry entry found for session ${payload.sessionId}; decoded entries: ${JSON.stringify(decoded)}`).toBeTruthy()
    // The registry key must be the canonical scope ("default"), never the
    // basename selector the request presented — this is the belongsTo
    // parity the review required.
    expect(matching?.workspaceId).toBe("default")
    expect(matching?.workspaceId).not.toBe(basenameSelector)
  })
})

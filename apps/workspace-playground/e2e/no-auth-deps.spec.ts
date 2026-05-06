import { expect, test } from "@playwright/test"

/**
 * Regression: the workspace-playground deliberately runs WITHOUT
 * @hachej/boring-core. No auth provider, no config provider, no DB,
 * no /api/v1/me, /api/v1/config, /api/v1/workspaces, /auth/* calls.
 *
 * This test asserts the boot path doesn't accidentally fire any of
 * those — if a future change re-introduces a core dependency (e.g.
 * wraps the playground in <BoringApp> again), this catches it.
 */

const FORBIDDEN_PATHS = [
  "/api/v1/me",
  "/api/v1/config",
  "/api/v1/workspaces",
  "/api/v1/capabilities",
  "/auth/get-session",
  "/auth/sign-in/email",
  "/auth/sign-out",
]

test.describe("workspace-playground auth-free boot", () => {
  test("does not request any @hachej/boring-core endpoints on cold load", async ({ page }) => {
    const seen: string[] = []
    page.on("request", (req) => {
      const url = new URL(req.url())
      if (
        FORBIDDEN_PATHS.some(
          (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
        )
      ) {
        seen.push(url.pathname)
      }
    })

    await page.goto("/")
    await page.waitForLoadState("networkidle")
    // Idle long enough for any deferred AuthProvider / ConfigProvider
    // useEffects to fire.
    await page.waitForTimeout(1500)

    expect(
      seen,
      `playground hit core endpoints it should never reach: ${seen.join(", ")}`,
    ).toEqual([])
  })

  test("does not render any auth or config error UI on cold load", async ({
    page,
  }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1500)

    // The workspace shell should be visible without a core app wrapper.
    await expect(page.getByLabel("Chat stage")).toBeVisible()
    await expect(page.getByLabel("Session browser")).toBeVisible()

    // AppErrorBoundary surfaces "Something went wrong" — must NOT be
    // present. Was the visible failure mode when normalizeUser
    // crashed on the better-auth envelope shape (see
    // useSession.envelope.test.tsx).
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0)
  })
})

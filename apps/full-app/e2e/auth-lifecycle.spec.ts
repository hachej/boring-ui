import { expect, test } from '@playwright/test'
import postgres from 'postgres'

/**
 * End-to-end browser smoke for the full auth lifecycle against a live
 * deployed full-app. Targets `process.env.E2E_TARGET_URL` (defaults to the
 * Fly deploy). Disabled in CI / unit runs unless explicitly requested.
 *
 * What it covers — in one signed-in browser session:
 *   1. Cold visit to /                           (catches blank-screen bugs:
 *                                                 missing root route, JS
 *                                                 errors, broken bundle).
 *   2. AuthGate redirect → /auth/signin          (page renders, has a form).
 *   3. Sign-up via UI → "Check your email" gate  (signup cookie + DB user).
 *   4. DB-verify the new user                    (the deploy uses resend://
 *                                                 mail and there's no
 *                                                 mailbox to fetch the link
 *                                                 from — flip
 *                                                 users.email_verified
 *                                                 directly so signin works).
 *   5. Sign in via UI → land on workspace.
 *   6. Sign out via the user menu.
 *   7. Sign back in.
 *
 * Run locally:
 *   E2E_TARGET_URL=https://boring-full-app.fly.dev \
 *   E2E_DATABASE_URL=$(vault kv get -field=database_url secret/agent/app/boring-ui/prod) \
 *     pnpm --filter full-app exec playwright test e2e/auth-lifecycle.spec.ts \
 *     --reporter=list
 */

const TARGET = process.env.E2E_TARGET_URL ?? 'https://boring-full-app.fly.dev'
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? ''
const PASSWORD = 'AuthLifecycle123!aZ'

test.describe('full auth lifecycle (live deploy)', () => {
  test.setTimeout(120_000)

  test('signup → workspace → signout → signin → workspace', async ({ page }) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    // 1. Cold visit. Should NOT be a blank screen — either the auth gate
    //    redirect to /auth/signin, or the home redirect to a workspace.
    await test.step('cold visit to /', async () => {
      const resp = await page.goto(TARGET, { waitUntil: 'domcontentloaded' })
      expect(resp?.status(), `GET / responded ${resp?.status()}`).toBe(200)

      // Wait for the SPA to settle on its first route
      // (sign-in for unauth'd, workspace for auth'd).
      await page.waitForURL(/\/(auth\/signin|workspace\/)/, { timeout: 30_000 })

      const bodyText = await page.locator('body').innerText()
      expect(
        bodyText.length,
        `body should have rendered content; got ${bodyText.length} chars. ` +
          `pageerrors=${JSON.stringify(pageErrors)} consoleerrors=${JSON.stringify(consoleErrors)}`,
      ).toBeGreaterThan(0)
    })

    // 2. Sign-in page rendered.
    await test.step('signin page renders', async () => {
      if (!page.url().includes('/auth/signin')) {
        await page.goto(`${TARGET}/auth/signin`, { waitUntil: 'domcontentloaded' })
      }
      await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByLabel(/password/i).first()).toBeVisible()
    })

    // 3. Click "Create account" → fill signup form → submit → land on workspace.
    const email = `lifecycle-${Date.now()}@example.com`
    await test.step(`signup ${email}`, async () => {
      // Different deployments use different anchor text — try a few.
      const signupLink = page
        .getByRole('link', { name: /sign up|create.*account|register/i })
        .first()
      if (await signupLink.isVisible().catch(() => false)) {
        await signupLink.click()
      } else {
        await page.goto(`${TARGET}/auth/signup`, { waitUntil: 'domcontentloaded' })
      }

      await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 15_000 })
      await page.getByLabel(/email/i).fill(email)

      // The form may have one or two password fields (password + confirm).
      const passwordFields = page.getByLabel(/^password$|password$/i)
      const passwordCount = await passwordFields.count()
      for (let i = 0; i < passwordCount; i++) {
        await passwordFields.nth(i).fill(PASSWORD)
      }

      const nameField = page.getByLabel(/name|display name/i).first()
      if (await nameField.isVisible().catch(() => false)) {
        await nameField.fill('Lifecycle Smoke')
      }

      await page
        .getByRole('button', { name: /sign up|create.*account|register/i })
        .first()
        .click()

      // SignUpPage shows a terminal "Check your email" card on success.
      await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 30_000 })
    })

    // 4. DB-verify the user so the signin leg can proceed without a mailbox.
    await test.step(`db-verify user ${email}`, async () => {
      expect(
        DATABASE_URL,
        'set E2E_DATABASE_URL or DATABASE_URL to the deploy DB so the test can flip email_verified',
      ).toBeTruthy()

      const sql = postgres(DATABASE_URL, { max: 1, prepare: false })
      try {
        const rows = await sql`UPDATE users SET email_verified = true WHERE email = ${email} RETURNING id`
        expect(
          rows.length,
          `expected 1 user row for ${email} after signup`,
        ).toBe(1)
      } finally {
        await sql.end()
      }
    })

    // 5. Sign in via UI.
    await test.step(`first signin as ${email}`, async () => {
      await page.goto(`${TARGET}/auth/signin`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByLabel(/email/i)).toBeVisible()
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/^password$|password$/i).first().fill(PASSWORD)
      await page
        .getByRole('button', { name: /^sign in$|^log in$|^login$/i })
        .first()
        .click()
      await page.waitForURL(/\/workspace\//, { timeout: 30_000 })
      // Workspace shell mounts the user menu in the header — wait for it
      // so we know the React tree finished rendering, not just that the
      // URL changed.
      await expect(
        page.getByRole('button', { name: /user menu|account|profile/i }).first(),
      ).toBeVisible({ timeout: 15_000 })
    })

    // 6. Sign out via the user menu → back to sign-in or home redirect.
    await test.step('sign out', async () => {
      // Open the user menu (header avatar) and click sign-out.
      const userMenu = page
        .getByRole('button', { name: /account|user menu|profile|avatar/i })
        .first()
      if (await userMenu.isVisible().catch(() => false)) {
        await userMenu.click()
        const signOutItem = page.getByRole('menuitem', { name: /sign out|log out/i }).first()
        if (await signOutItem.isVisible().catch(() => false)) {
          await signOutItem.click()
        } else {
          await page.getByRole('button', { name: /sign out|log out/i }).first().click()
        }
      } else {
        // Fallback: hit the sign-out endpoint directly via fetch.
        await page.evaluate(async (origin) => {
          await fetch(`${origin}/auth/sign-out`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            credentials: 'include',
          })
        }, TARGET)
        await page.goto(TARGET, { waitUntil: 'domcontentloaded' })
      }

      await page.waitForURL(/\/auth\/signin/, { timeout: 30_000 })
    })

    // 7. Sign back in.
    await test.step(`second signin as ${email}`, async () => {
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/^password$|password$/i).first().fill(PASSWORD)
      await page
        .getByRole('button', { name: /^sign in$|^log in$|^login$/i })
        .first()
        .click()
      await page.waitForURL(/\/workspace\//, { timeout: 30_000 })
      await expect(
        page.getByRole('button', { name: /user menu|account|profile/i }).first(),
      ).toBeVisible({ timeout: 15_000 })
    })

    // No uncaught page errors at any point in the lifecycle.
    expect(
      pageErrors,
      `page raised uncaught errors: ${JSON.stringify(pageErrors)}`,
    ).toEqual([])
  })
})

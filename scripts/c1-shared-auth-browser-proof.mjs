import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import {
  createAuth,
  createDatabase,
  runMigrations,
} from '../packages/core/dist/server/index.js'

const databaseUrl = process.env.C1_PROOF_DATABASE_URL
if (!databaseUrl) {
  throw new Error('C1_PROOF_DATABASE_URL must identify an isolated Postgres proof database')
}

const PRODUCT_A = 'legal.products.example.com'
const PRODUCT_B = 'research.products.example.com'
const COOKIE_DOMAIN = 'products.example.com'
const OUTSIDE_SCOPE = 'other.example.com'
const email = `c1-browser-${Date.now()}@auth-test.dev`
const password = 'Zk8$mN!qR2xFgWpJ'

const config = {
  appId: 'test-app',
  appName: 'Test App',
  appLogo: null,
  port: 0,
  host: '127.0.0.1',
  staticDir: null,
  databaseUrl,
  stores: 'postgres',
  cors: {
    origins: [`https://${PRODUCT_A}`, `https://${PRODUCT_B}`],
    credentials: true,
  },
  bodyLimit: 16 * 1024 * 1024,
  logLevel: 'fatal',
  encryption: { workspaceSettingsKey: 'a'.repeat(64) },
  auth: {
    secret: 's'.repeat(64),
    url: `https://${PRODUCT_A}`,
    sessionTtlSeconds: 3600,
    sessionCookieSecure: true,
  },
  features: {
    githubOauth: false,
    googleOauth: false,
    invitesEnabled: true,
    sendWelcomeEmail: false,
    inviteTtlDays: 7,
  },
}

await runMigrations(config)
const { db, sql } = createDatabase(config)
const auth = createAuth(config, db, {
  disableDefaultWorkspaceCreation: true,
  disableInviteAcceptance: true,
  sharedAuthCookieDomain: COOKIE_DOMAIN,
  sharedAuthTrustedOrigins: config.cors.origins,
})

function getSetCookies(response) {
  const values = response.headers.getSetCookie?.()
  if (values?.length) return values
  const fallback = response.headers.get('set-cookie')
  return fallback ? [fallback] : []
}

function sessionSetCookie(response) {
  const value = getSetCookies(response).find((cookie) =>
    cookie.includes('__Secure-test-app.session_token='))
  assert.ok(value, 'Better Auth response must set the secure session cookie')
  return value
}

function sessionCookiePair(setCookie) {
  return setCookie.slice(0, setCookie.indexOf(';'))
}

let browser
try {
  const signup = await auth.handler(new Request(`https://${PRODUCT_A}/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: `https://${PRODUCT_A}`,
    },
    body: JSON.stringify({ name: 'C1 Browser Proof', email, password }),
  }))
  assert.equal(signup.status, 200)
  const signupSetCookie = sessionSetCookie(signup)
  assert.match(signupSetCookie, new RegExp(`Domain=${COOKIE_DOMAIN}`, 'i'))
  assert.match(signupSetCookie, /Secure/i)
  assert.match(signupSetCookie, /HttpOnly/i)
  assert.match(signupSetCookie, /SameSite=Lax/i)

  const logout = await auth.handler(new Request(`https://${PRODUCT_B}/auth/sign-out`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: sessionCookiePair(signupSetCookie),
      origin: `https://${PRODUCT_B}`,
    },
    body: '{}',
  }))
  assert.equal(logout.status, 200)
  const logoutSetCookie = sessionSetCookie(logout)

  browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const observedCookies = new Map()

    await page.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      observedCookies.set(`${url.hostname}${url.pathname}`, (await request.allHeaders()).cookie ?? '')

      const headers = { 'content-type': 'text/html' }
      if (url.hostname === PRODUCT_A && url.pathname === '/login') {
        headers['set-cookie'] = signupSetCookie
      }
      if (url.hostname === PRODUCT_B && url.pathname === '/logout') {
        headers['set-cookie'] = logoutSetCookie
      }
      await route.fulfill({ status: 200, headers, body: '<!doctype html><title>C1 auth proof</title>' })
    })

    await page.goto(`https://${PRODUCT_A}/login`)
    assert.equal(await page.evaluate(() => document.cookie), '', 'HttpOnly cookie must not be script-readable')

    await page.goto(`https://${PRODUCT_B}/session`)
    assert.match(observedCookies.get(`${PRODUCT_B}/session`) ?? '', /__Secure-test-app\.session_token=/)
    assert.equal((await context.cookies(`https://${PRODUCT_B}/`))[0]?.domain, `.${COOKIE_DOMAIN}`)

    await page.goto(`https://${OUTSIDE_SCOPE}/outside`)
    assert.equal(observedCookies.get(`${OUTSIDE_SCOPE}/outside`), '')

    await page.goto(`https://${PRODUCT_B}/logout`)
    await page.goto(`https://${PRODUCT_A}/after-logout`)
    assert.doesNotMatch(observedCookies.get(`${PRODUCT_A}/after-logout`) ?? '', /session_token=/)
    assert.equal((await context.cookies([`https://${PRODUCT_A}/`, `https://${PRODUCT_B}/`])).length, 0)

    console.log('c1-shared-auth-browser-proof: PASS (actual Better Auth set/clear cookie, automatic A/B sharing, outside-parent exclusion, HttpOnly)')
  } finally {
    await browser.close()
  }
} finally {
  try {
    await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ${email})`
    await sql`DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email = ${email})`
    await sql`DELETE FROM verification_tokens WHERE identifier = ${email}`
    await sql`DELETE FROM users WHERE email = ${email}`
  } finally {
    await sql.end()
  }
}

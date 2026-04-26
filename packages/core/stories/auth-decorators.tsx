import { createElement, useLayoutEffect, useState } from "react"
import type { Decorator } from "@storybook/react"
import { MemoryRouter } from "react-router-dom"

const MOCK_USER = {
  id: "user-1",
  email: "jane@example.com",
  name: "Jane Developer",
  emailVerified: true,
  image: null,
  createdAt: new Date("2024-11-01").toISOString(),
  updatedAt: new Date("2025-03-15").toISOString(),
}

const MOCK_SESSION = {
  data: {
    user: MOCK_USER,
    session: { expiresAt: new Date("2099-01-01").toISOString() },
  },
  isPending: false,
  error: null,
}

const MOCK_SESSION_LOADING = {
  data: null,
  isPending: true,
  error: null,
}

const MOCK_SESSION_NONE = {
  data: null,
  isPending: false,
  error: null,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function makeMockFetch(originalFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    if (url.endsWith("/api/v1/me")) {
      return jsonResponse({
        user: MOCK_USER,
        settings: { displayName: MOCK_USER.name, email: MOCK_USER.email, settings: {} },
      })
    }
    if (url.endsWith("/api/v1/config")) {
      return jsonResponse({
        appId: "storybook",
        appName: "Storybook App",
        appLogo: null,
        apiBase: "",
        features: { githubOauth: false, invitesEnabled: true, sendWelcomeEmail: false },
      })
    }
    if (url.endsWith("/api/v1/workspaces")) {
      return jsonResponse({ workspaces: [] })
    }
    if (originalFetch) return originalFetch(input, init)
    return jsonResponse({ error: "not mocked" }, 404)
  }
}

function MockFetchProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const original = globalThis.fetch
    globalThis.fetch = makeMockFetch(original)
    setReady(true)
    return () => {
      globalThis.fetch = original
    }
  }, [])
  if (!ready) return null
  return <>{children}</>
}

type SessionPreset = "authenticated" | "loading" | "unauthenticated"

function makeAuthClientMock(sessionPreset: SessionPreset) {
  const sessionData =
    sessionPreset === "authenticated"
      ? MOCK_SESSION
      : sessionPreset === "loading"
        ? MOCK_SESSION_LOADING
        : MOCK_SESSION_NONE

  return {
    useSession: () => sessionData,
    signOut: async () => {},
    signIn: {
      email: async () => ({ data: MOCK_SESSION.data, error: null }),
      social: async () => ({ data: null, error: null }),
    },
    signUp: {
      email: async () => ({ data: MOCK_SESSION.data, error: null }),
    },
    forgetPassword: async () => ({ data: { status: true }, error: null }),
    resetPassword: async () => ({ data: { status: true }, error: null }),
    verifyEmail: async () => ({ data: { status: true, user: MOCK_USER }, error: null }),
    sendVerificationEmail: async () => ({ data: { status: true }, error: null }),
    changePassword: async () => ({ data: { user: MOCK_USER }, error: null }),
  }
}

let currentMock = makeAuthClientMock("authenticated")

export function setSessionPreset(preset: SessionPreset) {
  currentMock = makeAuthClientMock(preset)
}

// Lazy-loaded to avoid module resolution issues with better-auth mocks.
// Instead of mocking better-auth's module system, we wrap the auth pages
// in the real AuthProvider which calls createAuthClient. We intercept at
// the fetch level so the pages behave naturally.
//
// For components that need useSession/useUser hooks we provide them via
// a thin wrapper that reads from our mock.
export function AuthContextWrapper({
  children,
  session,
}: {
  children: React.ReactNode
  session?: SessionPreset
}) {
  const preset = session ?? "authenticated"
  const mock = makeAuthClientMock(preset)

  // Provide the same context shape as AuthProvider + UserIdentityProvider
  // by directly rendering the providers with mocked fetch underneath.
  return <MockFetchProvider>{children}</MockFetchProvider>
}

export const withAuthDecorator: Decorator = (Story) =>
  createElement(
    MockFetchProvider,
    null,
    createElement(MemoryRouter, null, createElement(Story)),
  )

export const withAuthenticatedSession: Decorator = (Story) =>
  createElement(
    MockFetchProvider,
    null,
    createElement(MemoryRouter, null, createElement(Story)),
  )

export const withUnauthenticatedSession: Decorator = (Story) =>
  createElement(MemoryRouter, null, createElement(Story))

export { MOCK_USER, MOCK_SESSION }

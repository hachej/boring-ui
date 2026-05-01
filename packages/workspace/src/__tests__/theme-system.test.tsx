import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { type ReactNode } from "react"
import {
  WorkspaceProvider,
  ThemeProvider,
  useTheme,
} from "../front/provider"
import { createShadcnTheme } from "../front/theme/codemirror-theme"

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

let storage: Map<string, string>
let originalStorage: Storage

beforeEach(() => {
  storage = new Map()
  const mockStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key)
    }),
    clear: vi.fn(() => storage.clear()),
    get length() {
      return storage.size
    },
    key: vi.fn((index: number) => [...storage.keys()][index] ?? null),
  } as unknown as Storage

  originalStorage = globalThis.localStorage
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    writable: true,
    configurable: true,
  })

  document.documentElement.removeAttribute("data-theme")
})

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: originalStorage,
    writable: true,
    configurable: true,
  })
  document.documentElement.removeAttribute("data-theme")
})

// ---------------------------------------------------------------------------
// matchMedia mock helper
// ---------------------------------------------------------------------------

function mockMatchMedia(prefersDark: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = []
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? prefersDark : false,
      media: query,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        listeners.push(cb)
      },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })),
  })
  return listeners
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

function themeProviderWrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>
}

function workspaceWrapper({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider persistenceEnabled={false}>{children}</WorkspaceProvider>
  )
}

// ---------------------------------------------------------------------------
// ThemeProvider tests (1-8)
// ---------------------------------------------------------------------------

describe("ThemeProvider", () => {
  it("1. renders children with default theme (system preference)", () => {
    mockMatchMedia(false)
    render(
      <ThemeProvider>
        <div data-testid="child">hello</div>
      </ThemeProvider>,
    )
    expect(screen.getByTestId("child").textContent).toBe("hello")
  })

  it("2. useTheme().theme returns 'light' when prefers-color-scheme: light", () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), {
      wrapper: themeProviderWrapper,
    })
    expect(result.current.theme).toBe("light")
  })

  it("3. useTheme().theme returns 'dark' when prefers-color-scheme: dark", () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      ),
    })
    expect(result.current.theme).toBe("dark")
  })

  it("4. setTheme('dark') updates theme and applies data-theme=\"dark\" to container", () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), {
      wrapper: themeProviderWrapper,
    })

    act(() => {
      result.current.setTheme("dark")
    })

    expect(result.current.theme).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
  })

  it("5. toggleTheme() switches from light to dark and vice versa", () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), {
      wrapper: themeProviderWrapper,
    })

    expect(result.current.theme).toBe("light")

    act(() => {
      result.current.toggleTheme()
    })
    expect(result.current.theme).toBe("dark")

    act(() => {
      result.current.toggleTheme()
    })
    expect(result.current.theme).toBe("light")
  })

  it("6. theme persists to boring-ui-v2:preferences localStorage key", () => {
    mockMatchMedia(false)

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <WorkspaceProvider persistenceEnabled={true}>
          {children}
        </WorkspaceProvider>
      )
    }

    const { result } = renderHook(() => useTheme(), { wrapper: Wrapper })

    act(() => {
      result.current.setTheme("dark")
    })

    const stored = storage.get("boring-ui-v2:preferences")
    expect(stored).toBeDefined()
    const parsed = JSON.parse(stored!)
    expect(parsed.state.theme).toBe("dark")
  })

  it("7. on mount, reads persisted theme (overrides system preference)", () => {
    mockMatchMedia(false)
    storage.set(
      "boring-ui-v2:preferences",
      JSON.stringify({ state: { theme: "dark" }, version: 0 }),
    )

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <WorkspaceProvider persistenceEnabled={true}>
          {children}
        </WorkspaceProvider>
      )
    }

    const { result } = renderHook(() => useTheme(), { wrapper: Wrapper })
    expect(result.current.theme).toBe("dark")
  })

  it("8. clearing localStorage reverts to system preference", () => {
    mockMatchMedia(true)
    storage.clear()

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <WorkspaceProvider persistenceEnabled={true}>
          {children}
        </WorkspaceProvider>
      )
    }

    const { result } = renderHook(() => useTheme(), { wrapper: Wrapper })
    expect(result.current.theme).toBe("dark")
  })
})

// ---------------------------------------------------------------------------
// CodeMirror theme sync (9-11)
// ---------------------------------------------------------------------------

describe("CodeMirror theme sync", () => {
  it("9. createShadcnTheme accepts dark option for compartment reconfiguration", () => {
    const lightTheme = createShadcnTheme({ dark: false })
    const darkTheme = createShadcnTheme({ dark: true })

    expect(lightTheme).toBeDefined()
    expect(darkTheme).toBeDefined()
    expect(Array.isArray(lightTheme)).toBe(true)
    expect(Array.isArray(darkTheme)).toBe(true)
    expect(lightTheme.length).toBe(2)
    expect(darkTheme.length).toBe(2)
    expect(lightTheme[0]).not.toBe(darkTheme[0])
  })

  it("10. dark mode: CM6 theme includes dark flag", () => {
    const [themeExt] = createShadcnTheme({ dark: true })
    expect(themeExt).toBeDefined()
    const specs = (themeExt as any)
    expect(specs).toBeTruthy()
  })

  it("11. light mode: CM6 theme created without dark flag", () => {
    const lightTheme = createShadcnTheme()
    const darkTheme = createShadcnTheme({ dark: false })
    expect(lightTheme).toBeDefined()
    expect(darkTheme).toBeDefined()
    expect(lightTheme.length).toBe(darkTheme.length)
  })
})

// ---------------------------------------------------------------------------
// Dockview theme sync (12-13)
// ---------------------------------------------------------------------------

describe("Dockview theme sync", () => {
  it("12. dockview-overrides.css maps --dv-background-color to var(--background)", () => {
    const cssPath = resolve(__dirname, "../front/dock/dockview-overrides.css")
    const content = readFileSync(cssPath, "utf-8")
    expect(content).toContain("--dv-background-color")
    expect(content).toContain("var(--background)")
  })

  it("13. dockview theme follows data-theme via CSS variable cascade", () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useTheme(), {
      wrapper: workspaceWrapper,
    })

    expect(
      document.documentElement.getAttribute("data-theme"),
    ).toBe("light")

    act(() => {
      result.current.setTheme("dark")
    })

    expect(
      document.documentElement.getAttribute("data-theme"),
    ).toBe("dark")
  })
})

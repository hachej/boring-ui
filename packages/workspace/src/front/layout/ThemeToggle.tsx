"use client"

import { useEffect } from "react"
import { Moon, Sun } from "lucide-react"
import { IconButton } from "@hachej/boring-ui-kit"
import { useTheme } from "../provider/WorkspaceProvider"

/**
 * Light/dark theme toggle for the workspace top bar.
 *
 * Reads/writes theme through the WorkspaceProvider store (persisted under the
 * workspace preferences key). Tailwind's dark variant in the workspace
 * `globals.css` keys off the `.dark` class on the document root, so we keep
 * that class in sync with the active theme here. SSR-safe: the class sync runs
 * inside an effect guarded by a `document` check.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === "dark"

  useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.classList.toggle("dark", isDark)
  }, [isDark])

  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </IconButton>
  )
}

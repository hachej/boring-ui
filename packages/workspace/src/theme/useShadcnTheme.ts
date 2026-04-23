"use client"

import { useEffect, useRef } from "react"
import { Compartment, type Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { createShadcnTheme } from "./codemirror-theme"
import { useThemePreference } from "../store/selectors"

export function useShadcnTheme(
  viewRef: React.RefObject<EditorView | null>,
): Extension {
  const compartment = useRef(new Compartment())
  const theme = useThemePreference()
  const dark = theme === "dark"

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: compartment.current.reconfigure(
        createShadcnTheme({ dark }),
      ),
    })
  }, [dark, viewRef])

  return compartment.current.of(createShadcnTheme({ dark }))
}

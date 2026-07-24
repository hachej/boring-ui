import { useEffect, useSyncExternalStore, type ComponentType } from "react"
import { MarkdownEditorPane, type MarkdownEditorPaneProps } from "@hachej/boring-workspace"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { liveTranscriptCommands, liveTranscriptController, LiveTranscriptBrowserController } from "./controller"
import { downmixAndResample } from "./pcm"
import { liveTranscriptBrowserState } from "./state"

const LIVE_MARKDOWN_PANEL_ID = "live-transcription.markdown"

function LiveTranscriptLifecycleBinding() {
  useEffect(() => liveTranscriptController.mount(), [])
  return null
}

export function LiveTranscriptMarkdownPane(props: MarkdownEditorPaneProps) {
  const active = useSyncExternalStore(
    liveTranscriptBrowserState.subscribe,
    liveTranscriptBrowserState.getSnapshot,
    liveTranscriptBrowserState.getSnapshot,
  )
  const path = typeof props.params?.path === "string" ? props.params.path : ""
  const locked = Boolean(path && active.transcriptPath === path && active.state !== "complete" && active.state !== "interrupted")
  return (
    <MarkdownEditorPane
      {...props}
      params={{ ...props.params, mode: locked ? "view" : "edit" }}
    />
  )
}

export const liveTranscriptPlugin = definePlugin({
  id: "live-transcription",
  label: "Live transcription",
  panels: [{
    id: LIVE_MARKDOWN_PANEL_ID,
    label: "Live transcript",
    component: LiveTranscriptMarkdownPane as ComponentType<any>,
    placement: "center",
    source: "app",
  }],
  surfaceResolvers: [{
    id: "live-transcription.active-markdown",
    kind: "workspace.open.path",
    source: "app",
    resolve(request) {
      const active = liveTranscriptBrowserState.getSnapshot()
      if (!active.transcriptPath || request.target !== active.transcriptPath) return undefined
      return {
        id: `file:${request.target}`,
        component: LIVE_MARKDOWN_PANEL_ID,
        title: request.target.split("/").pop() ?? request.target,
        params: { path: request.target },
        score: 10_000,
      }
    },
  }],
  bindings: [{ id: "live-transcription.lifecycle", component: LiveTranscriptLifecycleBinding }],
})

export {
  downmixAndResample,
  liveTranscriptBrowserState,
  liveTranscriptCommands,
  liveTranscriptController,
  LiveTranscriptBrowserController,
}

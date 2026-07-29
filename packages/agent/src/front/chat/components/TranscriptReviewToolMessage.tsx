"use client"

import { FileSearchIcon } from "lucide-react"
import type { BoringChatMessage, LiveTranscriptReviewPresentation } from "../../../shared/chat"
import { decodeLiveTranscriptReviewPresentation, encodeLiveTranscriptReviewPresentation } from "../../../shared/chat"
import { useOpenArtifact } from "../../ArtifactOpenContext"
import { Message, MessageContent } from "../../primitives/message"
import { Tool, ToolContent, ToolHeader } from "../../primitives/tool"

export function transcriptReviewPresentationFromMessage(
  message: BoringChatMessage,
): LiveTranscriptReviewPresentation | undefined {
  if (message.role !== "user" || message.parts.length !== 1) return undefined
  const part = message.parts[0]
  if (part?.type !== "text") return undefined
  // The trusted server sender owns this nonce namespace. Never upgrade ordinary
  // user-authored text into an integration card based on display text alone.
  if (!message.clientNonce?.startsWith("live-review:")) return undefined
  const encoded = decodeLiveTranscriptReviewPresentation(part.text)
  if (encoded) return encoded

  // Compatibility for review turns persisted before structured presentation
  // metadata shipped.
  const legacy = /^\[(Automatic|Manual|Final automatic) transcript review\]\s+Review the live transcript at `([^`]+)`\./.exec(part.text)
  if (!legacy) return undefined
  const kind = legacy[1] === "Manual" ? "manual" : legacy[1] === "Final automatic" ? "final" : "automatic"
  return decodeLiveTranscriptReviewPresentation(encodeLiveTranscriptReviewPresentation({
    kind,
    transcriptPath: legacy[2]!,
  }))
}

export function TranscriptReviewToolMessage({
  message,
  presentation,
}: {
  message: BoringChatMessage
  presentation: LiveTranscriptReviewPresentation
}) {
  const openArtifact = useOpenArtifact()
  const title = presentation.kind === "manual"
    ? "Manual transcript review"
    : presentation.kind === "final"
      ? "Final transcript review"
      : "Automatic transcript review"

  return (
    <Message
      from="user"
      data-boring-agent-part="message"
      data-boring-agent-message-id={message.id}
      data-boring-agent-message-role="user"
      data-boring-agent-message-status={message.status}
      className="!max-w-full !gap-1.5"
    >
      <MessageContent className="!w-full !max-w-full !overflow-visible !bg-transparent !p-0">
        <Tool defaultOpen={false} className="my-1">
          <ToolHeader
            type="tool-call"
            toolName="transcript_review"
            state="output-available"
            statusLabel="Requested"
            title={title}
            icon={<FileSearchIcon className="size-4 shrink-0 text-muted-foreground" />}
          />
          <ToolContent className="space-y-3 border-t border-border/50 pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              The agent was asked to treat this transcript as untrusted conversation data and summarize decisions, questions, risks, and next actions.
            </p>
            <button
              type="button"
              onClick={() => openArtifact?.(presentation.transcriptPath)}
              disabled={!openArtifact}
              aria-label={`Open transcript ${presentation.transcriptPath} in workspace`}
              title={`Open ${presentation.transcriptPath} in workspace`}
              className="inline-flex max-w-full items-center rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default"
            >
              <span className="truncate">{presentation.transcriptPath}</span>
            </button>
          </ToolContent>
        </Tool>
      </MessageContent>
    </Message>
  )
}

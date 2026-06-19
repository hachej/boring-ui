import React from "react"
import { useWorkspacePluginClient } from "@hachej/boring-workspace"
import { buildPortUrl, fetchPrData, relativeTime, requestAgentLabel } from "./data"
import { DiffExplorer } from "./diffExplorer"
import { statusLabel, toneSoftBadge, toneText } from "./status"
import type { PullRequest, VisualProof } from "./types"
import { Badge, Button, classes, Input, LinkButton, Separator, TextArea } from "./ui"

function TagEditor({ pr, allLabels, onChanged }: { pr: PullRequest; allLabels?: string[]; onChanged?: () => void }) {
  const pluginClient = useWorkspacePluginClient()
  const [draft, setDraft] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<string | null>(null)

  const apply = async (add: string[], remove: string[]) => {
    setBusy(true)
    setStatus("Asking the agent…")
    try {
      await requestAgentLabel(pluginClient, pr.number, add, remove)
      // The agent applies labels on its own schedule — poll the data file
      // until this PR reflects the change.
      for (let waited = 0; waited <= 90_000; waited += 4_000) {
        const next = await fetchPrData(pluginClient).catch(() => null)
        const updated = next?.prs.find((candidate) => candidate.number === pr.number)
        if (
          updated &&
          add.every((label) => updated.labels.includes(label)) &&
          remove.every((label) => !updated.labels.includes(label))
        ) {
          setStatus("Updated")
          window.setTimeout(() => setStatus(null), 1500)
          onChanged?.()
          return
        }
        setStatus(`Waiting for the agent… ${Math.round(waited / 1000)}s`)
        await new Promise((resolve) => window.setTimeout(resolve, 4_000))
      }
      setStatus("Agent didn't confirm the change — check the chat for errors.")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setStatus(`Failed: ${message.slice(0, 100)}`)
    } finally {
      setBusy(false)
    }
  }

  const suggestions = (allLabels ?? []).filter((label) => !pr.labels.includes(label))
  const datalistId = `pr-tracker-labels-${pr.number}`

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Tags</span>
      {pr.labels.length === 0 && <span className="text-xs text-muted-foreground">none</span>}
      {pr.labels.map((label) => (
        <span key={label} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs">
          {label}
          <button
            type="button"
            aria-label={`Remove tag ${label}`}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            disabled={busy}
            onClick={() => void apply([], [label])}
          >
            ×
          </button>
        </span>
      ))}
      <form
        className="inline-flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault()
          const value = draft.trim()
          if (!value || busy) return
          setDraft("")
          void apply([value], [])
        }}
      >
        <Input
          list={datalistId}
          className="h-6 w-36"
          placeholder="Add tag…"
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <datalist id={datalistId}>
          {suggestions.map((label) => <option key={label} value={label} />)}
        </datalist>
        <Button type="submit" variant="ghost" disabled={busy || !draft.trim()}>Add</Button>
      </form>
      {status && <span className="text-[11px] text-muted-foreground">{status}</span>}
    </div>
  )
}

function CommentBox({ pr }: { pr: PullRequest }) {
  const [body, setBody] = React.useState("")
  const [copied, setCopied] = React.useState<string | null>(null)
  const trimmed = body.trim()

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard?.writeText(text)
      setCopied(label)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      setCopied(null)
    }
  }

  const ghCommand = `gh pr comment ${pr.number} --body ${JSON.stringify(trimmed || "<your comment>")}`
  const agentPrompt = trimmed ? `Comment on PR #${pr.number}:\n\n${trimmed}` : `Comment on PR #${pr.number}: `

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Comment</h3>
      <TextArea
        className="min-h-20 text-sm"
        placeholder={`Draft a comment for PR #${pr.number}…`}
        value={body}
        onChange={(event) => setBody(event.currentTarget.value)}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button disabled={!trimmed} onClick={() => void copy("gh", ghCommand)}>
          {copied === "gh" ? "Copied" : "Copy gh command"}
        </Button>
        <Button disabled={!trimmed} onClick={() => void copy("agent", agentPrompt)}>
          {copied === "agent" ? "Copied" : "Copy agent prompt"}
        </Button>
        <LinkButton variant="ghost" href={`${pr.url}#issuecomment-new`} target="_blank" rel="noreferrer">
          Open on GitHub ↗
        </LinkButton>
      </div>
    </section>
  )
}

function VisualProofItem({ proof }: { proof: VisualProof }) {
  return (
    <a
      href={proof.url}
      target="_blank"
      rel="noreferrer"
      title={proof.context ?? proof.title}
      className="group block min-w-0 overflow-hidden rounded-lg border border-border transition-colors hover:border-ring/60"
    >
      <div className="aspect-video w-full overflow-hidden bg-muted">
        {proof.kind === "image" ? (
          <img src={proof.url} alt={proof.title} loading="lazy" className="h-full w-full object-contain" />
        ) : proof.kind === "video" ? (
          <video src={proof.url} muted controls className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">Open visual proof link</div>
        )}
      </div>
      <div className="space-y-0.5 p-2">
        <div className="flex items-center gap-1.5">
          {proof.isAgentGenerated && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">agent</Badge>}
          <span className="truncate text-xs font-medium group-hover:underline">{proof.title}</span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {[proof.author ? `by ${proof.author}` : null, proof.postedAt ? relativeTime(proof.postedAt) : null].filter(Boolean).join(" · ")}
        </div>
      </div>
    </a>
  )
}

function VisualProofGallery({ pr }: { pr: PullRequest }) {
  if (pr.visualProofs.length === 0) return null
  const agentProofs = pr.visualProofs.filter((proof) => proof.isAgentGenerated)
  const proofs = (agentProofs.length > 0 ? agentProofs : pr.visualProofs).slice(0, 4)
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">
        Visual proof
        <span className="ml-2 font-normal tabular-nums text-muted-foreground">{pr.visualProofs.length}</span>
      </h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {proofs.map((proof) => <VisualProofItem key={proof.url} proof={proof} />)}
      </div>
    </section>
  )
}

function reviewSummary(pr: PullRequest): { text: string; tone: "success" | "warning" | "neutral" } | null {
  if (!pr.reviewDecision) return null
  if (pr.reviewDecision === "APPROVED") return { text: "approved", tone: "success" }
  if (pr.reviewDecision === "CHANGES_REQUESTED") return { text: "changes requested", tone: "warning" }
  return { text: pr.reviewDecision.toLowerCase().replace(/_/g, " "), tone: "neutral" }
}

export interface PrDetailProps {
  pr: PullRequest
  /** Labels across all PRs, used as add-tag suggestions. */
  allLabels?: string[]
  /** Called after the agent confirms a data change (e.g. labels updated). */
  onDataChanged?: () => void
}

export function PrDetail({ pr, allLabels, onDataChanged }: PrDetailProps) {
  const { total, passed, pending, failed } = pr.checkSummary
  const review = reviewSummary(pr)
  const checksTone = failed > 0 ? "danger" : pending > 0 ? "warning" : total > 0 ? "success" : "neutral"

  return (
    <article className="min-w-0 space-y-5">
      <header className="space-y-2">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-base font-semibold leading-snug">
              <a href={pr.url} target="_blank" rel="noreferrer" className="hover:underline">
                <span className="mr-2 font-normal tabular-nums text-muted-foreground">#{pr.number}</span>
                {pr.title}
              </a>
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className={classes("rounded-full px-2 py-0.5 font-medium", toneSoftBadge[pr.statusTone])}>{statusLabel(pr.statusTag)}</span>
              {pr.isDraft && <Badge variant="outline">draft</Badge>}
              <span className="font-mono text-[11px]">{pr.headRefName} → {pr.baseRefName}</span>
              <span>by {pr.author}</span>
              <span>updated {relativeTime(pr.updatedAt)}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {pr.ports.map((port) => (
              <LinkButton key={port.port} href={buildPortUrl(port.port)} target="_blank" rel="noreferrer" title={port.text ?? `Open port ${port.port}`}>
                demo :{port.port}
              </LinkButton>
            ))}
            <LinkButton variant="ghost" href={pr.url} target="_blank" rel="noreferrer">GitHub ↗</LinkButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={classes("font-medium", toneText[checksTone])}>
            {total === 0 ? "no checks" : `checks ${passed}/${total}${failed > 0 ? ` · ${failed} failing` : pending > 0 ? ` · ${pending} pending` : ""}`}
          </span>
          {review && <span className={classes("font-medium", toneText[review.tone])}>review {review.text}</span>}
          {pr.mergeStateStatus && pr.mergeStateStatus !== "CLEAN" && (
            <span className="text-muted-foreground">merge {pr.mergeStateStatus.toLowerCase()}</span>
          )}
          {pr.labels.slice(0, 6).map((label) => (
            <Badge key={label} variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">{label}</Badge>
          ))}
        </div>

        {pr.topic && <p className="max-w-[70ch] text-sm leading-6 text-foreground/90">{pr.topic}</p>}
      </header>

      <Separator />
      <DiffExplorer pr={pr} />
      <Separator />
      <TagEditor pr={pr} allLabels={allLabels} onChanged={onDataChanged} />
      <CommentBox pr={pr} />
      <VisualProofGallery pr={pr} />
    </article>
  )
}

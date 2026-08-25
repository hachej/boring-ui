/**
 * JOB THREAD v0 — FIXTURE-DRIVEN MOCK. No relay, no gateway, no store.
 *
 * This is a communication artifact for the owner: it shows what the merged
 * multi-seat timeline from `docs/plans/job-thread-v0-plan.md` LOOKS like, so
 * the shape can be argued about before any of it is built. Everything on this
 * screen comes from `JOB_THREAD_FIXTURE` below and nothing on it is wired:
 * the approve/reject buttons, the "view session" links and the status pill are
 * all inert.
 *
 * SHAPE (owner ruling): this must read as TODAY'S CHAT with several agents in
 * it — not a bespoke timeline. So the classes below are lifted from the live Pi
 * chat rather than invented. Sources, all verbatim:
 *   - transcript list, user bubble, assistant block:
 *     `packages/agent/src/front/primitives/{conversation,message}.tsx` and
 *     `chat/components/PiConversationSurface.tsx` (`max-w-[680px] px-4 py-4`,
 *     `gap-6`; user = `ml-auto max-w-[80%] rounded-[var(--radius-lg)]
 *     bg-secondary px-4 py-2.5`; assistant = full width, no bubble,
 *     `max-w-[40.5rem]`, `text-[13px] leading-5`). The role split there is done
 *     with `group-[.is-user]:` variants; the mock knows the role at render time
 *     so it applies the RESOLVED classes directly — same pixels, no variant.
 *   - quiet system register: `chat/components/noticeStyles.ts`, and the
 *     collapsed tool line in `primitives/tool-call-group.tsx`.
 *   - the gate: the ask-user inline block's own structure from
 *     `plugins/ask-user/src/front/index.tsx` (`InlineQuestion` /
 *     `PendingQuestionBody`: "Waiting for answer" eyebrow, question, context,
 *     a bordered footer with cancel + submit).
 *   - composer: `chat/components/PiChatComposerSurface.tsx` rail + textarea.
 *
 * CONTINUITY, the property to check: seat attribution is the ONLY multi-agent
 * tell, and `jobThreadShowsSeatAttribution` switches it off when a job has one
 * seat — so a one-seat job renders as plain chat. User messages carry no chip,
 * no name and no time in either case, exactly as today.
 *
 * What it also takes seriously is the plan's projection contract, because that
 * is the part worth reviewing:
 *   - §3 Ordering: merged rendering sorts `(turnOrdinal, seq, markerOrdinal)`;
 *     `turnOrdinal` is relay-owned, `seq` is per-destination, `markerOrdinal`
 *     is the durable tie-breaker so system markers never float. No wallclock —
 *     the relative times shown are display sugar carried on the fixture, not a
 *     sort key.
 *   - §3 Snapshot fallback: a block rebuilt from a `PiChatSnapshot` has no
 *     per-message `seq`, so it is labelled snapshot-derived.
 *   - §4 Only SETTLED posts appear. Pending/failed edges are relay state, not
 *     timeline content.
 *   - §4 Seat chips are display-grade participants; the private session lives
 *     behind a drill-down, never inline.
 */
import type { ReactNode } from "react"

/* ------------------------------------------------------------------ *
 * Fixture types — a deliberately thin mirror of the plan's contract.
 * ------------------------------------------------------------------ */

export interface JobThreadParticipant {
  /** Gateway identity for the seat. Also the chip's colour key. */
  agentTypeId: string
  /** Display-grade name. The private session id is NOT display-grade. */
  name: string
  role: "owner" | "worker" | "reviewer"
  /** Where drill-down would go. Shown only as an inert affordance. */
  sessionId?: string
}

interface JobThreadEntryBase {
  id: string
  /** Store-owned monotonic integer, allocated under the CAS lock (§3). */
  turnOrdinal: number
  /** Per-destination event cursor. Absent for snapshot-derived blocks. */
  seq?: number
  /** Durable tie-breaker minted alongside the edge, for relay-authored rows. */
  markerOrdinal?: number
}

export interface JobThreadPost extends JobThreadEntryBase {
  kind: "post"
  agentTypeId: string
  /** Only `settled` is renderable; the union documents what is filtered out. */
  phase: "settled"
  body: string
  relativeTime: string
  /** Rebuilt from a snapshot: ordered by array position, marked as such (§3). */
  snapshotDerived?: boolean
  /** The tool call this post settled, when it was one. */
  toolCall?: string
}

export interface JobThreadMarker extends JobThreadEntryBase {
  kind: "marker"
  markerOrdinal: number
  variant: "handoff" | "truncation" | "suspend"
  text: string
}

export interface JobThreadGate extends JobThreadEntryBase {
  kind: "gate"
  agentTypeId: string
  title: string
  detail: string
  relativeTime: string
}

export type JobThreadEntry = JobThreadPost | JobThreadMarker | JobThreadGate

export interface JobThreadFixture {
  title: string
  status: string
  objective: {
    metric: string
    baseline: number
    current: number
    target: number
  }
  participants: readonly JobThreadParticipant[]
  entries: readonly JobThreadEntry[]
}

/* ------------------------------------------------------------------ *
 * Ordering — the one behaviour worth asserting in a mock.
 * ------------------------------------------------------------------ */

/** §3: `(turnOrdinal, seq, markerOrdinal)`, integers, no wallclock. */
export function jobThreadTimelineOrder(entries: readonly JobThreadEntry[]): readonly JobThreadEntry[] {
  return [...entries].sort((left, right) => (
    left.turnOrdinal - right.turnOrdinal
    || (left.seq ?? 0) - (right.seq ?? 0)
    || (left.markerOrdinal ?? 0) - (right.markerOrdinal ?? 0)
  ))
}

/* ------------------------------------------------------------------ *
 * THE FIXTURE. Invented data. Nothing here comes from a running system.
 * ------------------------------------------------------------------ */

const OWNER = "owner"
const WORKER = "creator-growth-worker"
const REVIEWER = "creator-growth-reviewer"

export const JOB_THREAD_FIXTURE: JobThreadFixture = {
  title: "Grow my audience",
  status: "Waiting on you",
  objective: { metric: "followers", baseline: 3100, current: 3400, target: 10000 },
  participants: [
    { agentTypeId: OWNER, name: "You", role: "owner" },
    { agentTypeId: WORKER, name: "Growth Worker", role: "worker", sessionId: "sess_9f21…" },
    { agentTypeId: REVIEWER, name: "Growth Reviewer", role: "reviewer", sessionId: "sess_4ac0…" },
  ],
  entries: [
    {
      kind: "marker",
      id: "m-trunc",
      turnOrdinal: 0,
      markerOrdinal: 1,
      variant: "truncation",
      text: "earlier context truncated — 9 older posts dropped oldest-first to fit the context bound",
    },
    {
      kind: "post",
      id: "p-1",
      turnOrdinal: 1,
      seq: 12,
      agentTypeId: OWNER,
      phase: "settled",
      relativeTime: "2h ago",
      body: "I want to get from ~3k to 10k followers this quarter. Draft a plan I can actually run alongside my day job.",
    },
    {
      kind: "post",
      id: "p-2",
      turnOrdinal: 2,
      seq: 31,
      agentTypeId: WORKER,
      phase: "settled",
      relativeTime: "2h ago",
      snapshotDerived: true,
      body: "Draft plan: three posts a week on one narrow topic, one long-form piece a month, and a 20-person outreach experiment to test whether replies convert better than posts. Baseline is 3,100 followers; the outreach arm is the only part with real downside risk.",
    },
    {
      kind: "marker",
      id: "m-h1",
      turnOrdinal: 2,
      seq: 31,
      markerOrdinal: 2,
      variant: "handoff",
      text: "worker → reviewer: review the draft plan",
    },
    {
      kind: "post",
      id: "p-3",
      turnOrdinal: 3,
      seq: 8,
      agentTypeId: REVIEWER,
      phase: "settled",
      relativeTime: "2h ago",
      body: "The cadence is sound. The outreach arm is not scoped: 20 people over what window, and what counts as a conversion? Without that it cannot be evaluated, only felt.",
    },
    {
      kind: "marker",
      id: "m-h2",
      turnOrdinal: 3,
      seq: 8,
      markerOrdinal: 3,
      variant: "handoff",
      text: "reviewer → worker: tighten the experiment scope",
    },
    {
      kind: "post",
      id: "p-4",
      turnOrdinal: 4,
      seq: 44,
      agentTypeId: WORKER,
      phase: "settled",
      relativeTime: "1h ago",
      body: "Scoped: 20 replies over 10 days, to people who already engaged twice. Conversion = a follow within 72h. If fewer than 4 convert, the arm is dropped and we keep posting only.",
    },
    {
      kind: "gate",
      id: "g-1",
      turnOrdinal: 5,
      seq: 46,
      agentTypeId: WORKER,
      title: "Needs you: approve outreach experiment",
      detail: "20 replies over 10 days to prior engagers. Terminal action — messages go out under your name.",
      relativeTime: "1h ago",
    },
    {
      kind: "marker",
      id: "m-suspend",
      turnOrdinal: 5,
      seq: 46,
      markerOrdinal: 4,
      variant: "suspend",
      text: "chain suspended — waiting on you",
    },
    {
      kind: "post",
      id: "p-5",
      turnOrdinal: 6,
      seq: 47,
      agentTypeId: OWNER,
      phase: "settled",
      relativeTime: "35m ago",
      body: "Approved — keep it to prior engagers only.",
    },
    {
      kind: "post",
      id: "p-6",
      turnOrdinal: 6,
      seq: 51,
      agentTypeId: WORKER,
      phase: "settled",
      relativeTime: "20m ago",
      body: "Ran days 1–3: 7 replies sent, 3 follows inside 72h. On pace against the 4/20 bar. Posting cadence held at three for the week.",
    },
    {
      kind: "post",
      id: "p-7",
      turnOrdinal: 7,
      seq: 6,
      agentTypeId: WORKER,
      phase: "settled",
      relativeTime: "18m ago",
      toolCall: "update_objective",
      body: "followers: 3,100 → 3,400 (target 10,000). Evidence: 3 follows from outreach, the rest from the long-form piece.",
    },
  ],
}

/* ------------------------------------------------------------------ *
 * Seat chips — the SAME deterministic palette as the console left pane.
 *
 * `AppLeftPaneConsoleSpike` keeps `agentChipPalette` / `agentChipClassName`
 * private, so this is a verbatim mirror (same array order, same `hash*31`
 * fold) rather than a second colour scheme. If either moves, they must move
 * together — extracting the helper is the real fix and is out of scope for a
 * fixture spike.
 * ------------------------------------------------------------------ */

const agentChipPalette = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
] as const

const neutralChipClassName = "bg-foreground/[0.07] text-muted-foreground"

export function jobThreadChipClassName(agentTypeId: string | undefined): string {
  if (!agentTypeId) return neutralChipClassName
  let hash = 0
  for (let index = 0; index < agentTypeId.length; index += 1) {
    hash = (hash * 31 + agentTypeId.charCodeAt(index)) >>> 0
  }
  return agentChipPalette[hash % agentChipPalette.length] ?? neutralChipClassName
}

function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.[0]
  if (!first) return "?"
  const second = words[1]?.[0]
  return (second ? `${first}${second}` : first).toUpperCase()
}

function SeatChip({ agentTypeId, name, size = "sm" }: { agentTypeId: string; name: string; size?: "sm" | "md" }) {
  return (
    <span
      data-boring-workspace-part="job-thread-seat-chip"
      data-boring-agent-type-id={agentTypeId}
      title={name}
      className={[
        "grid shrink-0 place-items-center rounded-full font-semibold leading-none",
        // `md` is the overlapped header stack, so it needs a ring to read as
        // separate faces; `sm` sits inline in an attribution line and does not.
        size === "md" ? "size-5 text-[10px] ring-2 ring-background" : "size-4 text-[9px]",
        jobThreadChipClassName(agentTypeId),
      ].join(" ")}
    >
      {initials(name)}
    </span>
  )
}


/* ------------------------------------------------------------------ *
 * Continuity switch.
 *
 * The owner's rule: a one-seat job must be indistinguishable from today's
 * chat. Seat attribution is the only multi-agent tell on this screen, so it is
 * derived, not hardcoded — one non-owner participant, no attribution, and the
 * transcript collapses to plain Pi chat.
 * ------------------------------------------------------------------ */

export function jobThreadSeats(fixture: JobThreadFixture): readonly JobThreadParticipant[] {
  return fixture.participants.filter((participant) => participant.role !== "owner")
}

export function jobThreadShowsSeatAttribution(fixture: JobThreadFixture): boolean {
  return jobThreadSeats(fixture).length > 1
}

/* ------------------------------------------------------------------ *
 * Header — deliberately not a dashboard: one row, chat-toolbar height.
 *
 * `plugins/objectives` (PR #1382) is not on this branch, so there is no Meter
 * to import. This is the same idiom shrunk to a toolbar: a short track from
 * baseline to target with the current value called out.
 * ------------------------------------------------------------------ */

function compact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(value)
}

function ObjectiveMeter({ metric, baseline, current, target }: JobThreadFixture["objective"]) {
  const span = Math.max(1, target - baseline)
  const progress = Math.min(1, Math.max(0, (current - baseline) / span))
  return (
    <div
      data-boring-workspace-part="job-thread-objective"
      title={`${metric}: baseline ${compact(baseline)} → current ${compact(current)}, target ${compact(target)}`}
      className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground"
    >
      <span className="tabular-nums">
        <span className="font-medium text-foreground">{compact(current)}</span>
        <span className="text-muted-foreground/60">{` / ${compact(target)} ${metric}`}</span>
      </span>
      <span className="h-1 w-16 overflow-hidden rounded-full bg-foreground/[0.08]">
        <span
          className="block h-full rounded-full bg-emerald-500/70"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Rows.
 * ------------------------------------------------------------------ */

/**
 * The drill-down affordance. The private session is never inlined — this is
 * the seam where a session peek would open. Inert in the mock.
 */
function ViewSessionLink({ sessionId }: { sessionId?: string }) {
  if (!sessionId) return null
  return (
    <button
      type="button"
      disabled
      title={`Session ${sessionId} (drill-down not wired in this mock)`}
      data-boring-workspace-part="job-thread-drilldown"
      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[12px] text-muted-foreground/60 opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-default"
    >
      view session
      <svg viewBox="0 0 16 16" aria-hidden className="size-3">
        <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

/**
 * System line. Slack's "X joined the channel" register: quiet, inline, left
 * with the transcript, no rules and no card. Mirrors the muted weight of the
 * collapsed tool line rather than inventing a marker style.
 */
function SystemLine({ entry }: { entry: JobThreadMarker }) {
  return (
    <div
      data-boring-workspace-part="job-thread-marker"
      data-marker-variant={entry.variant}
      className="flex items-center gap-2 text-[12px] leading-5 text-muted-foreground/70"
    >
      <span aria-hidden className="size-1 shrink-0 rounded-full bg-muted-foreground/40" />
      <span className="min-w-0">{entry.text}</span>
    </div>
  )
}

/** A message from the human. Identical to today's chat: bubble, nothing else. */
function UserMessage({ entry }: { entry: JobThreadPost }) {
  return (
    <div
      data-boring-agent-message-role="user"
      data-boring-workspace-part="job-thread-post"
      data-turn-ordinal={entry.turnOrdinal}
      className="group ml-auto flex w-full max-w-full flex-col justify-end gap-1.5"
    >
      <div className="ml-auto flex w-fit min-w-0 max-w-[80%] flex-col gap-2 overflow-visible rounded-[var(--radius-lg)] bg-secondary px-4 py-2.5 text-[13px] leading-5 text-foreground">
        {entry.body}
      </div>
    </div>
  )
}

/**
 * A message from an agent. Today's assistant message — full width, no bubble —
 * plus one line of seat attribution, which is the ONLY multi-agent tell and is
 * omitted entirely on a one-seat job.
 */
function AgentMessage({
  entry,
  participant,
  showAttribution,
}: {
  entry: JobThreadPost
  participant?: JobThreadParticipant
  showAttribution: boolean
}) {
  const name = participant?.name ?? entry.agentTypeId
  return (
    <div
      data-boring-agent-message-role="assistant"
      data-boring-workspace-part="job-thread-post"
      data-turn-ordinal={entry.turnOrdinal}
      className="group flex w-full max-w-full flex-col gap-1.5"
    >
      {showAttribution ? (
        <div
          data-boring-workspace-part="job-thread-attribution"
          className="flex max-w-[40.5rem] items-center gap-1.5 text-[12px] leading-5 text-muted-foreground"
        >
          <SeatChip agentTypeId={entry.agentTypeId} name={name} />
          <span className="truncate font-medium text-foreground/80">{name}</span>
          <span className="shrink-0 text-muted-foreground/60">{entry.relativeTime}</span>
          {entry.snapshotDerived ? (
            <span
              title="Rebuilt from a session snapshot: no per-message seq, ordered by array position (plan §3)"
              className="shrink-0 text-muted-foreground/50"
            >
              · from snapshot
            </span>
          ) : null}
          <span className="flex-1" />
          <ViewSessionLink sessionId={participant?.sessionId} />
        </div>
      ) : null}
      <div className="flex w-full min-w-0 max-w-[40.5rem] flex-col gap-2 overflow-visible bg-transparent p-0 text-[13px] leading-5 text-foreground">
        {entry.toolCall ? (
          <span className="text-[12px] text-muted-foreground">{entry.toolCall}()</span>
        ) : null}
        <p>{entry.body}</p>
      </div>
    </div>
  )
}

/**
 * The ask-user gate, rendered where ask-user already renders in chat: an inline
 * block in the transcript, not a special card. Structure is ask-user's own
 * `PendingQuestionBody` (eyebrow / question / context / bordered footer); the
 * surface is the warning tone from `noticeStyles.ts`, per the owner's amber.
 */
function GateBlock({ entry, participant }: { entry: JobThreadGate; participant?: JobThreadParticipant }) {
  const name = participant?.name ?? entry.agentTypeId
  return (
    <section
      data-boring-workspace-part="job-thread-gate"
      data-boring-ask-user-inline-question="true"
      className="max-w-[40.5rem] rounded-[var(--radius-md)] border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm shadow-none"
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Waiting for answer
        <span className="normal-case tracking-normal text-muted-foreground/60">{entry.relativeTime}</span>
      </div>
      <h2 className="mt-2 text-balance text-sm font-semibold leading-5 text-foreground">{entry.title}</h2>
      <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">{entry.detail}</p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <p className="min-w-0 text-xs text-muted-foreground">{`Answers ${name} and continues the job.`}</p>
        {/* Inert: the mock has no ask-user runtime to answer. */}
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground disabled:cursor-default"
          >
            Reject
          </button>
          <button
            type="button"
            disabled
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-default"
          >
            Approve
          </button>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * The view.
 * ------------------------------------------------------------------ */

export function JobThreadView({ fixture = JOB_THREAD_FIXTURE }: { fixture?: JobThreadFixture }): ReactNode {
  const ordered = jobThreadTimelineOrder(fixture.entries)
  const byAgent = new Map(fixture.participants.map((participant) => [participant.agentTypeId, participant]))
  const seats = jobThreadSeats(fixture)
  const showAttribution = jobThreadShowsSeatAttribution(fixture)
  const owners = new Set(
    fixture.participants.filter((participant) => participant.role === "owner").map((participant) => participant.agentTypeId),
  )

  return (
    <div
      data-boring-workspace-part="job-thread-view"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent text-[13px] text-foreground antialiased"
    >
      {/* Header: title, who is staffed, where the Objective stands. Nothing else. */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-2">
        <div className="flex -space-x-1">
          {seats.map((seat) => (
            <SeatChip key={seat.agentTypeId} agentTypeId={seat.agentTypeId} name={seat.name} size="md" />
          ))}
        </div>
        <h1 className="min-w-0 truncate text-[13px] font-medium text-foreground">{fixture.title}</h1>
        <span
          data-boring-workspace-part="job-thread-status"
          className="shrink-0 text-[12px] text-muted-foreground/70"
        >
          {fixture.status}
        </span>
        <span className="flex-1" />
        <ObjectiveMeter {...fixture.objective} />
      </header>

      {/* Fixture disclosure — this screen is a mock and says so. */}
      <p className="shrink-0 border-b border-border/60 px-4 py-1 text-[11px] text-muted-foreground/70">
        FIXTURE — mocked Job Thread v0. No relay, no gateway, no store. Controls are inert.
      </p>

      {/* Transcript: the Pi chat list geometry, unchanged. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-4 py-4">
          {ordered.map((entry) => {
            if (entry.kind === "marker") return <SystemLine key={entry.id} entry={entry} />
            if (entry.kind === "gate") {
              return <GateBlock key={entry.id} entry={entry} participant={byAgent.get(entry.agentTypeId)} />
            }
            if (owners.has(entry.agentTypeId)) return <UserMessage key={entry.id} entry={entry} />
            return (
              <AgentMessage
                key={entry.id}
                entry={entry}
                participant={byAgent.get(entry.agentTypeId)}
                showAttribution={showAttribution}
              />
            )
          })}
        </div>
      </div>

      {/* Composer: one job, one place to talk to it. Visual-only. */}
      <div className="relative z-20 shrink-0 px-3 pb-2 pt-1">
        <div className="relative mx-auto flex w-full max-w-[680px] items-center overflow-visible rounded-xl bg-transparent shadow-[inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)]">
          <textarea
            readOnly
            rows={1}
            data-boring-workspace-part="job-thread-composer"
            placeholder="Message the job… use @ to address a specific agent"
            className="min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent px-3 py-3 text-sm leading-6 text-foreground shadow-none outline-none placeholder:text-muted-foreground/60"
          />
          <span
            aria-hidden
            className="mr-2 grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background opacity-40"
          >
            <svg viewBox="0 0 16 16" className="size-3.5">
              <path d="M8 13V3M8 3L4 7M8 3l4 4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  )
}

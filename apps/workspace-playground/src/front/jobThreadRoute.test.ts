import { describe, expect, it } from "vitest"
import { isJobThreadRoute } from "./jobThreadRoute"
import {
  JOB_THREAD_FIXTURE,
  jobThreadSeats,
  jobThreadShowsSeatAttribution,
  jobThreadTimelineOrder,
} from "./JobThreadView"

describe("isJobThreadRoute", () => {
  it("matches only the explicit opt-in", () => {
    expect(isJobThreadRoute("?jobThread=1")).toBe(true)
    expect(isJobThreadRoute("?jobThread=0")).toBe(false)
    expect(isJobThreadRoute("")).toBe(false)
    expect(isJobThreadRoute("?consoleSpike=1")).toBe(false)
  })
})

describe("job thread fixture", () => {
  /**
   * The plan's projection contract (§3/§4): merged rendering sorts
   * `(turnOrdinal, seq, markerOrdinal)`. The fixture is the mock's only source
   * of truth, so the ordering rule is asserted here rather than trusted.
   */
  it("renders in (turnOrdinal, seq, markerOrdinal) order", () => {
    const shuffled = [...JOB_THREAD_FIXTURE.entries].reverse()
    const ordered = jobThreadTimelineOrder(shuffled)
    const keys = ordered.map((entry) => [entry.turnOrdinal, entry.seq ?? 0, entry.markerOrdinal ?? 0] as const)
    for (let index = 1; index < keys.length; index += 1) {
      const previous = keys[index - 1]!
      const current = keys[index]!
      const rank = current.findIndex((value, position) => value !== previous[position])
      // Equal tuples are fine; the first differing component must increase —
      // compared as INTEGERS, which is the whole point of §3's ordinal rule.
      if (rank !== -1) expect(current[rank]! > previous[rank]!).toBe(true)
    }
    expect(ordered.map((entry) => entry.id)).toEqual(JOB_THREAD_FIXTURE.entries.map((entry) => entry.id))
  })

  /**
   * The owner's continuity rule, as a property rather than a promise: seat
   * attribution is the ONLY multi-agent tell on the screen, so a job with one
   * seat must switch it off and render as plain chat.
   */
  it("shows seat attribution only when the job is actually multi-seat", () => {
    expect(jobThreadSeats(JOB_THREAD_FIXTURE).map((seat) => seat.role)).toEqual(["worker", "reviewer"])
    expect(jobThreadShowsSeatAttribution(JOB_THREAD_FIXTURE)).toBe(true)

    const soloSeat = jobThreadSeats(JOB_THREAD_FIXTURE)[0]!
    const soloJob = {
      ...JOB_THREAD_FIXTURE,
      participants: JOB_THREAD_FIXTURE.participants.filter(
        (participant) => participant.role === "owner" || participant.agentTypeId === soloSeat.agentTypeId,
      ),
    }
    expect(jobThreadShowsSeatAttribution(soloJob)).toBe(false)
  })

  it("only carries settled posts", () => {
    for (const entry of JOB_THREAD_FIXTURE.entries) {
      if (entry.kind !== "post") continue
      expect(entry.phase).toBe("settled")
    }
  })
})

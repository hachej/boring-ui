import { describe, expect, it } from "vitest"
import { parseScheduleCadence, parseScheduleCommandArgs } from "../scheduleCommand"

describe("/schedule cadence parsing", () => {
  it.each([
    ["0 8 * * *", "0 8 * * *"],
    ["daily 8am", "0 8 * * *"],
    ["daily 8:30pm", "30 20 * * *"],
    ["weekdays 9:00", "0 9 * * 1-5"],
    ["every 10m", "*/10 * * * *"],
    ["every 2h", "0 */2 * * *"],
  ])("resolves %s", (input, expected) => {
    expect(parseScheduleCadence(input)).toBe(expected)
  })

  it.each(["daily tomorrow", "every 7m", "weekdays 25:00", "0 0 9 * * *", "someday"])(
    "rejects %s",
    (input) => expect(parseScheduleCadence(input)).toBeNull(),
  )

  it("splits cadence, prompt, quoted flags, and overrides", () => {
    expect(parseScheduleCommandArgs("daily 8am send the digest --timezone Europe/Zurich --model openai:gpt-5 --agent worker --title 'Morning digest'"))
      .toEqual({
        cron: "0 8 * * *",
        prompt: "send the digest",
        timezone: "Europe/Zurich",
        model: "openai:gpt-5",
        agentTypeId: "worker",
        title: "Morning digest",
      })
  })

  it("passes through a five-field cron and keeps the remaining prompt", () => {
    expect(parseScheduleCommandArgs("0 8 * * * summarize yesterday"))
      .toMatchObject({ cron: "0 8 * * *", prompt: "summarize yesterday" })
  })

  it.each([
    ["daily nope run", "could not parse cadence"],
    ["daily 8am", "prompt is required"],
    ["daily 8am run --timezone Mars/Base", "invalid timezone"],
    ["daily 8am run --wat value", "unknown flag"],
  ])("returns an actionable error for %s", (input, message) => {
    expect(() => parseScheduleCommandArgs(input)).toThrow(message)
  })
})

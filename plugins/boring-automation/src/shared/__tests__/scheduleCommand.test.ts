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
    expect(parseScheduleCommandArgs("--timezone Europe/Zurich --model openai:gpt-5 --agent worker --title 'Morning digest' daily 8am send the digest"))
      .toEqual({
        cron: "0 8 * * *",
        prompt: "send the digest",
        timezone: "Europe/Zurich",
        model: "openai:gpt-5",
        agentTypeId: "worker",
        title: "Morning digest",
      })
  })

  it("passes through cron while preserving arbitrary prompt quoting and backslashes", () => {
    expect(parseScheduleCommandArgs("0 8 * * * summarize 'yesterday' from C:\\\\reports"))
      .toMatchObject({ cron: "0 8 * * *", prompt: "summarize 'yesterday' from C:\\\\reports" })
  })

  it.each([
    ["daily nope run", "could not parse cadence"],
    ["daily 8am", "prompt is required"],
    ["--timezone Mars/Base daily 8am run", "invalid timezone"],
    ["--wat value daily 8am run", "unknown flag"],
  ])("returns an actionable error for %s", (input, message) => {
    expect(() => parseScheduleCommandArgs(input)).toThrow(message)
  })
})

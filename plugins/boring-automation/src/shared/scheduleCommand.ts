import { Cron } from "croner"
import { isValidFiveFieldCron, isValidIanaTimeZone } from "./schedule"

export const SCHEDULE_COMMAND_USAGE = [
  "Usage: /schedule [flags] <cadence> <prompt...>",
  "Cadence examples: 'daily 8am', 'every 10m', 'weekdays 9:00', or '0 8 * * *'.",
  "Flags (before cadence): --timezone <IANA>, --model <provider:model>, --agent <agentTypeId>, --title <title>.",
].join("\n")

export interface ParsedScheduleCommand {
  cron: string
  prompt: string
  title?: string
  timezone?: string
  model?: string
  agentTypeId?: string
}

export function parseScheduleCadence(input: string): string | null {
  const normalized = input.trim().replace(/\s+/g, " ")
  if (isValidFiveFieldCron(normalized)) return normalized

  const daily = /^daily\s+(.+)$/i.exec(normalized)
  if (daily) {
    const time = parseClockTime(daily[1]!)
    return time ? `${time.minute} ${time.hour} * * *` : null
  }

  const weekdays = /^weekdays\s+(.+)$/i.exec(normalized)
  if (weekdays) {
    const time = parseClockTime(weekdays[1]!)
    return time ? `${time.minute} ${time.hour} * * 1-5` : null
  }

  const interval = /^every\s+(\d+)(m|h)$/i.exec(normalized)
  if (interval) {
    const amount = Number(interval[1])
    const unit = interval[2]!.toLowerCase()
    if (unit === "m" && amount >= 1 && amount <= 59 && 60 % amount === 0) return `*/${amount} * * * *`
    if (unit === "h" && amount >= 1 && amount <= 23 && 24 % amount === 0) return `0 */${amount} * * *`
  }

  return null
}

export function parseScheduleCommandArgs(args: string): ParsedScheduleCommand {
  const { flags, remainder } = parseLeadingFlags(args)
  if (flags.timezone && !isValidIanaTimeZone(flags.timezone)) {
    throw new Error("invalid timezone — use an IANA timezone such as Europe/Zurich")
  }

  const cadence = parseCadence(remainder)
  if (!cadence) throw new Error("could not parse cadence — try 'daily 8am' or '0 8 * * *'")
  const prompt = remainder.slice(cadence.consumed).trim()
  if (!prompt) throw new Error("prompt is required after the cadence")
  return { cron: cadence.cron, prompt, ...flags }
}

export function nextScheduleFire(cron: string, timezone: string, after = new Date()): string {
  const next = new Cron(cron, { timezone }).nextRun(after)
  if (!next) throw new Error("schedule has no next fire time")
  return next.toISOString()
}

function parseCadence(input: string): { cron: string; consumed: number } | null {
  const cronMatch = /^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)(?=\s|$)/.exec(input)
  if (cronMatch && isValidFiveFieldCron(cronMatch[1]!)) {
    return { cron: cronMatch[1]!.replace(/\s+/g, " "), consumed: cronMatch[0].length }
  }
  const humanMatch = /^(daily|weekdays|every)\s+(\S+)(?=\s|$)/i.exec(input)
  if (!humanMatch) return null
  const cron = parseScheduleCadence(`${humanMatch[1]} ${humanMatch[2]}`)
  return cron ? { cron, consumed: humanMatch[0].length } : null
}

function parseLeadingFlags(input: string): {
  flags: Partial<Record<"timezone" | "model" | "agentTypeId" | "title", string>>
  remainder: string
} {
  const flags: Partial<Record<"timezone" | "model" | "agentTypeId" | "title", string>> = {}
  let cursor = skipSpace(input, 0)
  while (input.startsWith("--", cursor)) {
    const flag = readToken(input, cursor)
    const separator = flag.value.indexOf("=")
    const rawName = (separator >= 0 ? flag.value.slice(2, separator) : flag.value.slice(2))
    const name = rawName === "agent" ? "agentTypeId" : rawName
    if (name !== "timezone" && name !== "model" && name !== "agentTypeId" && name !== "title") {
      throw new Error(`unknown flag --${rawName}`)
    }
    let value = separator >= 0 ? flag.value.slice(separator + 1) : ""
    cursor = skipSpace(input, flag.end)
    if (separator < 0) {
      const valueToken = readToken(input, cursor)
      value = valueToken.value
      cursor = skipSpace(input, valueToken.end)
    }
    if (!value) throw new Error(`--${rawName} requires a value`)
    flags[name] = value
  }
  return { flags, remainder: input.slice(cursor) }
}

function readToken(input: string, start: number): { value: string; end: number } {
  if (start >= input.length) throw new Error("flag requires a value")
  let cursor = start
  let value = ""
  const quote = input[cursor] === "'" || input[cursor] === '"' ? input[cursor++] : null
  while (cursor < input.length) {
    const character = input[cursor]!
    if (quote) {
      if (character === quote) return { value, end: cursor + 1 }
      if (character === "\\" && quote === '"' && cursor + 1 < input.length) value += input[++cursor]!
      else value += character
      cursor += 1
      continue
    }
    if (/\s/.test(character)) break
    value += character
    cursor += 1
  }
  if (quote) throw new Error("unterminated quote in /schedule arguments")
  return { value, end: cursor }
}

function skipSpace(input: string, start: number): number {
  let cursor = start
  while (cursor < input.length && /\s/.test(input[cursor]!)) cursor += 1
  return cursor
}

function parseClockTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim())
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2] ?? "0")
  const meridiem = match[3]?.toLowerCase()
  if (minute < 0 || minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    if (hour === 12) hour = 0
    if (meridiem === "pm") hour += 12
  } else if (hour < 0 || hour > 23) {
    return null
  }
  return { hour, minute }
}

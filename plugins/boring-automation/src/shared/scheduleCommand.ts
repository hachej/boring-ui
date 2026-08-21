import { Cron } from "croner"
import { isValidFiveFieldCron, isValidIanaTimeZone } from "./schedule"

export const SCHEDULE_COMMAND_USAGE = [
  "Usage: /schedule <cadence> <prompt...>",
  "Cadence examples: 'daily 8am', 'every 10m', 'weekdays 9:00', or '0 8 * * *'.",
  "Optional flags: --timezone <IANA>, --model <provider:model>, --agent <agentTypeId>, --title <title>.",
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
  const tokens = tokenize(args)
  const positional: string[] = []
  const flags: Partial<Record<"timezone" | "model" | "agentTypeId" | "title", string>> = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (!token.startsWith("--")) {
      positional.push(token)
      continue
    }
    const [rawName, inlineValue] = token.slice(2).split("=", 2)
    const name = rawName === "agent" ? "agentTypeId" : rawName
    if (name !== "timezone" && name !== "model" && name !== "agentTypeId" && name !== "title") {
      throw new Error(`unknown flag --${rawName}`)
    }
    const value = inlineValue ?? tokens[++index]
    if (!value || value.startsWith("--")) throw new Error(`--${rawName} requires a value`)
    flags[name] = value
  }

  if (flags.timezone && !isValidIanaTimeZone(flags.timezone)) {
    throw new Error("invalid timezone — use an IANA timezone such as Europe/Zurich")
  }

  let cadenceLength = 0
  let cron: string | null = null
  if (positional.length >= 5) {
    const candidate = positional.slice(0, 5).join(" ")
    if (isValidFiveFieldCron(candidate)) {
      cadenceLength = 5
      cron = candidate
    }
  }
  if (!cron && positional.length >= 2) {
    cadenceLength = 2
    cron = parseScheduleCadence(positional.slice(0, 2).join(" "))
  }
  if (!cron) {
    throw new Error("could not parse cadence — try 'daily 8am' or '0 8 * * *'")
  }

  const prompt = positional.slice(cadenceLength).join(" ").trim()
  if (!prompt) throw new Error("prompt is required after the cadence")
  return { cron, prompt, ...flags }
}

export function nextScheduleFire(cron: string, timezone: string, after = new Date()): string {
  const next = new Cron(cron, { timezone }).nextRun(after)
  if (!next) throw new Error("schedule has no next fire time")
  return next.toISOString()
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

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaped = false
  for (const character of input.trim()) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === "\\" && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (current) tokens.push(current)
      current = ""
      continue
    }
    current += character
  }
  if (escaped) current += "\\"
  if (quote) throw new Error("unterminated quote in /schedule arguments")
  if (current) tokens.push(current)
  return tokens
}

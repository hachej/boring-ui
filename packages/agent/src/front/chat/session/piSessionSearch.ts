import { fuzzyMatch } from "@earendil-works/pi-tui/dist/fuzzy.js"

export interface PiSessionSearchItem {
  id: string
  /** boring-ui session title maps to pi's session display name. */
  title?: string | null
  /** Optional pi-style session name for callers that already expose it. */
  name?: string | null
  /** Optional full transcript search text when available from a pi session listing. */
  allMessagesText?: string | null
  /** Optional cwd from the underlying pi session. */
  cwd?: string | null
  updatedAt?: string | number | Date | null
}

export type PiSessionSearchSortMode = "fuzzy" | "recent"

export interface PiSessionSearchOptions {
  sortMode?: PiSessionSearchSortMode
  limit?: number
}

type SearchToken = { kind: "fuzzy" | "phrase"; value: string }

type ParsedSearchQuery =
  | { mode: "tokens"; tokens: SearchToken[]; regex: null; error?: undefined }
  | { mode: "regex"; tokens: []; regex: RegExp | null; error?: string }

function normalizeWhitespaceLower(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

function sessionModifiedMs(session: PiSessionSearchItem): number {
  const value = session.updatedAt
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function getSessionSearchText(session: PiSessionSearchItem): string {
  const name = session.name ?? session.title ?? ""
  return `${session.id} ${name} ${session.allMessagesText ?? ""} ${session.cwd ?? ""}`
}

/**
 * Parse session-search queries with the same user-facing syntax as pi's native
 * session picker: whitespace fuzzy tokens, quoted exact phrases, and `re:`
 * regex mode. Kept intentionally small so boring-agent frontends can reuse the
 * pi search behavior without importing the terminal-only session picker UI.
 */
export function parsePiSessionSearchQuery(query: string): ParsedSearchQuery {
  const trimmed = query.trim()
  if (!trimmed) return { mode: "tokens", tokens: [], regex: null }

  if (trimmed.startsWith("re:")) {
    const pattern = trimmed.slice(3).trim()
    if (!pattern) return { mode: "regex", tokens: [], regex: null, error: "Empty regex" }
    try {
      return { mode: "regex", tokens: [], regex: new RegExp(pattern, "i") }
    } catch (error) {
      return {
        mode: "regex",
        tokens: [],
        regex: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const tokens: SearchToken[] = []
  let buffer = ""
  let inQuote = false
  let hadUnclosedQuote = false

  const flush = (kind: SearchToken["kind"]) => {
    const value = buffer.trim()
    buffer = ""
    if (value) tokens.push({ kind, value })
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === '"') {
      if (inQuote) {
        flush("phrase")
        inQuote = false
      } else {
        flush("fuzzy")
        inQuote = true
      }
      continue
    }
    if (!inQuote && /\s/.test(char)) {
      flush("fuzzy")
      continue
    }
    buffer += char
  }

  if (inQuote) hadUnclosedQuote = true
  if (hadUnclosedQuote) {
    return {
      mode: "tokens",
      tokens: trimmed
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .map((value) => ({ kind: "fuzzy", value })),
      regex: null,
    }
  }

  flush(inQuote ? "phrase" : "fuzzy")
  return { mode: "tokens", tokens, regex: null }
}

export function matchPiSessionSearch(session: PiSessionSearchItem, parsed: ParsedSearchQuery): { matches: boolean; score: number } {
  const text = getSessionSearchText(session)

  if (parsed.mode === "regex") {
    if (!parsed.regex) return { matches: false, score: 0 }
    const index = text.search(parsed.regex)
    if (index < 0) return { matches: false, score: 0 }
    return { matches: true, score: index * 0.1 }
  }

  if (parsed.tokens.length === 0) return { matches: true, score: 0 }

  let totalScore = 0
  let normalizedText: string | null = null
  for (const token of parsed.tokens) {
    if (token.kind === "phrase") {
      normalizedText ??= normalizeWhitespaceLower(text)
      const phrase = normalizeWhitespaceLower(token.value)
      if (!phrase) continue
      const index = normalizedText.indexOf(phrase)
      if (index < 0) return { matches: false, score: 0 }
      totalScore += index * 0.1
      continue
    }

    const match = fuzzyMatch(token.value, text)
    if (!match.matches) return { matches: false, score: 0 }
    totalScore += match.score
  }

  return { matches: true, score: totalScore }
}

export function searchPiSessions<T extends PiSessionSearchItem>(
  sessions: readonly T[],
  query: string,
  options: PiSessionSearchOptions = {},
): T[] {
  const { sortMode = "fuzzy", limit } = options
  const trimmed = query.trim()
  const source = [...sessions]
  if (!trimmed) return limit == null ? source : source.slice(0, limit)

  const parsed = parsePiSessionSearchQuery(trimmed)
  if (parsed.error) return []

  if (sortMode === "recent") {
    const filtered = source.filter((session) => matchPiSessionSearch(session, parsed).matches)
    return limit == null ? filtered : filtered.slice(0, limit)
  }

  const scored: Array<{ session: T; score: number }> = []
  for (const session of source) {
    const result = matchPiSessionSearch(session, parsed)
    if (result.matches) scored.push({ session, score: result.score })
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    return sessionModifiedMs(b.session) - sessionModifiedMs(a.session)
  })

  const results = scored.map((result) => result.session)
  return limit == null ? results : results.slice(0, limit)
}

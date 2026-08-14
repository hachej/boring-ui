/**
 * Canonical SKILL.md metadata parsing, agent-owned.
 *
 * Pi's own `loadSkills()` (used by `routes/skills.ts`) already parses
 * SKILL.md frontmatter through `@mariozechner/pi-coding-agent`'s
 * `parseFrontmatter`, which handles CRLF line endings, quoted values, and
 * folded/multiline YAML scalars via a real YAML parser. Hosts that need
 * just the `name`/`description` metadata from a SKILL.md file — without
 * going through Pi's full skill-discovery pipeline (cwd/agentDir/package
 * resolution) — should use this wrapper instead of hand-rolling their own
 * frontmatter scanner, so every caller shares one YAML-correct parser
 * instead of drifting (a bespoke `---\nkey: value\n---` line-scanner
 * silently drops CRLF/quoted/folded values that this parser handles
 * correctly).
 *
 * This lives in `@hachej/boring-agent/server` (not `/shared`) because it
 * wraps `@mariozechner/pi-coding-agent`, a server-only dependency — apps
 * that already depend on `@hachej/boring-agent/server` (e.g. Workspace)
 * can consume it without adding a new dependency edge to Pi.
 */
import { parseFrontmatter } from '@mariozechner/pi-coding-agent'

export interface SkillMetadataFrontmatter {
  readonly name?: string
  readonly description?: string
}

export function parseSkillMetadataFrontmatter(content: string): SkillMetadataFrontmatter {
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content)
  const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : undefined
  const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : undefined
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  }
}

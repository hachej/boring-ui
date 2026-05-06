import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const AGENT_DIST = join(import.meta.dirname!, '..', 'dist')
const FORBIDDEN_PREFIX = '@hachej/boring-core'

const SPECIFIER_RE =
  /(?:from\s+|import\s*\(|require\s*\()["']([^"']+)["']/g

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(full)))
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      files.push(full)
    }
  }
  return files
}

async function main() {
  const files = await walk(AGENT_DIST)
  if (files.length === 0) {
    process.stderr.write(
      `agent-isolation: FAIL — no .js/.mjs files found in ${AGENT_DIST}\n` +
        '  Run "pnpm --filter @hachej/boring-agent build" first.\n',
    )
    process.exitCode = 1
    return
  }

  const violations: { file: string; line: number; specifier: string }[] = []

  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      let match: RegExpExecArray | null
      SPECIFIER_RE.lastIndex = 0
      while ((match = SPECIFIER_RE.exec(lines[i])) !== null) {
        const specifier = match[1]
        if (
          specifier === FORBIDDEN_PREFIX ||
          specifier.startsWith(FORBIDDEN_PREFIX + '/')
        ) {
          violations.push({
            file: relative(join(AGENT_DIST, '..'), file),
            line: i + 1,
            specifier,
          })
        }
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('agent-isolation: FAIL\n')
    for (const v of violations) {
      process.stderr.write(`  ${v.file}:${v.line}  →  ${v.specifier}\n`)
    }
    process.stderr.write(
      `\n  @hachej/boring-agent must have ZERO runtime imports from @hachej/boring-core.\n` +
        '  Type-only imports are allowed (erased by tsc).\n',
    )
    process.exitCode = 1
    return
  }

  process.stdout.write(
    `agent-isolation: OK (${files.length} files scanned)\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`agent-isolation: FAIL\n${String(err)}\n`)
  process.exitCode = 1
})

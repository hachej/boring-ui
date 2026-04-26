import { readFile } from "node:fs/promises"
import { glob } from "node:fs"
import { promisify } from "node:util"
import path from "node:path"
import process from "node:process"

const globAsync = promisify(glob)

const APPS_DIR = path.resolve("apps")

const FORBIDDEN_PATTERNS: Array<{
  pattern: RegExp
  message: string
}> = [
  {
    pattern: /from\s+['"]\.\.\/.*packages\/core\/src\//,
    message: "Direct import from packages/core/src/ — use @boring/core/* public exports",
  },
  {
    pattern: /from\s+['"]\.\.\/.*packages\/workspace\/src\//,
    message: "Direct import from packages/workspace/src/ — use @boring/workspace public exports",
  },
  {
    pattern: /from\s+['"]\.\.\/.*packages\/agent\/src\//,
    message: "Direct import from packages/agent/src/ — use @boring/agent/* public exports",
  },
  {
    pattern: /from\s+['"]boring-ui['"\/]/,
    message: "Import from deprecated v1 'boring-ui' package",
  },
  {
    pattern: /from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\/packages\//,
    message: "Relative import crossing package boundary — use @boring/* workspace deps",
  },
  {
    pattern: /require\s*\(\s*['"]\.\.\/.*packages\/(core|workspace|agent)\/src\//,
    message: "Require from packages/*/src/ — use @boring/* public exports",
  },
]

const IGNORE_PATTERNS = [
  /\.d\.ts$/,
  /vite\.config\./,
  /node_modules/,
  /\/dist\//,
]

interface Violation {
  file: string
  line: number
  text: string
  rule: string
}

async function collectSourceFiles(): Promise<string[]> {
  const patterns = [
    path.join(APPS_DIR, "*/src/**/*.ts"),
    path.join(APPS_DIR, "*/src/**/*.tsx"),
    path.join(APPS_DIR, "*/src/**/*.js"),
    path.join(APPS_DIR, "*/src/**/*.jsx"),
  ]

  const allFiles: string[] = []
  for (const pattern of patterns) {
    const files = await globAsync(pattern)
    allFiles.push(...files)
  }

  return allFiles.filter(
    (f) => !IGNORE_PATTERNS.some((re) => re.test(f)),
  )
}

async function auditFile(filePath: string): Promise<Violation[]> {
  const content = await readFile(filePath, "utf8")
  const lines = content.split("\n")
  const violations: Violation[] = []
  const relPath = path.relative(process.cwd(), filePath)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.pattern.test(line)) {
        violations.push({
          file: relPath,
          line: i + 1,
          text: line.trim(),
          rule: rule.message,
        })
      }
    }
  }

  return violations
}

async function main(): Promise<void> {
  const files = await collectSourceFiles()

  if (files.length === 0) {
    console.log("No source files found in apps/")
    return
  }

  console.log(`Auditing ${files.length} source files in apps/...\n`)

  const allViolations: Violation[] = []

  for (const file of files) {
    const violations = await auditFile(file)
    allViolations.push(...violations)
  }

  if (allViolations.length === 0) {
    console.log("Import audit PASSED — no forbidden patterns found.")
    return
  }

  console.error("Import audit FAILED:\n")
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    ${v.rule}`)
    console.error(`    > ${v.text}\n`)
  }

  console.error(`${allViolations.length} violation(s) found.`)
  process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

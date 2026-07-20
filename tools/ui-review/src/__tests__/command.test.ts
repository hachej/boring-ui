import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const parser = resolve(process.cwd(), "scripts/ui-review-args.mjs")

function parse(args: string[]): unknown {
  const script = `import { parseUiReviewArgs } from ${JSON.stringify(`file://${parser}`)}; console.log(JSON.stringify(parseUiReviewArgs(JSON.parse(process.argv[1]), {})))`
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script, JSON.stringify(args)], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr.match(/UI_REVIEW_(?:SPEC_ID|COMMAND)_INVALID[^\n]*/)?.[0] ?? result.stderr)
  return JSON.parse(result.stdout)
}

describe("UI review command", () => {
  it("accepts explicit improve and an optional local baseline", () => {
    expect(parse(["--", "improve", "workspace-command-palette", "--critic=fixture", "--baseline-dir", "/tmp/before"])).toMatchObject({
      mode: "improve",
      scenario: "workspace-command-palette",
      critic: "fixture",
      baselineDir: "/tmp/before",
    })
  })

  it.each([
    ["improve", "https://example.com"],
    ["review", "javascript:alert(1)"],
    ["improve", "../command-palette"],
    ["delete", "command-palette"],
    ["improve", "command-palette", "unexpected"],
  ])("rejects arbitrary or adversarial input %j", (...args) => {
    expect(() => parse(args)).toThrow(/UI_REVIEW_(?:SPEC_ID|COMMAND)_INVALID/)
  })
})

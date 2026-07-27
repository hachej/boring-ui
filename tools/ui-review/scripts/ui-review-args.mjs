export function parseUiReviewArgs(argv, env = process.env) {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv
  const values = new Map()
  const flags = new Set()
  const positional = []
  const valueOptions = new Set(["scenario", "critic", "baseline-dir"])
  const flagOptions = new Set(["explore-only"])
  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index]
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const [rawName, inline] = arg.slice(2).split("=", 2)
    if (flagOptions.has(rawName)) {
      if (inline !== undefined || flags.has(rawName)) throw new Error(`UI_REVIEW_ARGUMENT_INVALID:${arg}`)
      flags.add(rawName)
      continue
    }
    if (!valueOptions.has(rawName) || values.has(rawName)) throw new Error(`UI_REVIEW_ARGUMENT_INVALID:${arg}`)
    const value = inline ?? normalizedArgv[++index]
    if (!value || value.startsWith("--")) throw new Error(`UI_REVIEW_ARGUMENT_VALUE_MISSING:${rawName}`)
    values.set(rawName, value)
  }
  let mode = "review"
  let scenario = values.get("scenario")
  if (positional.length > 0) {
    if (positional.length !== 2 || (positional[0] !== "review" && positional[0] !== "improve") || values.has("scenario")) {
      throw new Error("UI_REVIEW_COMMAND_INVALID:expected review|improve <registered-spec>")
    }
    mode = positional[0]
    scenario = positional[1]
  }
  if (!scenario || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario)) throw new Error(`UI_REVIEW_SPEC_ID_INVALID:${scenario ?? "missing"}`)
  return {
    mode,
    scenario,
    critic: values.get("critic") ?? env.UI_REVIEW_CRITIC ?? "fixture",
    baselineDir: values.get("baseline-dir"),
    exploreOnly: flags.has("explore-only"),
  }
}

import { spawn } from "node:child_process"

const [command, encodedArgs, stdioMode] = process.argv.slice(2)
if (!command || !encodedArgs || (stdioMode !== "inherit" && stdioMode !== "ignore")) {
  throw new Error("UI_REVIEW_SUPERVISOR_ARGUMENT_INVALID")
}
const args: unknown = JSON.parse(Buffer.from(encodedArgs, "base64url").toString("utf8"))
if (!Array.isArray(args) || !args.every((value) => typeof value === "string")) {
  throw new Error("UI_REVIEW_SUPERVISOR_ARGUMENT_INVALID")
}

// The supervisor is the stable process-group leader. It survives TERM so the
// owner can safely escalate the same group to KILL without retaining a stale ID.
process.on("SIGTERM", () => {})
process.on("SIGINT", () => {})

let releaseRequested = false
let resultDelivered = false
const releaseIfReady = () => {
  if (releaseRequested && resultDelivered) process.exit(0)
}
process.on("message", (message: unknown) => {
  if (isRecord(message) && message.type === "release") {
    releaseRequested = true
    releaseIfReady()
  }
})
process.on("disconnect", () => {
  try { process.kill(-process.pid, "SIGKILL") }
  catch { process.exit(1) }
})

const target = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: stdioMode,
})
let settled = false
const report = (result: { code: number | null; signal: NodeJS.Signals | null; error?: string }) => {
  if (settled) return
  settled = true
  if (!process.send) process.exit(1)
  process.send({ type: "result", ...result }, () => {
    resultDelivered = true
    releaseIfReady()
  })
}
target.once("error", (error) => report({ code: 1, signal: null, error: error.message }))
target.once("close", (code, signal) => report({ code, signal }))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

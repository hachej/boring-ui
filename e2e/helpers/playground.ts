import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BOOT_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 200
const EXIT_TIMEOUT_MS = 5_000

export interface PlaygroundServer {
  url: string
  port: number
  stop(): Promise<void>
}

function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate port")))
        return
      }
      const { port } = address
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

export async function startPlayground(): Promise<PlaygroundServer> {
  const port = await findOpenPort()
  const playgroundDir = path.resolve(__dirname, "../../apps/workspace-playground")

  const child: ChildProcess = spawn(
    "npx",
    ["vite", "--port", String(port), "--strictPort"],
    {
      cwd: playgroundDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )

  const startedAt = Date.now()
  while (Date.now() - startedAt < BOOT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`playground exited before ready (code=${child.exitCode})`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`)
      if (res.ok) {
        return {
          url: `http://127.0.0.1:${port}`,
          port,
          async stop() {
            if (child.exitCode !== null) return
            child.kill("SIGTERM")
            await new Promise<void>((resolve) => {
              const timeout = setTimeout(() => {
                child.kill("SIGKILL")
                resolve()
              }, EXIT_TIMEOUT_MS)
              child.once("exit", () => {
                clearTimeout(timeout)
                resolve()
              })
            })
          },
        }
      }
    } catch {
      // Not ready yet
    }
    await sleep(POLL_INTERVAL_MS)
  }

  child.kill("SIGTERM")
  throw new Error(`playground did not start within ${BOOT_TIMEOUT_MS}ms`)
}

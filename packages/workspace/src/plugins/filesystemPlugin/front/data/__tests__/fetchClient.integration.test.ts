// @vitest-environment node
//
// In-process integration test: real Fastify (from @hachej/boring-agent),
// real FetchClient, real network. The unit tests in fetchClient.test.ts mock
// `fetch` and can only verify URL/method/body shape — they can't catch
// Fastify-parser disagreements with the request. This test fills that gap.
//
// History: a DELETE was shipping with `Content-Type: application/json` + no
// body, which Fastify's default JSON parser rejects with
// FST_ERR_CTP_EMPTY_JSON_BODY → 400. The unit test asserted URL + method
// only and missed it. This file would have caught it on first run.
import Fastify, { type FastifyInstance } from "fastify"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createNodeWorkspace } from "@hachej/boring-sandbox/providers"
import { fileRoutes } from "@hachej/boring-agent/server"
import { FetchClient, FileConflictError } from "../fetchClient"

let app: FastifyInstance
let workspaceRoot: string
let client: FetchClient
let baseUrl: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "boring-fetchclient-int-"))
  const workspace = createNodeWorkspace(workspaceRoot)
  app = Fastify({ logger: false })
  await app.register(fileRoutes, { workspace })
  await app.ready()
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" })
  client = new FetchClient({ apiBaseUrl: baseUrl, maxRetries: 0 })
})

afterEach(async () => {
  await app.close()
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe("FetchClient ↔ agent file routes (in-process integration)", () => {
  // --- the regression that motivated this whole file ---
  it("deleteFile does not 400 because of Content-Type on a body-less request", async () => {
    await writeFile(join(workspaceRoot, "doomed.txt"), "x")
    await expect(client.deleteFile("doomed.txt")).resolves.toBeUndefined()
  })

  // --- core CRUD round-trip ---
  it("writeFile + readFile round-trip preserves content + mtimeMs", async () => {
    const writeResult = await client.writeFile("hello.txt", "world")
    expect(typeof writeResult.mtimeMs).toBe("number")
    const read = await client.getFile("hello.txt")
    expect(read.content).toBe("world")
    expect(read.mtimeMs).toBe(writeResult.mtimeMs)
  })

  it("writeFile with expectedMtimeMs mismatch surfaces as FileConflictError with currentMtimeMs", async () => {
    const first = await client.writeFile("conflict.txt", "v1")
    await client.writeFile("conflict.txt", "v2") // server moves forward
    await expect(
      client.writeFile("conflict.txt", "v3", { expectedMtimeMs: first.mtimeMs }),
    ).rejects.toBeInstanceOf(FileConflictError)
  })

  it("readFile on a non-existent path returns a structured 404 error", async () => {
    await expect(client.getFile("missing.txt")).rejects.toMatchObject({
      status: 404,
    })
  })

  // --- path validation: server enforces relative-only ---
  it("rejects absolute paths with 403 (sandbox bound)", async () => {
    await expect(
      client.getFile("/etc/passwd"),
    ).rejects.toMatchObject({ status: 403 })
  })

  // --- delete edge cases ---
  it("deleteFile on a missing path returns 404 (not 400)", async () => {
    await expect(client.deleteFile("nope.txt")).rejects.toMatchObject({
      status: 404,
    })
  })

  // (Wire-level header assertions live in fetchClient.test.ts where we can
  // intercept the fetch call directly. The DELETE test above already proves
  // the round-trip works against a real Fastify — that's what this file
  // exists for; the unit test alone couldn't see FST_ERR_CTP_EMPTY_JSON_BODY.)

  // --- mkdir / move / search ---
  it("createDir + writeFile inside it round-trips", async () => {
    await client.createDir("subdir")
    await client.writeFile("subdir/a.txt", "a")
    const read = await client.getFile("subdir/a.txt")
    expect(read.content).toBe("a")
  })

  it("moveFile renames atomically", async () => {
    await client.writeFile("before.txt", "x")
    await client.moveFile("before.txt", "after.txt")
    await expect(client.getFile("before.txt")).rejects.toMatchObject({ status: 404 })
    const moved = await client.getFile("after.txt")
    expect(moved.content).toBe("x")
  })

  it("stat returns kind + mtimeMs for an existing file", async () => {
    await client.writeFile("stat-me.txt", "x")
    const stat = await client.stat("stat-me.txt")
    expect(stat.kind).toBe("file")
    expect(typeof stat.mtimeMs).toBe("number")
  })
})

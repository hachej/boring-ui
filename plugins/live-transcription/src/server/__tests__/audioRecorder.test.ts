import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { LocalAudioRecorder } from "../audioRecorder"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("LocalAudioRecorder", () => {
  it("streams PCM into a finalized M4A without retaining the source", async () => {
    const root = await mkdtemp(join(tmpdir(), "boring-live-audio-"))
    roots.push(root)
    const recorder = new LocalAudioRecorder({
      directory: root,
      filename: "session.m4a",
      sampleRate: 24_000,
    })
    await recorder.start()
    await recorder.write(new Uint8Array(4_800))
    await recorder.write(new Uint8Array(4_800))
    await recorder.finalize()

    expect((await stat(join(root, "session.m4a"))).size).toBeGreaterThan(100)
    expect((await readFile(join(root, "session.m4a"))).subarray(4, 8).toString()).toBe("ftyp")
    await expect(stat(join(root, "session.m4a.partial.m4a"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects untrusted filenames", () => {
    expect(() => new LocalAudioRecorder({
      directory: "/tmp",
      filename: "../escape.m4a",
      sampleRate: 24_000,
    })).toThrow("filename is invalid")
  })
})

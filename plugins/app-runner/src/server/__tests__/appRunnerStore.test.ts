// @vitest-environment node

import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FileAppRunnerStore } from "../appRunnerStore"
import type { AppRunnerRecord } from "../../shared/types"

function record(version: number, updatedAt: string): AppRunnerRecord {
  return {
    appName: "guestbook",
    workspaceId: "default",
    kind: "app",
    version,
    sha: `sha-${version}`,
    url: "http://hub/w/default/guestbook/",
    updatedAt,
    toolManifest: { tools: [] },
  }
}

describe("FileAppRunnerStore", () => {
  it("normalizes legacy app-name keys and keeps the newest duplicate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "app-runner-store-"))
    const path = join(dir, "state.json")
    await writeFile(path, JSON.stringify({
      apps: {
        guestbook: record(1, "2026-01-01T00:00:00.000Z"),
        "default:guestbook:": record(2, "2026-01-02T00:00:00.000Z"),
      },
    }))

    const store = new FileAppRunnerStore(path)
    expect(await store.listApps()).toEqual([record(2, "2026-01-02T00:00:00.000Z")])

    await store.upsertApp(record(3, "2026-01-03T00:00:00.000Z"))
    const persisted = JSON.parse(await readFile(path, "utf8")) as { apps: Record<string, AppRunnerRecord> }
    expect(Object.keys(persisted.apps)).toEqual(["default:guestbook:"])
    expect(persisted.apps["default:guestbook:"]?.version).toBe(3)
  })
})

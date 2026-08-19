import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { catalogTools, makeCallTool } from "../src/catalog.js";
import { makeHarness } from "../src/harness.js";

const dirs = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

async function rigWith(tools, firstResponse) {
  const artifactDir = await mkdtemp(join(tmpdir(), "tool-catalog-test-"));
  dirs.push(artifactDir);
  return makeHarness({
    artifactDir, id: "test-session", tools, systemPrompt: "test",
    fauxResponses: [firstResponse, fauxAssistantMessage("done", { timestamp: 2 })],
  });
}

describe("tool identity", () => {
  test("direct calls emit beta_add identity", async () => {
    const rig = await rigWith(catalogTools.slice(0, 3),
      fauxAssistantMessage(fauxToolCall("beta_add", { a: 7, b: 5 }, { id: "direct-1" }), { stopReason: "toolUse", timestamp: 1 }));
    try {
      await rig.harness.prompt("add");
      expect(rig.exactToolHooks.map((event) => event.toolName)).toEqual(["beta_add", "beta_add"]);
      expect(rig.exactToolHooks[1].content[0].text).toBe('{"sum":12}');
    } finally { await rig.cleanup(); }
  });

  test("dispatcher emits only outer call_tool identity and nests the inner result", async () => {
    const rig = await rigWith([makeCallTool()],
      fauxAssistantMessage(fauxToolCall("call_tool", { name: "beta_add", args: { a: 7, b: 5 } }, { id: "outer-1" }), { stopReason: "toolUse", timestamp: 1 }));
    try {
      await rig.harness.prompt("dispatch");
      expect(rig.exactToolHooks.map((event) => event.toolName)).toEqual(["call_tool", "call_tool"]);
      expect(rig.exactToolHooks[1].details.dispatchedName).toBe("beta_add");
      expect(rig.exactToolHooks.some((event) => event.toolName === "beta_add")).toBe(false);
    } finally { await rig.cleanup(); }
  });
});

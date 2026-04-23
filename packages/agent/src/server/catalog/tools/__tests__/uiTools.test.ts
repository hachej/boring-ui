import { describe, it, expect } from "vitest";
import { createGetUiStateTool, createExecUiTool } from "../uiTools.js";
import { createInMemoryBridge } from "../../../ui-bridge/createInMemoryBridge.js";

const abortCtx = {
  abortSignal: new AbortController().signal,
  toolCallId: "tc-1",
};

describe("createGetUiStateTool", () => {
  it("returns empty object when no state set", async () => {
    const bridge = createInMemoryBridge();
    const tool = createGetUiStateTool(bridge);
    const result = await tool.execute({}, abortCtx);
    expect(JSON.parse(result.content[0].text)).toEqual({});
  });

  it("returns current UI state", async () => {
    const bridge = createInMemoryBridge();
    await bridge.setState({ openFiles: ["a.ts"], theme: "dark" });

    const tool = createGetUiStateTool(bridge);
    const result = await tool.execute({}, abortCtx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.openFiles).toEqual(["a.ts"]);
    expect(parsed.theme).toBe("dark");
  });

  it("has correct tool metadata", () => {
    const bridge = createInMemoryBridge();
    const tool = createGetUiStateTool(bridge);
    expect(tool.name).toBe("get_ui_state");
    expect(tool.description).toBeTruthy();
  });
});

describe("createExecUiTool", () => {
  it("dispatches command and returns seq", async () => {
    const bridge = createInMemoryBridge();
    const tool = createExecUiTool(bridge);

    const result = await tool.execute(
      { kind: "openFile", params: { path: "/a.ts" } },
      abortCtx,
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.seq).toBe(1);
    expect(parsed.status).toBe("ok");
  });

  it("seq increments across calls", async () => {
    const bridge = createInMemoryBridge();
    const tool = createExecUiTool(bridge);

    const r1 = await tool.execute(
      { kind: "openFile", params: { path: "/a.ts" } },
      abortCtx,
    );
    const r2 = await tool.execute(
      { kind: "showNotification", params: { msg: "hi" } },
      abortCtx,
    );

    expect(JSON.parse(r1.content[0].text).seq).toBe(1);
    expect(JSON.parse(r2.content[0].text).seq).toBe(2);
  });

  it("subscribers receive commands dispatched by exec_ui", async () => {
    const bridge = createInMemoryBridge();
    const tool = createExecUiTool(bridge);
    const received: Array<{ kind: string; seq: number }> = [];

    bridge.subscribeCommands((cmd) =>
      received.push({ kind: cmd.kind, seq: cmd.seq }),
    );

    await tool.execute(
      { kind: "navigateToLine", params: { file: "a.ts", line: 42 } },
      abortCtx,
    );

    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe("navigateToLine");
    expect(received[0].seq).toBe(1);
  });

  it("exec_ui seq matches subscriber seq", async () => {
    const bridge = createInMemoryBridge();
    const tool = createExecUiTool(bridge);
    let subscriberSeq = -1;
    bridge.subscribeCommands((cmd) => {
      subscriberSeq = cmd.seq;
    });

    const result = await tool.execute(
      { kind: "openFile", params: { path: "/b.ts" } },
      abortCtx,
    );
    const toolSeq = JSON.parse(result.content[0].text).seq;

    expect(toolSeq).toBe(subscriberSeq);
  });

  it("has correct tool metadata with enum", () => {
    const bridge = createInMemoryBridge();
    const tool = createExecUiTool(bridge);
    expect(tool.name).toBe("exec_ui");
    const kindProp = (tool.parameters as any).properties.kind;
    expect(kindProp.enum).toContain("openFile");
    expect(kindProp.enum).toContain("showNotification");
    expect(kindProp.enum).toContain("navigateToLine");
  });
});

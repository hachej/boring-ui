import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AgentHarness, Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { HostSessionStorage } from "./host-session-storage.js";

const clone = (value) => structuredClone(value);

export async function makeHarness({ artifactDir, id, tools, systemPrompt, fauxResponses }) {
  await mkdir(artifactDir, { recursive: true });
  const storage = await HostSessionStorage.create(join(artifactDir, `${id}.session.jsonl`), {
    id, createdAt: new Date().toISOString(),
  });
  const session = new Session(storage);
  let models;
  let model;
  if (fauxResponses) {
    const faux = fauxProvider();
    faux.setResponses(fauxResponses);
    models = createModels();
    models.setProvider(faux.provider);
    model = faux.getModel();
  } else {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required for live mode");
    models = builtinModels();
    model = models.getModel("google", "gemini-2.5-flash");
    if (!model) throw new Error("google/gemini-2.5-flash missing from pinned catalog");
  }
  const env = new NodeExecutionEnv({ cwd: process.cwd(), shellEnv: process.env });
  const harness = new AgentHarness({
    env, session, models, model, tools, thinkingLevel: "off", systemPrompt,
    streamOptions: { maxRetries: 1, timeoutMs: 60_000 },
  });
  const exactToolHooks = [];
  const runtimeToolEvents = [];
  const payloads = [];
  const assistantMessages = [];
  const wireRequests = [];
  const originalFetch = globalThis.fetch;
  if (!fauxResponses && process.env.MOCK_GOOGLE === "1") {
    globalThis.fetch = async (input, init = {}) => {
      const bodyText = typeof init.body === "string" ? init.body : String(init.body ?? "");
      wireRequests.push({
        url: String(input), method: init.method, body: JSON.parse(bodyText),
        serializedBodyBytes: Buffer.byteLength(bodyText),
      });
      const body = wireRequests.at(-1).body;
      const contents = body.contents ?? [];
      const allText = contents.flatMap((content) => content.parts ?? []).map((part) => part.text ?? "").join("\n");
      const lastParts = contents.at(-1)?.parts ?? [];
      const currentText = lastParts.map((part) => part.text ?? "").join("\n");
      const functionResponse = lastParts.find((part) => part.functionResponse)?.functionResponse;
      let part;
      if (functionResponse) {
        if (functionResponse.name === "search_tools") {
          const searchOutput = JSON.parse(functionResponse.response?.output ?? "{}");
          const target = searchOutput.matches?.[0]?.name;
          const argsByTarget = {
            weather_lookup: { city: "Oslo" }, inventory_check: { sku: "SKU-7" },
            sentiment_score: { text: "excellent" }, build_status: { buildId: "b-9" },
            queue_depth: { queue: "jobs" }, policy_evaluate: { subject: "alice" },
            project_progress: { project: "Apollo" }, risk_assess: { project: "Apollo" },
          };
          part = { functionCall: { name: "call_tool", args: { name: target, args: argsByTarget[target] ?? { project: "Apollo" } } } };
        } else {
          part = { text: "done" };
        }
      } else if (/do not call any tool/i.test(allText)) {
        part = { text: "OK" };
      } else {
        const names = ["beta_add", "weather_lookup", "inventory_check", "sentiment_score", "build_status", "queue_depth", "policy_evaluate", "project_progress", "risk_assess"];
        const target = currentText.includes("assesses project risk")
          ? "risk_assess"
          : (names.find((name) => currentText.includes(name)) ?? "beta_add");
        const argsByTarget = {
          beta_add: { a: 7, b: 5 }, weather_lookup: { city: "Oslo" }, inventory_check: { sku: "SKU-7" },
          sentiment_score: { text: "excellent" }, build_status: { buildId: "b-9" }, queue_depth: { queue: "jobs" },
          policy_evaluate: { subject: "alice" }, project_progress: { project: "Apollo" }, risk_assess: { project: "Apollo" },
        };
        if (currentText.includes("search_tools")) part = { functionCall: { name: "search_tools", args: { query: target } } };
        else if (currentText.includes("call_tool")) part = { functionCall: { name: "call_tool", args: { name: target, args: argsByTarget[target] } } };
        else part = { functionCall: { name: target, args: argsByTarget[target] } };
      }
      const chunk = { candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
        status: 200, headers: { "content-type": "text/event-stream" },
      });
    };
  }

  harness.on("tool_call", (event) => { exactToolHooks.push(clone(event)); });
  harness.on("tool_result", (event) => { exactToolHooks.push(clone(event)); });
  harness.on("before_provider_payload", (event) => {
    const payload = clone(event.payload);
    payloads.push({ payload, serializedBytes: Buffer.byteLength(JSON.stringify(payload)) });
  });
  harness.subscribe((event) => {
    if (["tool_execution_start", "tool_execution_update", "tool_execution_end"].includes(event.type)) {
      runtimeToolEvents.push(clone(event));
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      assistantMessages.push(clone(event.message));
    }
  });

  return {
    harness, storage, exactToolHooks, runtimeToolEvents, payloads, assistantMessages, wireRequests,
    async cleanup() { globalThis.fetch = originalFetch; await env.cleanup(); },
  };
}

export function compactReply(reply) {
  return {
    content: reply.content,
    usage: reply.usage,
    stopReason: reply.stopReason,
    errorMessage: reply.errorMessage,
    provider: reply.provider,
    model: reply.model,
  };
}

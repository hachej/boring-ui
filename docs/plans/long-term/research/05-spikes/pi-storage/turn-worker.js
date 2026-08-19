import { AgentHarness, Session } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { createModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { HostSessionStorage } from "./host-session-storage.js";

const [recordPath, turn, mode = "gemini"] = process.argv.slice(2);
if (!recordPath || !turn) throw new Error("usage: turn-worker.js RECORD_PATH TURN");
if (mode === "gemini" && !process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");

const metadata = { id: "host-session-1", createdAt: "2026-08-11T00:00:00.000Z" };
const storage = turn === "1"
  ? await HostSessionStorage.create(recordPath, metadata)
  : await HostSessionStorage.open(recordPath);
const session = new Session(storage);
let models;
let model;
if (mode === "faux") {
  const faux = fauxProvider();
  faux.setResponses([turn === "1"
    ? fauxAssistantMessage("STORED ORCHID-7319")
    : (context) => {
        const sawNonce = context.messages.some((message) =>
          message.content?.some?.((part) => part.type === "text" && part.text.includes("ORCHID-7319"))
        );
        return fauxAssistantMessage(sawNonce ? "ORCHID-7319" : "MISSING-HISTORY");
      }]);
  models = createModels();
  models.setProvider(faux.provider);
  model = faux.getModel();
} else {
  models = builtinModels();
  model = models.getModel("google", "gemini-2.5-flash");
  if (!model) throw new Error("google/gemini-2.5-flash is absent from pinned pi-ai catalog");
}

const env = new NodeExecutionEnv({ cwd: process.cwd(), shellEnv: process.env });
const harness = new AgentHarness({
  env,
  session,
  models,
  model,
  tools: [],
  thinkingLevel: "off",
  systemPrompt: "Answer briefly and exactly. This is a persistence test; do not use tools.",
});

const prompt = turn === "1"
  ? "Remember this exact nonce for our next conversation turn: ORCHID-7319. Reply with exactly: STORED ORCHID-7319"
  : "What exact nonce did I ask you to remember in the previous turn? Reply with exactly the nonce and nothing else.";
const reply = await harness.prompt(prompt);
const text = reply.content
  .filter((part) => part.type === "text")
  .map((part) => part.text)
  .join("");

console.log(JSON.stringify({
  pid: process.pid,
  turn,
  mode,
  text,
  stopReason: reply.stopReason,
  errorMessage: reply.errorMessage,
  entryCount: (await storage.getEntries()).length,
  leafId: await storage.getLeafId(),
}));
await env.cleanup();

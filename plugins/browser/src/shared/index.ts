export const BROWSER_PLUGIN_ID = "browser";
export const BROWSER_BASE_PATH = "/api/v1/browser";
export const BROWSER_TOOL_NAMES = Object.freeze([
  "browser_observe",
  "browser_act",
] as const);
export const IDLE_TTL_MS = 15 * 60_000;
export const ABSOLUTE_TTL_MS = 60 * 60_000;
export const MAX_ACTIONS = 20;
export const MAX_TEXT = 8_192;

export type BrowserOwner = "agent" | "human";
export type BrowserState =
  | "starting"
  | "agent-controlled"
  | "human-controlled"
  | "stopping"
  | "stopped"
  | "error";
export type BrowserTarget = Readonly<{ index: number }>;
export type BrowserAction =
  | Readonly<{ kind: "navigate"; url: string }>
  | Readonly<{ kind: "click"; target: BrowserTarget }>
  | Readonly<{ kind: "type"; target: BrowserTarget; text: string }>
  | Readonly<{ kind: "select"; target: BrowserTarget; value: string }>;
export type BrowserActionPlan = Readonly<{
  sessionId: string;
  controlEpoch: number;
  actions: readonly BrowserAction[];
}>;
export type BrowserObservation = Readonly<{
  origin?: string;
  title?: string;
  elements: readonly Readonly<{ index: number; role?: string; text?: string }>[];
}>;
export type BrowserSessionView = Readonly<{
  sessionId: string;
  state: BrowserState;
  owner?: BrowserOwner;
  controlEpoch: number;
  createdAt: string;
  expiresAt: string;
  view?: Readonly<{ url: string; grant: string; expiresAt: string }>;
  error?: string;
}>;

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid browser request");
  return input as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("browser request contains an unsupported field");
}
function text(value: unknown, name: string, max = 256): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new Error(`invalid ${name}`);
  return value;
}
function target(value: unknown): BrowserTarget {
  const item = record(value);
  exact(item, ["index"]);
  if (
    !Number.isInteger(item.index) ||
    (item.index as number) < 0 ||
    (item.index as number) > 10_000
  )
    throw new Error("invalid browser target");
  return Object.freeze({ index: item.index as number });
}
function publicUrl(value: unknown): string {
  const raw = text(value, "url", 2_048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid navigation URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("navigation URL must be credential-free HTTP(S)");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const octets = host.split(".").map(Number);
  const privateV4 =
    octets.length === 4 &&
    octets.every(
      (part) => Number.isInteger(part) && part >= 0 && part <= 255,
    ) &&
    (octets[0] === 0 ||
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) ||
      octets[0]! >= 224);
  const privateV6 =
    host === "::" ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    /^fe[89ab]/.test(host) ||
    host.startsWith("ff") ||
    host.startsWith("::ffff:");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    privateV4 ||
    privateV6
  )
    throw new Error("navigation destination is not public");
  return url.toString();
}
function freezeAction(value: unknown): BrowserAction {
  const item = record(value);
  switch (item.kind) {
    case "navigate":
      exact(item, ["kind", "url"]);
      return Object.freeze({ kind: "navigate", url: publicUrl(item.url) });
    case "click":
      exact(item, ["kind", "target"]);
      return Object.freeze({ kind: "click", target: target(item.target) });
    case "type":
      exact(item, ["kind", "target", "text"]);
      return Object.freeze({
        kind: "type",
        target: target(item.target),
        text: text(item.text, "text", MAX_TEXT),
      });
    case "select":
      exact(item, ["kind", "target", "value"]);
      return Object.freeze({
        kind: "select",
        target: target(item.target),
        value: text(item.value, "value", 1_024),
      });
    default:
      throw new Error("unsupported browser action");
  }
}
export function parseActionPlan(input: unknown): BrowserActionPlan {
  const item = record(input);
  exact(item, ["sessionId", "controlEpoch", "actions"]);
  const sessionId = text(item.sessionId, "sessionId");
  if (
    !Number.isSafeInteger(item.controlEpoch) ||
    (item.controlEpoch as number) < 0
  )
    throw new Error("invalid controlEpoch");
  if (
    !Array.isArray(item.actions) ||
    item.actions.length < 1 ||
    item.actions.length > MAX_ACTIONS
  )
    throw new Error("invalid actions");
  return Object.freeze({
    sessionId,
    controlEpoch: item.controlEpoch as number,
    actions: Object.freeze(item.actions.map(freezeAction)),
  });
}
export function canonicalPlan(plan: BrowserActionPlan): string {
  return JSON.stringify(plan);
}

// node scratch/host-probe-pi-mcp/probe/pi-mcp.mjs [--keep]
// Starts the stand-in door (:8801) and the caller (:8802) under `wrangler dev --local`, runs each piece of pi-mcp inside the caller's Workers
// bundle, prints one JSON block per piece, stops both processes by pid. Local only: no Cloudflare account, no secret, generated values.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../../../", import.meta.url).pathname, here = new URL("../", import.meta.url).pathname;
const wrangler = join(root, "node_modules/.bin/wrangler");
const state = mkdtempSync(join(tmpdir(), "probe-pi-mcp-"));
const procs = [];
const start = (name, dir, port) => {
  const p = spawn(wrangler, ["dev", "--local", "--config", join(here, dir, "wrangler.jsonc"), "--port", String(port), "--inspector-port", String(port + 100), "--persist-to", join(state, name), "--ip", "127.0.0.1"], {
    cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1", CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; p.stdout.on("data", (d) => (log += d)); p.stderr.on("data", (d) => (log += d));
  procs.push(p); return { p, log: () => log };
};
const stop = () => { for (const p of procs) try { p.kill("SIGTERM"); } catch {} };
process.on("exit", stop); process.on("SIGINT", () => { stop(); process.exit(130); });
const until = async (f, ms = 90000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) { try { const v = await f(); if (v) return v; } catch {} } return null; };

const door = start("door", "door", 8801), caller = start("caller", "caller", 8802);
const ready = await until(async () => (await fetch("http://127.0.0.1:8801/health")).ok && (await fetch("http://127.0.0.1:8802/")).ok);
if (!ready) { console.log("NOT READY\n--- door\n", door.log().slice(-2500), "\n--- caller\n", caller.log().slice(-2500)); stop(); process.exit(1); }
console.log("ready: door :8801, caller :8802");

const pieces = ["loaded", "client/asis", "client/protocolOption", "client/adapted", "discovery", "signin", "refresh401", "lock"];
for (const piece of pieces) {
  const r = await fetch(`http://127.0.0.1:8802/probe/${piece}?home=${piece.replace("/", "-")}`);
  const text = await r.text();
  console.log(`\n=== ${piece} (HTTP ${r.status})`);
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text.slice(0, 1500)); }
}
console.log("\n=== door stats", JSON.stringify(await (await fetch("http://127.0.0.1:8801/_stats")).json()));
stop();
await new Promise((r) => setTimeout(r, 800));
process.exit(0);

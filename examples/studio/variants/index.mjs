// A variant is infrastructure and nothing else. The agent, the scenarios and the UI are identical for every variant; a variant
// supplies only where tools execute, how it is reached, and whether it can run at all. Every *.mjs in this folder (except this
// file and files starting with `_`) is discovered; no shared file needs editing.
//
// A variant file default-exports `host => descriptor`, where host is { provider, context, directory, models, sqlite } and
//   descriptor = {
//     id, title, description, order?,
//     available: true | { reason },          // { reason } lists the variant as unavailable in the selector, with the reason
//     capabilities: ['workspace', 'shell', 'git', 'python', 'sandbox'],   // what its environment gives the agent, beyond the core (python: its shell has python3)
//     mcp?: { servers: [{ id, allow, readOnly?, transport() }] },   // MCP tools through Pi's client (../../shared/mcp-tools.mjs); off when absent
//     credits?: true,                        // messages are metered against the person's fictional credits (@hachej/boring-agent/metering)
//     selfEvolving?: true,                   // the agent keeps its own instructions, skills and tools in the workspace's `.agent/` (they run through `exec`)
//     open(): Promise<{
//       env,                 // the native Pi ExecutionEnv every tool call uses (Pi's own FileSystem/Shell contract)
//       root,                // the directory the workspace lives in; the browser always shows it as /workspace
//       cwd?,                // the agent's working directory (default root)
//       repository?,         // a @hachej/boring-files/git repository over that workspace, which switches on working_git
//       commit?(paths, message),   // commits seeded files (needs repository)
//       routes?(request, url),     // extra authenticated endpoints under /api/variant/ (the Git and Sandbox tabs read them)
//       persist?(), close?()
//     }>                     // called only when available
//   }
// `aws` runs only against the offline fake Code Interpreter (STUDIO_AWS=fake); its deployable recipe is examples/aws.
import { readdirSync } from 'node:fs';

export async function loadVariants(host, only) {
  const files = readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.mjs') && name !== 'index.mjs' && !name.startsWith('_')).sort();
  const loaded = [];
  for (const name of files) loaded.push(...[await (await import(new URL(name, import.meta.url))).default(host)].flat().filter(Boolean));
  const ids = loaded.map(variant => variant.id);
  if (new Set(ids).size !== ids.length) throw new Error('Variant ids must be unique');
  for (const variant of loaded) {
    if (!/^[a-z0-9-]+$/.test(variant.id) || !variant.title || !variant.description) throw new Error(`Variant ${variant.id} needs an id, a title and a description`);
    if (variant.available !== true && typeof variant.available?.reason !== 'string') throw new Error(`Variant ${variant.id}: available is true or { reason }`);
  }
  // `only` limits which variants may open (a journey or a test that wants one); the rest are listed as unavailable.
  const kept = loaded.map(variant => only && !only.includes(variant.id) && variant.available === true ? { ...variant, available: { reason: 'Not enabled in this run.' } } : variant);
  return kept.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
}

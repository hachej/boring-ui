# pi-for-excel extensibility notes (GPT-5.5 spike findings, 2026-07-04)

> Provenance: GPT-5.5 answers grounded in the pi-for-excel clone at its 2026-07-04 HEAD; file:line references are into that repo. Reconstructed from the session transcript after the original scratchpad file was lost to a /tmp cleanup.

pi-for-excel is meaningfully extensible without forking. The public extension surface is a single-file JS/TS ES module loaded at runtime — not a full npm/plugin manifest system.

1. Custom tools: an extension exports `activate(api)`, then calls `api.registerTool(name, toolDef)`; tools use JSON-schema `parameters`, `execute`, optional `requiresConnection`, and cannot collide with built-ins or other extensions (docs/extensions.md:48, :77; src/extensions/runtime-manager.ts:650). Minimal example (docs/extensions.md:260):

```ts
export function activate(api) {
  api.registerTool("echo_text", {
    description: "Echo text back",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    async execute(params) {
      return { content: [{ type: "text", text: `Echo: ${params.text ?? ""}` }] };
    },
  });
}
```

2. MCP: built-in `mcp` gateway integration. Config via `/tools` / `/extensions -> Connections`, persisted as `mcp.servers.v1`; bearer tokens live in `connections.store.v1` record `builtin.mcp.servers` (docs/integrations-external-tools.md:23). Transport is HTTP JSON-RPC POST to configured HTTP(S) URLs; URL validation accepts only `http://`/`https://` — no stdio/SSE transport (docs/integrations-external-tools.md:45; src/tools/mcp-config.ts:67; src/tools/mcp.ts:322).

3. Prompt/skills/commands: no "replace the main system prompt" API; customization is persistent rules/instructions injected into the prompt, active integration guidance, skill listings, and extension-side `llm.complete({ systemPrompt })` for side calls (src/prompt/system-prompt.ts:38, :64; src/commands/extension-api-types.ts:122). Skills are standard `SKILL.md` with install/read/list/uninstall and workspace discovery at `skills/external/<name>/SKILL.md` and `skills/<name>/SKILL.md` (docs/agent-skills-interop.md:31). Slash commands are first-class via `api.registerCommand` (src/commands/extension-api-types.ts:197).

4. Trust/sandbox: inline code and remote-URL extensions run in an iframe sandbox by default; built-in/local modules stay host-side (docs/extensions.md:327). Remote HTTP(S) extension URLs are blocked by default and require `/experimental on remote-extension-urls` / localStorage opt-in (docs/extensions.md:34; src/commands/extension-api.ts:791). Capabilities are explicit toggles; permission gates can deny calls; high-risk install/enable prompts are shown; untrusted defaults deny tool registration/http/LLM/secrets unless granted (docs/extensions.md:304; src/extensions/permissions.ts:168). Extension HTTP is mediated and blocks local/private targets (src/extensions/runtime-manager.ts:456).

5. Private team packaging: ship a reviewed single-file ES module. Lowest friction: distribute code and install via `/extensions` or `extensions_manager install_code`; update by replacing same name (src/tools/extensions-manager.ts:31). For centralized updates, host the module at a private HTTPS URL, have users explicitly enable remote URLs, then install from URL (src/extensions/runtime-manager.ts:339). For secrets, package a connection definition and use host-injected auth with `allowedHosts`, not chat-pasted keys (docs/extensions-secure-connection-bundle.md:13).

# Declarative agent authoring

An authored agent directory describes identity, safe display metadata, and
instructions. It does not select executable behavior.

```text
my-agent/
├── agent.json
└── instructions.md
```

```json
{
  "schemaVersion": 1,
  "definitionId": "claims-assistant",
  "version": "2026.07.20",
  "label": "Claims assistant",
  "description": "Helps process insurance claims.",
  "instructionsRef": "instructions.md"
}
```

`label` and `description` are optional. Labels are limited to 128 characters;
descriptions are limited to 1,024 characters. Both must be trimmed, valid
Unicode without control or bidi-spoofing characters.

The loader:

- reads only `agent.json` and `instructions.md`;
- requires regular, non-symlink files contained in the directory;
- limits the manifest to 64 KiB and instructions to 256 KiB before decoding;
- requires valid UTF-8 and non-whitespace instructions;
- returns a frozen `AuthoredAgentSourceV1` from
  `materializeAgentDirectory()` containing only identity, metadata, and
  instructions.

## Executable behavior belongs to trusted host policy

Tools, capabilities, skills, MCP servers, packages, models, credentials,
plugins, runtime modes, and Workspace roots are configured by trusted host and
plugin code. Authored JSON cannot enable them.

Legacy manifests may still contain these keys while being cleaned up:

- `capabilityRequirements`
- `toolRefs`
- `skillRefs`
- `mcpServerRefs`

Absent or empty arrays are accepted and stripped. A non-empty array fails with
`AUTHORED_AGENT_REFERENCE_UNSUPPORTED`; move the requested behavior to trusted
host/plugin configuration.

The removed server contracts are `AuthoredAgentToolCatalog`,
`MaterializeAgentDirectoryInput.toolCatalog`, and the materialized `tools` and
`declaredToolRefs` fields. This correction removes no HTTP or product endpoint.

## Validation

```bash
boring-ui agent validate ./my-agent
boring-ui agent validate ./my-agent --json
```

Success reports only identity, optional metadata, and instruction byte length.
It never reports or resolves a tool catalog. Errors are field-specific and
redacted; unexpected failures return `INTERNAL_ERROR` without local paths or
secret-like source values.

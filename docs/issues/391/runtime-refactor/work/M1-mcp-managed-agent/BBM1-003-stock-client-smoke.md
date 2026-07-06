# BBM1-003 Stock-Client Smoke

Scope: M1 delivery v0 only. This proves `delegate_task_start` -> `delegate_task_status` progress -> completed result with a workspace-relative artifact reference that resolves on disk. It does not prove share URLs; BBM1-004 owns that gated slice.

## Command

```bash
pnpm --filter full-app smoke:mcp-managed-agent
```

The smoke boots the full-app managed-agent MCP route on a free local port with the same route registration used by full-app, then connects with the stock MCP TypeScript SDK Streamable HTTP client:

- Client: `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport`
- Endpoint shape: `http://127.0.0.1:<port>/mcp/managed-agent`
- Auth shape: `Authorization: Bearer [redacted]`
- Build prerequisite: the package script first runs `pnpm --filter @hachej/boring-agent... --workspace-concurrency=4 run build` so package exports resolve from a clean checkout.

The script uses the repo's fake-agent harness path instead of a live model key. It still exercises the full-app route, bearer auth, Streamable HTTP MCP transport, delegation start, status polling, result payload, and artifact path resolution under a temp workspace root.

## Proof Transcript

Run on 2026-07-06 from branch `bclaw/391-m1-pr3`:

```text
BBM1-003 MCP managed-agent smoke: PASS
client: @modelcontextprotocol/sdk 1.29.0 StreamableHTTPClientTransport
url_shape: http://127.0.0.1:<port>/mcp/managed-agent
auth: Bearer [redacted]
delegate_task_start: delegationId=<uuid> status=running
progress_poll: status=running eventCount=1 messages=["Agent session accepted for delegated task.","Agent turn started."]
result: status=completed finalAssistantText="Final answer for the representative outreach-demo brief." deliveryRule="M1 delivery v0: delegate_task returns final assistant text and workspace-relative artifact references only; share-link delivery is gated on PR #424."
artifact_ref: artifacts/mcp-managed-agent/session-1/outreach-demo.md
artifact_resolved: /tmp/full-app-mcp-managed-agent-smoke-workspaces-<suffix>/m1-smoke-workspace/artifacts/mcp-managed-agent/session-1/outreach-demo.md
agent_starts: 1
```

# LinkedIn Inbox — Single-Account Server Connector Plan

## Status

- Plan state: `ready-for-agent` for Slice 1 only.
- Tracking issue: [#1346](https://github.com/hachej/boring-ui/issues/1346).
- Target: one internal LinkedIn account owned by Julien; not a public multi-tenant connector.
- Deployment: Boring and the connector run on Server A; only the connector exits through a selected Tailscale node on Server B.
- Connector foundation: [`stickerdaniel/linkedin-mcp-server`](https://github.com/stickerdaniel/linkedin-mcp-server), Apache-2.0.
- Safety posture: read-oriented, low-frequency synchronization; final sends remain explicit human actions.

## Problem

A hosted Boring plugin cannot import cookies from the user's laptop. It needs a server-side LinkedIn session to display conversations and project real replies into workflow CRM state. The session must use a stable network identity without routing every workload on Server A through that identity.

Mass lead generation is a separate concern. This connector must never perform bulk people search, enrichment, invitations, or outreach automation.

## V1 outcome

A single user can:

1. open a temporary, authenticated browser-viewer URL;
2. sign into the real LinkedIn page and complete MFA or checkpoints;
3. persist the resulting server-side browser session privately;
4. refresh the LinkedIn inbox from Boring;
5. inspect a thread and match it to a workflow/contact;
6. draft a reply and open the native LinkedIn thread for final sending.

V1 does not send, poll continuously, generate leads, or support a second LinkedIn account.

## Architecture

```txt
Browser
  -> Boring LinkedIn inbox panel
      -> trusted Boring server plugin
          -> private MCP endpoint on Server A
              -> linkedin-mcp container
                  -> Tailscale sidecar network namespace
                      -> selected exit node on Server B
                          -> LinkedIn
```

Only `linkedin-mcp` shares the Tailscale sidecar network namespace. Boring, the database, agents, and other containers retain Server A's normal route.

## Boring plugin shape

This is a trusted app/internal plugin because it needs boot-time server routes and an MCP client:

```txt
plugins/linkedin-inbox/
  package.json
  src/
    front/
      index.tsx
      LinkedInInboxPanel.tsx
      LinkedInThreadPanel.tsx
    server/
      index.ts
      connector-client.ts
      routes.ts
      projection.ts
    shared/
      schemas.ts
      types.ts
```

The front plugin contributes an inbox source/panel and stable thread surface. The server plugin owns connector calls and CRM projection. Browser code never receives connector credentials or LinkedIn cookies.

## Connector boundary

Keep the provider behind a narrow interface so the inbox UI does not depend on MCP payload details:

```ts
interface LinkedInInboxConnector {
  getStatus(): Promise<LinkedInConnectionStatus>;
  listThreads(input: { limit: number }): Promise<LinkedInThreadSummary[]>;
  getThread(input: { externalThreadId: string }): Promise<LinkedInThread>;
  refresh(): Promise<LinkedInRefreshResult>;
  disconnect(): Promise<void>;
}
```

There is deliberately no send method in Slice 1.

## Authentication flow

### One-time login

Only one connector process may mount/use the browser profile at a time. Stop the long-running MCP service before login or reconnect, leave the Tailscale sidecar running, and restart the service only after the login container exits successfully:

```bash
docker compose stop linkedin-mcp

docker run -it --rm \
  --network container:linkedin-tailscale \
  -v linkedin-mcp-profile:/home/pwuser/.linkedin-mcp \
  stickerdaniel/linkedin-mcp-server:latest \
  --login --login-viewer

docker compose start linkedin-mcp
```

The deployment runbook must resolve the Compose-prefixed physical volume name rather than assume the illustrative `linkedin-mcp-profile` name. It must also verify that no other host/container process is using that profile before launching the login container. The viewer must remain private. Bind or proxy its port only to loopback, then reach it through an SSH tunnel or the tailnet. Never publish the viewer directly to the internet.

The user signs into `linkedin.com` inside the remote browser and handles password, MFA, CAPTCHA, or mobile confirmation there. Boring does not render a password form and does not store a password.

### Persisted session

The resulting profile lives in a dedicated volume with one-account ownership. Treat it as a password-equivalent secret:

- no workspace mount;
- no agent access;
- no logs, traces, snapshots, or support bundles containing it;
- host permissions restricted to the connector operator;
- encrypted host backup only if recovery is required;
- deletion is the disconnect operation.

## Selective Tailscale egress

### Server B

Server B advertises an exit node and is approved in the Tailscale admin console. Tailnet policy grants only the connector identity/tag permission to use `autogroup:internet`.

```bash
sudo tailscale set --advertise-exit-node
```

### Server A Compose shape

```yaml
services:
  linkedin-tailscale:
    image: tailscale/tailscale:latest
    hostname: linkedin-connector
    environment:
      TS_AUTHKEY: ${TS_AUTHKEY}
      TS_STATE_DIR: /var/lib/tailscale
      TS_EXTRA_ARGS: >-
        --advertise-tags=tag:linkedin
        --exit-node=server-b
    volumes:
      - linkedin-tailscale-state:/var/lib/tailscale
    devices:
      - /dev/net/tun:/dev/net/tun
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    ports:
      - "127.0.0.1:8000:8000"
      - "127.0.0.1:6080:6080"
    restart: unless-stopped

  linkedin-mcp:
    image: stickerdaniel/linkedin-mcp-server:latest
    network_mode: service:linkedin-tailscale
    depends_on:
      - linkedin-tailscale
    volumes:
      - linkedin-mcp-profile:/home/pwuser/.linkedin-mcp
    command:
      - --transport
      - streamable-http
      - --host
      - 0.0.0.0
      - --port
      - "8000"
    restart: unless-stopped

volumes:
  linkedin-tailscale-state:
  linkedin-mcp-profile:
```

Production deployment may place Boring and the connector on a private Docker network instead of publishing `8000` to host loopback. The upstream MCP HTTP transport has no authentication and must never be internet-accessible.

The Tailscale registration secret is bootstrap-only once state is persisted. Do not commit it; remove it from deployment environment after registration where operationally possible.

### Egress verification gate

Before LinkedIn login, prove selective routing:

```bash
# Server A host: expected Server A public IP
curl https://ifconfig.me

# Connector namespace: expected Server B public IP
docker run --rm \
  --network container:linkedin-tailscale \
  curlimages/curl:latest \
  https://ifconfig.me
```

Login is blocked until these addresses differ as expected. Changing the exit node after authentication is an explicit reconnect event, not routine configuration.

## Data projection

The connector is not the CRM source of truth. It supplies external observations that project into canonical records:

```txt
LinkedIn profile URL
  -> canonical contact
      -> workflow opportunity
          -> append-only interaction
```

Store opaque local IDs and provider IDs server-side. The initial interaction projection needs:

```txt
external_message_id
external_thread_id
contact_id | unmatched
workflow_opportunity_id | unmatched
direction
sent_at
body
source = linkedin
synced_at
```

Inbound messages may move an already-contacted opportunity to `replied`. Unmatched threads remain visible for explicit human matching; the plugin must not infer a workflow from message text and silently mutate CRM state.

## UX

### Disconnected

```txt
LinkedIn inbox
Server connector is not authenticated.
[Show operator connection instructions]
```

### Connected

```txt
LinkedIn inbox                       [Refresh]
Last refreshed 12 minutes ago

Unread | All | Unmatched
---------------------------------------------
Jane Example        Re: invoice exceptions
Pierre Example      Thanks, Friday works
```

### Thread

```txt
Jane Example · Controller · Example SA
Workflow: Invoice/AP exception resolution

[message history]

[Draft response] [Open in LinkedIn]
```

`Open in LinkedIn` is the V1 completion path. No agent or scheduled task can send.

## Failure and reconnect states

Use explicit states:

```txt
disconnected
connecting
connected
checkpoint_required
session_expired
connector_unavailable
```

A session failure must not trigger repeated login attempts. Show an operator action to launch the private login viewer again using the same stop-login-start sequence above. Boring must report the inbox unavailable while the normal service is stopped. Disconnect stops all profile users before deleting the persisted connector profile after explicit confirmation.

## Slices

### Slice 1 — one-account connection and read tracer bullet

Deliver:

- trusted package-plugin skeleton;
- server-only connector client;
- connection-status route;
- private deployment example for MCP + Tailscale sidecar;
- manual authentication runbook;
- selective-egress verification command;
- one read-only `listThreads` tracer call;
- fixture-backed UI when a live connector is unavailable in tests.

Verify:

1. Server A host and connector namespace show different expected public IPs.
2. Login viewer is unreachable from the public internet.
3. A restart preserves the authenticated session.
4. Boring lists recent thread summaries without exposing cookies to the browser.
5. Existing plugin invariant, typecheck, and focused tests pass.

### Slice 2 — thread inspection and workflow matching

Deliver:

- thread panel and stable surface target;
- normalized thread/message schema;
- explicit contact/workflow match action;
- idempotent append-only interaction projection;
- unmatched queue.

Verify duplicate refreshes do not duplicate interactions and no inferred match mutates CRM state.

### Slice 3 — draft and native-send handoff

Deliver:

- evidence-bound reply drafting;
- explicit `Open in LinkedIn` action;
- follow-up task creation;
- no connector send capability.

Verify an agent can draft but cannot transmit a LinkedIn message.

## Non-goals

- mass lead generation or people scraping;
- Sales Navigator automation;
- automated invitations or messages;
- autonomous replies;
- multi-account or multi-tenant hosted auth;
- public MCP endpoint;
- replacing LGM campaign execution;
- claiming protection from LinkedIn restrictions;
- generic connector platform work.

## Risks and mitigations

### Unofficial LinkedIn integration

The upstream connector uses a logged-in browser/private LinkedIn behavior and is not an approved LinkedIn integration. Keep volume low, sends manual, and account ownership explicit. There is no zero-ban guarantee.

### Network identity change

The server-side browser appears from Server B. Select the stable exit node before login and keep it fixed. Avoid rotating or commercial proxy pools.

### Secret-equivalent session profile

Isolate the volume, exclude it from workspaces/backups by default, and never expose the raw MCP endpoint publicly.

### Upstream breakage

Pin a tested image digest in deployment after the tracer bullet. Upgrade intentionally when LinkedIn changes require it; do not silently auto-upgrade the production connector.

### Existing LGM session

Do not run aggressive LinkedIn activity from LGM and this connector concurrently. During the tracer bullet, the new connector performs explicit reads only.

## Release gate

Slice 1 may ship internally only when:

- egress is proven to use the selected exit node;
- viewer and MCP endpoints are private;
- session persistence survives restart;
- cookie/profile material never reaches front-end payloads or logs;
- the connector cannot send;
- the plan's focused tests and repository plugin invariants pass.

Any proposal to add multi-tenancy, autonomous sends, or lead generation requires a separate issue and threat model.

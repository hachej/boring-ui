# Mastra

## Bottom line

- Snapshot: 2026-08-10. Mastra has a real, pluggable resource-check interface and several automatic runtime enforcement points. Its built-in WorkOS implementation is hierarchical, resource-scoped RBAC with inherited permissions. It is not documented as Zanzibar-style tuple-based ReBAC.
- A custom `IFGAProvider` could call a Zanzibar-style backend, but Mastra does not supply that model itself. The feature is optional. If `server.fga` is absent, all FGA checks are skipped. Production use requires Mastra Enterprise Edition.
- The strongest parts are per-agent, per-tool, per-thread, per-workflow checks at framework entry points. The weakest parts are uncovered workflow-run SDK methods, optional route coverage, trusted-system-actor bypass, and ambient authority inside tool code. Verdict: real authorization integration, not merely an API-key wrapper; not a structurally non-bypassable execution authority system. Primary Mastra reference: [Fine-Grained Authorization](https://mastra.ai/docs/server/auth/fga).
- WorkOS model references: [FGA API](https://workos.com/docs/reference/fga), [roles and permissions](https://workos.com/docs/fga/roles-and-permissions), [resources](https://workos.com/docs/fga/resources), [OpenFGA migration](https://workos.com/docs/fga/migration-openfga).

## 1. Exact authorization model

### Mastra-facing abstraction

- The policy question is `can user perform permission on resource?`. Subject passed to the provider: `user: any`. Object passed to the provider: a typed resource descriptor inside `FGACheckParams`. Verb passed to the provider: a Mastra permission string or provider-mapped permission.
- The provider contract is Boolean check, throwing require, and accessible-list filtering. Documented shape:

```ts
import { FGADeniedError } from '@mastra/core/auth/ee'
import type {
  FGACheckParams,
  IFGAProvider,
  MastraFGAPermissionInput,
} from '@mastra/core/auth/ee'

class MyFGAProvider implements IFGAProvider {
  async check(user: any, params: FGACheckParams): Promise<boolean> {
    return true
  }

  async require(user: any, params: FGACheckParams): Promise<void> {
    const allowed = await this.check(user, params)
    if (!allowed) {
      throw new FGADeniedError(
        user,
        params.resource,
        params.permission,
      )
    }
  }

  async filterAccessible<T extends { id: string }>(
    user: any,
    resources: T[],
    resourceType: string,
    permission: MastraFGAPermissionInput,
  ): Promise<T[]> {
    return resources
  }
}
```

- Source: [Mastra FGA custom provider](https://mastra.ai/docs/server/auth/fga#custom-fga-provider). `check()` is a policy decision point interface. `require()` is a deny-by-exception interface. `filterAccessible()` is a list post-filter interface.
- Mastra does not prescribe role storage, tuple storage, or policy language through this interface. Therefore the abstract model is provider-neutral resource/permission authorization. Calling the abstraction itself RBAC, ABAC, or ReBAC is inaccurate. The concrete provider determines that classification.

### Built-in WorkOS provider

- Concrete class: `MastraFGAWorkos` from `@mastra/auth-workos`. Authentication class: `MastraAuthWorkos`. FGA checks require WorkOS organization memberships. `fetchMemberships: true` loads those memberships during authentication.
- Mastra says the WorkOS check resolves the correct organization membership ID. Exact integrated configuration:

```ts
import { Mastra } from '@mastra/core/mastra'
import { MastraFGAPermissions } from '@mastra/core/auth/ee'
import {
  MastraAuthWorkos,
  MastraFGAWorkos,
} from '@mastra/auth-workos'

const mastra = new Mastra({
  server: {
    auth: new MastraAuthWorkos({
      fetchMemberships: true,
      mapUserToResourceId: user => user.teamId,
    }),
    fga: new MastraFGAWorkos({
      resourceMapping: {
        agent: {
          fgaResourceType: 'team',
          deriveId: ctx => ctx.user.teamId,
        },
        workflow: {
          fgaResourceType: 'team',
          deriveId: ctx => ctx.user.teamId,
        },
        thread: {
          fgaResourceType: 'workspace-thread',
          deriveId: ({ resourceId }) => resourceId,
        },
      },
      permissionMapping: {
        [MastraFGAPermissions.AGENTS_EXECUTE]: 'manage-workflows',
        [MastraFGAPermissions.WORKFLOWS_EXECUTE]: 'manage-workflows',
        [MastraFGAPermissions.MEMORY_READ]: 'read',
        [MastraFGAPermissions.MEMORY_WRITE]: 'update',
      },
    }),
    storedResources: {
      scope: true,
    },
  },
})
```

- Source: [Mastra FGA configuration](https://mastra.ai/docs/server/auth/fga#configuration). WorkOS subject: an organization membership, identified by `organizationMembershipId`. WorkOS object: a resource instance with resource type, external ID, organization, and parent. WorkOS verb: a permission slug such as `project:edit`.
- WorkOS grant: a role assignment connecting an organization membership to a role on a resource. WorkOS inheritance: permissions can flow from parent resource to descendants. WorkOS baseline: organization-scoped roles may also grant permissions. WorkOS evaluation checks:
  - Direct role assignments on the resource.
  - Inherited assignments from parent resources.
  - Organization-scoped roles containing the permission.
- WorkOS authorization request shape:

```http
POST /authorization/organization_memberships/om_01HXYZ/check
Authorization: Bearer sk_example_123456789
Content-Type: application/json

{
  "permission_slug": "project:edit",
  "resource_type_slug": "project",
  "resource_external_id": "project_02H"
}
```

- WorkOS response shape:

```json
{
  "authorized": true
}
```

- Source: [WorkOS FGA quick start](https://workos.com/docs/fga/quick-start#5-check-permissions). WorkOS assignment shape:

```http
POST /authorization/organization_memberships/om_01HXYZ/role_assignments
Authorization: Bearer sk_example_123456789
Content-Type: application/json

{
  "role_slug": "workspace-admin",
  "resource_type_slug": "workspace",
  "resource_external_id": "workspace_01H"
}
```

- Source: [WorkOS role assignments](https://workos.com/docs/fga/quick-start#4-assign-roles). WorkOS explicitly distinguishes itself from OpenFGA:
  - OpenFGA: relation-based access control with explicit tuples.
  - WorkOS FGA: hierarchical RBAC with automatic permission inheritance.
- Source: [WorkOS migration from OpenFGA](https://workos.com/docs/fga/migration-openfga). Classification: resource-scoped hierarchical RBAC. It has relationship-like parentage and membership edges. It is not a general Zanzibar userset/tuple/rewrite language on the documented API.
- It does not expose arbitrary `(subject, relation, object)` tuples in the shown Mastra API. It does not expose Zanzibar relation rewrites in the shown Mastra API. Mastra release language calling the feature “relationship-based” is broader than the documented WorkOS mechanism. Honest label: pluggable FGA facade; built-in provider is hierarchical RBAC/FGA.

### Resource and permission translation

- `resourceMapping` maps a Mastra resource type to provider type and ID. Mapping keys include `agent`, `workflow`, and `thread` in the documented example. `thread` is the preferred key for memory authorization. Legacy `memory` is still accepted by `MastraFGAWorkos`.
- `deriveId(ctx)` receives:
  - `user`.
  - `resourceId` when an owning Mastra resource ID exists.
  - `requestContext`.
  - provider/action `metadata`.
- Returning `undefined` falls back to the original Mastra resource ID. For memory checks, the checked resource remains raw `threadId`. The owning `resourceId` is additionally made available to `deriveId()`. This permits a tenant composite such as `userId-teamId-orgId`.
- Source: [resource mapping](https://mastra.ai/docs/server/auth/fga#resource-mapping). `permissionMapping` maps Mastra internal strings to provider permission slugs. If no mapping exists, Mastra passes the original permission string. `validatePermissions()` can fail startup when mappings are incomplete.
- Validation is opt-in. Source: [permission mapping](https://mastra.ai/docs/server/auth/fga#permission-mapping).

### Built-in verbs and objects

- Agent object:
  - Type: `agent`.
  - ID: `agentId`.
  - Verb: `agents:execute`.
- Workflow object:
  - Type: `workflow`.
  - ID: `workflowId`.
  - Verb: `workflows:execute`.
- Standalone tool object:
  - Type: `tool`.
  - ID: `toolName`.
  - Verb: `tools:execute`.
- Agent-bound tool object:
  - Type: `tool`.
  - ID: `${agentId}:${toolName}`.
  - Verb: `tools:execute`.
- MCP tool object:
  - Default type: `tool`.
  - Default ID: `JSON.stringify([serverName, toolName])`.
  - Verb: `tools:execute`.
  - Server-level mapping may override type and ID.
- Memory/thread object:
  - Type: `thread`.
  - ID: `threadId`.
  - Verbs: `memory:read`, `memory:write`, `memory:delete`.
- Stored resource object:
  - Type: stored resource type.
  - ID: record ID or collection scope.
  - Verb: route action’s stored-resource permission.
- Custom HTTP object:
  - Type: configured per route.
  - ID: configured per route.
  - Verb: configured per route.
- Source: [Mastra enforcement points](https://mastra.ai/docs/server/auth/fga#enforcement-points).

## 2. Granularity

- Per agent: yes. A check uses `agentId` unless mapped to another provider object. Per agent instance/configuration variant: UNVERIFIED. Per tool: yes.
- Standalone tools use `toolName`. Agent tools use a composite agent/tool identity. MCP tools use a server/tool composite identity by default. Per memory: yes at thread level.
- Per memory message: no documented check. Per memory vector row: no documented check. Per resource owner: mapping can use thread `resourceId`. Per workflow: yes at workflow execution boundary.
- Per workflow run: no independently documented FGA object. Per workflow node: no. Per step: no documented policy object or permission. Per internal agent call: core agent checks are documented.
- Per internal workflow tool call: tool checks are documented. Per HTTP route: yes when route FGA metadata resolves. Per stored agent/MCP client/prompt block/scorer/skill/workspace: built-in stored-resource routes are covered. Per end-user: yes when authentication resolves a user and provider subject.
- Per service principal: possible through trusted JWT claims. Per autonomous system agent: possible only with optional `requireActor()` hardening. Per API key/project only: no; WorkOS membership gives finer user/resource scope. Provider resource remapping can collapse apparent granularity.
- Example: every agent may map to `team:${user.teamId}`. In that configuration, policy is team-level, not truly per agent. Exact granularity is therefore the derived provider resource, not the Mastra registry object name.

## 3. Enforcement point

### Request and runtime boundaries

- Mastra checks when `server.fga` is configured. Missing authenticated user on a protected action is denied. Missing `server.fga` skips all FGA checks. Source: [Mastra FGA configuration](https://mastra.ai/docs/server/auth/fga#configuration).
- Agent `generate()` and `stream()` are checked. Built-in workflow HTTP execution routes are checked. `Workflow.execute()` is checked. Standalone tool execution is checked.
- Agent tool execution is checked. MCP `tools/list` and `tools/call` can be checked when user mapping is configured. Thread and memory operations are checked. Stored-resource routes are checked.
- HTTP resource routes with resolvable metadata are checked. Checks occur at these lifecycle calls, not only at login. Therefore agent and tool authorization is normally re-evaluated per protected invocation. A single login does not resolve a durable static capability in the documented design.
- Core checks receive `requestContext` and action metadata. Thread checks receive owning `resourceId` when available.

### Route middleware shape

```ts
import { createRoute } from '@mastra/server/server-adapter'

export const getProjectRoute = createRoute({
  method: 'GET',
  path: '/projects/:projectId',
  responseType: 'json',
  requiresAuth: true,
  fga: {
    resourceType: 'project',
    resourceIdParam: 'projectId',
    permission: 'projects:read',
  },
  handler: async () => ({ project: null }),
})
```

- Source: [route policy coverage](https://mastra.ai/docs/server/auth/fga#route-policy-coverage). Route checks are metadata-driven. A route is checked when:
  - route-level `fga` metadata exists; or
  - built-in metadata can be derived; or
  - provider `resolveRouteFGA()` returns metadata.
- Protected route does not necessarily mean FGA-covered route. `requiresAuth: true` is authentication, not sufficient proof of resource authorization. `requireForProtectedRoutes: true` denies protected routes that cannot resolve FGA metadata. This hardening is opt-in.
- `auditProtectedRoutes: 'warn'` warns about missing coverage. `auditProtectedRoutes: 'error'` fails startup. This audit is also configuration-dependent.

### Storage enforcement

- FGA itself does not automatically filter records in shared storage. Mastra explicitly documents that limitation. `storedResources.scope` is a separate row-scope mechanism. With `scope: true`:
  - `mapUserToResourceId()` sets `MASTRA_RESOURCE_ID_KEY`.
  - stored-resource handlers persist scope in metadata.
  - list/read/update/publish/delete filter by that scope.
- Exact custom scope shape:

```ts
storedResources: {
  scope: {
    metadataKey: 'teamId',
    resolve: ({ user }) => user.teamId,
    requireScope: true,
  },
}
```

- `requireScope: true`, or omission of the property, fails when scope cannot be resolved. Source: [stored resource scoping](https://mastra.ai/docs/server/auth/fga#stored-resource-scoping). This is application-layer metadata filtering, not documented database-native RLS. Physical database separation per tenant: UNVERIFIED.
- Cryptographic data separation per tenant: UNVERIFIED.

### Known gaps and bypasses

- `createRun().start()` is not independently checked by core FGA. `resume()` is not independently checked by core FGA. `restart()` is not independently checked by core FGA. Mastra instructs users to call them from a protected route or guard them in application code.
- Source: [enforcement points](https://mastra.ai/docs/server/auth/fga#enforcement-points). This is a documented bypass path for trusted application code. A custom route without FGA metadata can be authentication-only unless route-coverage hardening is enabled. A custom provider returning `true` makes the system allow-all.
- A tool can contain arbitrary application code. Mastra checks whether the tool may be invoked. Mastra does not document confinement of everything the tool implementation can access. If a tool holds a global database credential, it can query rows outside the authorized resource.
- If a tool holds a global SaaS token, it can call outside the authorized tenant. The FGA check cannot structurally prevent that ambient-authority bypass. It can only forbid entry to the tool invocation. Downstream row filtering inside arbitrary tool code: UNVERIFIED and not supplied by the FGA contract.

### MCP boundary

- OAuth-protected MCP transports put auth data in `extra.authInfo`. `mapAuthInfoToUser` must populate `requestContext.get('user')` before FGA. MCP server-level FGA mapping can differ from internal tool mapping. Exact surface:

```ts
new MCPServer({
  mapAuthInfoToUser: async ({ authInfo }) => resolveUser(authInfo),
  fga: {
    resourceMapping: {
      tool: {
        fgaResourceType: 'tenant-tool',
        deriveId: ({ user, resourceId }) =>
          `${user.teamId}:${resourceId}`,
      },
    },
    permissionMapping: {
      'tools:execute': 'tool:invoke',
    },
  },
})
```

- Source: [MCPServer reference](https://mastra.ai/reference/tools/mcp-server). Without correct user mapping, protected MCP FGA cannot evaluate the intended end user.

## 4. Multi-tenancy

- Mastra FGA is designed for multi-tenant B2B products. Mastra itself accepts arbitrary tenant resolution through `requestContext` and mapping callbacks. WorkOS supplies explicit Organizations. WorkOS documentation calls organizations application tenants.
- Source: [WorkOS standalone integration](https://workos.com/docs/fga/standalone-integration). WorkOS supplies organization memberships. A person may have memberships in multiple organizations. The FGA subject is the organization membership, not merely global user ID.
- Every WorkOS FGA resource belongs to an organization. Organization is the implicit root of the resource hierarchy. Every resource has a parent: organization or another resource. Source: [WorkOS resources](https://workos.com/docs/fga/resources).
- Membership plus organization-rooted resource IDs is a genuine tenant-aware authorization model. Cross-tenant access checks should fail if the membership and resource organization do not align. Exact WorkOS server-side isolation implementation: UNVERIFIED. Mastra must resolve the correct membership.
- `fetchMemberships: true` is required for the documented integration. Trusted JWT claims may supply:
  - `organizationId`.
  - `organizationMembershipId`.
  - tenant IDs.
  - service-principal identifiers.
- Exact configuration:

```ts
new MastraAuthWorkos({
  apiKey: process.env.WORKOS_API_KEY,
  clientId: process.env.WORKOS_CLIENT_ID,
  trustJwtClaims: true,
  jwtClaims: {
    organizationId: 'org_id',
    organizationMembershipId:
      'urn:mastra:organization_membership_id',
  },
})
```

- Source: [WorkOS authentication](https://mastra.ai/docs/server/auth/workos#service-tokens-and-custom-jwt-templates). Claims are accepted only after bearer-token verification in the documented flow. Tenant integrity still depends on correct issuer, template, and claim mapping. Built-in agent HTTP routes ignore client-supplied `organizationId` for trusted actors.
- Trusted actor path requires server-set `organizationId`. This is a useful anti-spoofing boundary. The trusted-actor tenant check only confirms an organization ID exists. It does not verify that `actor.agentId` belongs to that organization.
- Provider `requireActor()` must verify that relation when required. Source: [system actor trust requirements](https://mastra.ai/docs/server/auth/fga#trust-requirements).

## 5. Secrets and credentials

- Mastra WorkOS integration uses server-side `WORKOS_API_KEY` and `WORKOS_CLIENT_ID`. The access token sent by a client authenticates the user. Source: [Mastra WorkOS auth](https://mastra.ai/docs/server/auth/workos). The FGA API key is deployment/service-wide in the documented example.
- It is not a per-tenant WorkOS API key. Tenant selection comes from organization membership context. Per-tenant model-provider key vault tied to FGA: UNVERIFIED. Per-tenant tool credential vault tied to FGA: UNVERIFIED.
- Per-user BYO model keys tied to FGA: UNVERIFIED. Automatic tenant credential rotation: UNVERIFIED. Rotation API on the FGA surface: none documented. WorkOS key rotation is outside the Mastra FGA API shape.
- Mastra Cloud supports project environment variables in older deployment documentation. That is project/deployment scope, not documented tenant scope. Source: [Mastra Cloud deploying](https://mastra.ai/docs/mastra-cloud/deploying). Some separate Mastra integrations advertise encrypted credential storage.
- No documented API connects those credentials to `IFGAProvider` grants. Therefore they cannot be credited as FGA-enforced tenant credential custody. Honest answer: authentication/FGA context can select credentials in application code, but custody, BYO-key lifecycle, and rotation are not part of the documented authorization system.

## 6. Human-in-the-loop and authorization

- Mastra tools support `requireApproval: true`. Agents can pause before a tool call. Callers can approve or decline suspended tool calls. Example surface:

```ts
const deleteTool = createTool({
  id: 'delete-data',
  requireApproval: true,
  execute: async ({ context }) => deleteRecords(context),
})

const stream = await myAgent.stream('Delete old records')
await myAgent.approveToolCall({ runId: stream.runId })
await myAgent.declineToolCall({ runId: stream.runId })
```

- Source: [Mastra tool approval](https://mastra.ai/blog/tool-approval). Approval is a control-flow gate. Approval is not itself a role, relationship, permission, or FGA object in the documented API. A distinct `approvals:approve` permission is not documented.
- A policy mapping approver identity to the pending action is not documented. Whether `approveToolCall()` re-checks agent/tool FGA independently: UNVERIFIED. Whether only the original requester may approve: UNVERIFIED. Whether a tenant admin may approve another user’s run: UNVERIFIED.
- Whether approval identity is persisted in an audit record: UNVERIFIED. Workflow suspension/resumption is likewise a gate unless the resume route is separately authorized. Direct `resume()` is specifically not independently checked by core FGA. Therefore HITL must not be represented as authorization without application-side approver policy.

## 7. Tier and OSS omissions

- FGA is Mastra Enterprise Edition. Production requires a valid EE license. Development and testing can use EE source under the Mastra Enterprise License. Source: [Mastra FGA note](https://mastra.ai/docs/server/auth/fga).
- Repository licensing is dual:
  - Apache-2.0 for core framework and most code.
  - Mastra Enterprise License for directories named `ee/`.
- `packages/core/src/auth/ee/` is explicitly named as an EE example. Source: [Mastra repository licensing](https://github.com/mastra-ai/mastra#licensing). The imports prove the boundary:
  - `@mastra/core/auth/ee` for FGA types and permissions.
  - `MastraFGAWorkos` as an enterprise FGA integration.
- OSS authentication can still protect routes. Default `MastraAuthWorkos` authorization permits any authenticated WorkOS user having both Mastra and WorkOS user IDs. Source: [WorkOS default authorization](https://mastra.ai/docs/server/auth/workos#default-authorization). OSS/application code can override `authorizeUser()` for coarse custom checks.
- OSS/application code can write custom authorization manually. OSS does not ship the EE automatic agent/tool/workflow/thread FGA enforcement framework. OSS does not ship `IFGAProvider` from the Apache path. OSS does not ship the EE route FGA metadata enforcement described above.
- Authentication without FGA is not tenant authorization. No auth configured makes routes and Studio public by default. Source: [Mastra auth overview](https://mastra.ai/docs/server/auth).

## 8. Honest assessment

- This is more than a thin wrapper over API keys. Evidence:
  - End-user identity reaches policy checks.
  - WorkOS organization membership is a resource-scoped subject.
  - Agent, workflow, tool, MCP tool, and thread IDs are explicit objects.
  - Permissions are explicit verbs.
  - Checks occur at multiple runtime invocation boundaries.
  - Storage scoping can filter record operations.
  - Custom routes can carry declarative FGA metadata.
- It is not a complete non-bypassable authorization substrate. Evidence:
  - FGA is opt-in.
  - Route coverage fail-closed behavior is opt-in.
  - Shared storage is not automatically filtered by FGA.
  - Workflow run `start/resume/restart` SDK methods have documented gaps.
  - Tool implementation code retains ambient authority.
  - System actors bypass user-centric `require()` by default.
  - Per-agent least privilege for system actors requires optional provider code.
- `MastraFGAWorkos` is a meaningful policy-enforcement integration. Its built-in policy model is less expressive than a Zanzibar-style graph. Its runtime coverage is stronger than ordinary route-only RBAC. Its security is configuration-sensitive.
- Best concise verdict: real FGA integration with important bypass surfaces; not structural capability security.

# LangGraph Platform / LangSmith Deployment

## Bottom line

- “LangGraph Platform” is now documented under LangSmith Deployment / Agent Server. Two separate authorization systems must be distinguished. System A: LangSmith organization/workspace RBAC and ABAC for platform users and control-plane/data resources. System B: application-defined `Auth` handlers for end-user access to Agent Server resources.
- System A is genuine enterprise RBAC, plus tag-based ABAC. System B is a policy hook and metadata/namespace enforcement mechanism, not a supplied RBAC or Zanzibar engine. System B can implement per-user ownership, permission checks, or external FGA calls. System B does not automatically authorize graph nodes, model tool calls, or arbitrary external I/O.
- Verdict: real platform-user authorization plus a real enforcement hook for runtime resources; default end-user runtime security is largely API-key identity until the developer supplies policy. Primary runtime reference: [Authentication and access control](https://docs.langchain.com/langsmith/auth). Primary platform reference: [RBAC](https://docs.langchain.com/langsmith/rbac). Platform ABAC reference: [ABAC](https://docs.langchain.com/langsmith/abac).

## 1. Exact authorization model

### A. Agent Server custom auth

- Authentication runs as middleware on every request. Developer registers `@auth.authenticate`. Authentication returns a user dictionary. Minimum required identity field: `identity`.
- Optional fields include:
  - `is_authenticated`.
  - `permissions`.
  - `role`.
  - `org_id`.
  - arbitrary custom data.
- Exact shape:

```py
from langgraph_sdk import Auth

auth = Auth()

@auth.authenticate
async def authenticate(
    headers: dict,
) -> Auth.types.MinimalUserDict:
    api_key = headers.get(b"x-api-key")
    if not api_key or not is_valid_key(api_key):
        raise Auth.exceptions.HTTPException(
            status_code=401,
            detail="Invalid API key",
        )
    return {
        "identity": "user-123",
        "is_authenticated": True,
        "permissions": ["read", "write"],
        "role": "admin",
        "org_id": "org-456",
    }
```

- Source: [LangSmith auth](https://docs.langchain.com/langsmith/auth#authentication). Subject: `ctx.user`, principally `ctx.user.identity` plus arbitrary returned attributes. Subject permissions: `ctx.permissions` derived from returned user permissions. Objects supported by authorization handlers:
  - Threads.
  - Assistants.
  - Crons.
  - Store namespaces/items.
  - Runs through their parent thread.
- Verbs/actions:
  - Thread `create`.
  - Thread `read`.
  - Thread `update`.
  - Thread `delete`.
  - Thread `search`.
  - Thread `create_run`.
  - Assistant `create`.
  - Assistant `read`.
  - Assistant `update`.
  - Assistant `delete`.
  - Assistant `search`.
  - Cron `create`.
  - Cron `read`.
  - Cron `update`.
  - Cron `delete`.
  - Cron `search`.
  - Store `put`.
  - Store `get`.
  - Store `search`.
  - Store `delete`.
  - Store `list_namespaces`.
- Source: [supported resources/actions](https://docs.langchain.com/langsmith/auth#supported-resources). Runs are not separately tagged authorization objects. Runs inherit access from the parent thread. All run operations except creation are controlled by thread handlers.
- `create_run` is the specific creation action.

### Authorization handler API

- Global handler: `@auth.on`. Resource handler: `@auth.on.threads`, `@auth.on.assistants`, `@auth.on.crons`. Action handler: `@auth.on.threads.create`, etc. Only the most specific matching handler runs.
- A more general handler does not also run. Exact ownership shape:

```py
@auth.on
async def add_owner(
    ctx: Auth.types.AuthContext,
    value: dict,
) -> dict:
    filters = {"owner": ctx.user.identity}
    metadata = value.setdefault("metadata", {})
    metadata.update(filters)
    return filters
```

- Handler may:
  - mutate `value["metadata"]` on creation/update;
  - return a filter dictionary;
  - return `None` or `True` to allow all matching resources;
  - return `False` to deny all matching resources;
  - raise `HTTPException` to deny.
- Filter operators:
  - exact shorthand: `{"owner": user_id}`.
  - `$eq`: `{"owner": {"$eq": user_id}}`.
  - `$contains`: list membership or containment.
- Multiple keys are logical AND. Generic OR is not documented. Relation traversal is not documented. Tuple-to-userset is not documented.
- Policy-language recursion is not documented. Source: [filter operations](https://docs.langchain.com/langsmith/auth#filter-operations).

### Classification of runtime custom auth

- The framework supplies an enforcement hook. The application supplies the policy. Ownership metadata is attribute-based filtering. `ctx.permissions` checks can implement RBAC-like policy.
- An external Zanzibar/FGA call can be made inside a handler. None of those models is built in merely by importing `Auth`. Default examples are owner-based ABAC plus simple permission strings. Honest classification: programmable per-resource authorization middleware with metadata/namespace filters.
- It is not itself Zanzibar-style ReBAC. It is not a complete packaged RBAC model.

### B. LangSmith organization/workspace RBAC

- This is separate from Agent Server end-user auth. Subject types:
  - human LangSmith user;
  - personal access token inheriting its creator’s permissions;
  - service account/service key;
  - organization membership;
  - workspace membership.
- A user has one organization role per organization. A user has one workspace role per workspace membership. Organization roles:
  - Organization Admin.
  - Organization Operator.
  - Organization User.
  - Organization Viewer.
- Workspace roles:
  - Workspace Admin.
  - Workspace Editor.
  - Workspace Viewer.
  - Enterprise custom workspace roles.
- Custom roles are defined at organization level. Custom roles contain arbitrary combinations of workspace permissions. Custom roles cannot contain organization-level permissions. Custom roles can be assigned differently in each workspace.
- Source: [LangSmith RBAC](https://docs.langchain.com/langsmith/rbac).

### Platform objects and verbs

- Organization objects use permissions such as:
  - `organization:read`.
  - `organization:manage`.
  - `organization:pats:create`.
- Workspace and membership objects use:
  - `workspaces:read`.
  - `workspaces:manage`.
  - `workspaces:manage-members`.
- Deployment objects use:
  - `deployments:create`.
  - `deployments:read`.
  - `deployments:update`.
  - `deployments:delete`.
- Run/trace objects use:
  - `runs:create`.
  - `runs:read`.
  - `runs:share`.
  - `runs:delete`.
- Project, dataset, prompt, rule, queue, chart, bulk-export, and other resources have analogous permission strings. Full mapping: [organization and workspace operations](https://docs.langchain.com/langsmith/organization-workspace-operations). This is conventional permission-string RBAC. Organization Admin inherits full access to all workspaces.
- Other organization roles require explicit workspace membership. This is not a Zanzibar relationship graph.

### C. LangSmith ABAC

- Enterprise ABAC adds tag-based policy to platform RBAC. Current supported policy attribute: only `resource_tag_key`. Exact policy shape:

```json
{
  "name": "Policy Name",
  "description": "Optional description",
  "effect": "allow",
  "condition_groups": [
    {
      "permission": "projects:read",
      "resource_type": "project",
      "conditions": [
        {
          "attribute_name": "resource_tag_key",
          "attribute_key": "Environment",
          "operator": "equals",
          "attribute_value": "Production"
        }
      ]
    }
  ],
  "role_ids": ["<role-uuid>"]
}
```

- Condition groups are OR. Conditions inside a group are AND. Effects are allow or deny. Deny wins.
- Allow may grant access absent RBAC permission. No matching ABAC policy falls back to RBAC. Supported operators include equals, not-equals, case-insensitive variants, glob matches, and `_if_exists` variants. Supported resources include project, prompt, dataset, deployment, queue, MCP server, and Fleet integration.
- Run permissions evaluate parent project tags. Policies apply to workspace role IDs. Source: [LangSmith ABAC](https://docs.langchain.com/langsmith/abac). This ABAC protects LangSmith platform resources.
- It is not the same mechanism as `@auth.on` for application end users.

## 2. Granularity

### Runtime end-user auth

- Per end-user: yes, if `@auth.authenticate` returns distinct identities. Without custom auth, LangGraph sees the API-key owner, usually the developer. Source: [custom auth](https://docs.langchain.com/langsmith/custom-auth). Per thread: yes.
- Per assistant: yes. Per cron: yes. Per store namespace: yes. Per store item: namespace-driven; exact item policy can be coded in the handler.
- Per run: inherited from thread, not independent. Per deployed graph/agent: assistants are configurable graph instances and can be filtered. Per registered graph ID: no dedicated documented authorization handler. Per tool: no.
- Per model tool call: no. Per MCP tool invoked by graph code: no automatic `@auth.on` object. Per workflow node: no. Per graph node: no.
- Per checkpoint: no dedicated handler. Per state field: no. Per arbitrary custom route: authentication can be enabled; `@auth.on` resource policy semantics are not documented for arbitrary objects. Per API key/project only: default deployment uses LangSmith API key, but custom auth permits end-user scope.

### Platform RBAC/ABAC

- Per organization: yes. Per workspace: yes. Per user membership: yes. Per service key workspace set: yes.
- Per deployment operation: yes by permission string. Per individual deployment: ABAC can condition on deployment tags. Per individual project/dataset/prompt: ABAC can condition on tags. Per agent runtime thread: platform RBAC is not the documented end-user mechanism.
- Per tool invocation: platform RBAC does not supply that runtime check. Per workflow node: no.

## 3. Enforcement point

### Authentication

- `@auth.authenticate` runs as middleware on every HTTP request. It receives selected request parameters by function signature:
  - raw `request`;
  - `path`;
  - `method`;
  - `path_params`;
  - `query_params`;
  - `headers`;
  - `authorization`.
- Authentication can reject with 401/exception. Returned user is placed in authorization context. Returned user is also placed in graph configuration. Python graph access: `config["configurable"]["langgraph_auth_user"]` in current custom-auth docs.
- Documentation also contains an older `config["configuration"]` spelling. Exact version-specific key spelling should be verified against deployed Agent Server version. `UNVERIFIED`: whether both spellings remain supported in every current language runtime.

### Resource authorization

- After authentication, the server invokes the most-specific `@auth.on` handler. Enforcement occurs on Agent Server resource API operations. Metadata filters are applied to underlying resource access. Read of another owner’s thread returns not found in the tutorial.
- Create/update handlers can persist owner metadata with the resource. Source: [make conversations private](https://docs.langchain.com/langsmith/resource-auth). Search/list filtering is storage query filtering by metadata. Exact database SQL/RLS implementation: UNVERIFIED.
- Documentation describes server-applied metadata filters, not PostgreSQL row-level security. Store authorization is different. Store handler must rewrite or validate the mutable `namespace`. Returning a metadata filter is not the store mechanism.
- Example:

```py
@auth.on.store
async def authorize_store(
    ctx: Auth.types.AuthContext,
    value: dict,
):
    namespace = value["namespace"]
    value["namespace"] = (
        ctx.user.identity,
        *namespace,
    )
```

- Source: [store authorization note](https://docs.langchain.com/langsmith/auth#supported-resources). Runs inherit thread access. Run creation is checked through `threads.create_run`.

### Re-check frequency

- Authentication is re-run on every incoming request. Authorization handler is run for each matching resource request. This is per API use, not a one-time login decision. A long-running graph execution receives resolved user context.
- The docs do not say authorization handlers run before every node. The docs do not say authorization handlers run before every tool call. The docs do not say external credentials are re-authorized on each downstream use. Therefore per-node/per-tool re-check is UNVERIFIED and should be treated as absent.
- A later HTTP resume request should re-run authentication middleware. Which authorization action protects every resume form is not exhaustively documented. `threads.create_run` covers creating or updating a run according to the supported-actions table. Fine-grained approver semantics remain application-defined.

### Custom routes

- Custom routes are mounted via `http.app`. Authentication on custom routes is controlled by `http.enable_custom_route_auth`. CLI reference says this extends authentication to mounted routes. Source: [LangGraph CLI config](https://docs.langchain.com/langsmith/cli).
- Exact config:

```json
{
  "http": {
    "app": "./src/agent/webapp.py:app",
    "enable_custom_route_auth": true,
    "middleware_order": "auth_first"
  }
}
```

- `auth_first` authenticates before custom middleware. Default `middleware_first` runs custom middleware first. Custom-route authentication is not proof that `@auth.on` maps arbitrary route objects. Custom application code must enforce its own resource policy.

### Tool bypass

- Authenticated user data is propagated to all graph nodes. It may include user-scoped credentials. A node or tool can call external databases, MCP servers, SaaS APIs, or other agents. The platform does not document interception of each such call by `@auth.on`.
- A tool with a deployment-wide database credential can bypass thread metadata filters. A tool can directly query another tenant’s application table if application code permits it. A tool can use arbitrary secrets exposed to the process. Agent Server resource filters do not structurally constrain arbitrary Python/TypeScript code.
- Therefore a tool can bypass the platform resource model through ambient authority. This is not a defect in the hook’s stated scope; it is a boundary of that scope.

## 4. Multi-tenancy

### LangSmith control plane

- Explicit hierarchy:
  - Organization.
  - Workspace.
  - Application.
  - Resources.
- Users can belong to multiple organizations. Users can belong to selected workspaces in an organization. Workspaces have separate member lists and roles. Workspace APIs use `X-Tenant-Id` to select workspace.
- Organization APIs use `X-Organization-Id`. Organization-scoped service keys must supply `X-Tenant-Id` for workspace resources. Missing tenant header in that case returns 403. Source: [manage organization by API](https://docs.langchain.com/langsmith/manage-organization-by-api).
- LangSmith documents each workspace as fully isolated with its own users, data, and resources. Resources cannot be shared across workspaces. Source: [workload isolation](https://docs.langchain.com/langsmith/workload-isolation). Physical database-per-workspace isolation: UNVERIFIED.
- Physical encryption-key-per-workspace isolation: UNVERIFIED. “Fully isolated” is a documented product behavior, not a disclosed storage architecture. Workspace RBAC and tenant routing are genuine multi-tenant control-plane mechanisms.

### Agent Server application tenants

- Custom auth has no built-in mandatory tenant object. `org_id` is arbitrary custom user data in the example. An application may persist `org_id` or owner metadata. An application may return filter `{"org_id": ctx.user.org_id}`.
- An application may prefix store namespace with org/user identity. The framework does not create membership objects for the application’s customers. The framework does not validate a user-to-org relationship unless the handler does so. The framework does not prevent forged `org_id` if the authentication handler trusts unverified claims.
- Correct tenant isolation depends on:
  - validating the token;
  - deriving tenant from a trusted issuer/database;
  - stamping tenant metadata at creation;
  - returning tenant filters on every action;
  - rewriting store namespaces;
  - rejecting unhandled resources/actions;
  - preventing tools from using ambient cross-tenant credentials.
- Global `@auth.on` owner filter is concise but can be superseded by a more-specific handler. Because only the most-specific handler runs, a permissive specific handler can bypass the global default. A deny-all global handler plus explicit allow handlers is the safest documented pattern. User/resource membership and cross-tenant isolation are application policy, not platform-provided tenancy for end users.

## 5. Secrets and credentials

### Platform credentials

- PATs inherit the creating user’s permissions. Removing the user disables that user’s PAT. Service keys represent service accounts. Service keys can be scoped to one workspace, multiple workspaces, or an organization.
- API keys can have expiration dates. Expired keys cannot be reactivated. Source: [LangSmith administration overview](https://docs.langchain.com/langsmith/administration-overview). That is real key scoping for the LangSmith API.
- It is not per-end-customer tool credential custody.

### Deployment secrets

- Cloud revisions accept environment variables and secrets. Existing secret values can be updated for a new revision. Scope shown in deployment docs is deployment/revision/workspace, not end-user tenant. Source: [deploy on Cloud](https://docs.langchain.com/langsmith/deploy-to-cloud).
- Self-hosted deployments can mount Kubernetes secrets or workload identity. Source: [model provider environment variables](https://docs.langchain.com/langsmith/self-host-playground-environment-settings). Workspace secrets exist for some LangSmith products such as Fleet. Those are workspace-scoped.
- They are not automatically selected by application end-user tenant.

### Delegated end-user credentials

- Custom auth may fetch user-specific tokens from an external secret store. It may return those tokens in the authenticated user object. The platform passes that object to nodes. Example docs explicitly show `github_token` and `jira_token` custom fields.
- Source: [custom auth](https://docs.langchain.com/langsmith/custom-auth). This supports BYO credential plumbing. It does not document LangSmith custody of those end-user tokens. The application’s external secret store provides custody.
- Automatic refresh/rotation of arbitrary end-user tool tokens: UNVERIFIED. Per-tenant envelope encryption: UNVERIFIED. Credential access audit tied to `@auth.on`: UNVERIFIED. Returning raw credentials to every node increases ambient authority.
- A runtime capability/credential broker would provide a narrower boundary.

## 6. Human-in-the-loop and authorization

- LangGraph HITL uses interrupts and resume commands. Tool policies can require intervention. Decisions include approve, edit, reject, and respond. Execution state is persisted during the pause.
- Resume shape:

```ts
stream.submit(null, {
  command: {
    resume: response,
  },
})
```

- Source: [HITL frontend guide](https://docs.langchain.com/oss/python/langchain/frontend/human-in-the-loop). HITL decides control flow. It does not define who is an authorized approver. The interrupt payload itself is not an authorization grant.
- The resume command itself is not proof of approver authority. Agent Server authentication can identify the caller on the resume request. Thread authorization can restrict access to the relevant thread. A custom `threads.create_run` handler can inspect caller permissions.
- A dedicated approver role/relationship is not built into the HITL API. Separation-of-duties policy is not built in. “Requester cannot approve own action” is not built in. “Tenant admin can approve only own tenant” must be coded.
- “Specific reviewer group may approve” must be coded or delegated to an external policy engine. Therefore HITL is a gate; it becomes authorization only when the resume endpoint’s caller and pending action are checked by policy.

## 7. Tier and OSS omissions

### Agent Server custom auth

- Custom auth applies to LangSmith SaaS deployments and Enterprise self-hosted deployments. Source: [set up custom authentication](https://docs.langchain.com/langsmith/set-up-custom-auth). LangSmith’s auth reference says custom auth is supported on all LangSmith plans. Source: [auth defaults](https://docs.langchain.com/langsmith/auth#default-security-models).
- Reconciliation:
  - Custom auth is not separately Enterprise-only on SaaS.
  - Cloud deployment itself requires Plus or above.
  - Self-hosted full platform requires Enterprise.
- Source: [LangSmith Deployment](https://docs.langchain.com/langsmith/deployment). Local Agent Server is available for development/testing. Isolated use of the OSS LangGraph library in a custom server does not receive the Agent Server custom-auth integration. The custom-auth guide explicitly excludes isolated OSS library usage.
- OSS LangGraph provides graph execution, persistence, interrupts, and application code primitives. OSS does not provide LangSmith organization/workspace RBAC. OSS does not provide LangSmith Agent Server resource auth middleware automatically. An OSS user can build equivalent middleware and storage filters manually.

### Platform RBAC/ABAC

- Workspace RBAC is Enterprise-only. Other plans default all users to Admin role. Custom workspace roles are Enterprise-only. Source: [LangSmith RBAC](https://docs.langchain.com/langsmith/rbac).
- Organization User and Organization Viewer roles require Plus or Enterprise. Developer organizations are single-workspace and default users to Organization Admin. ABAC is Enterprise-only. Other plans again default workspace members to Admin-level behavior.
- Source: [LangSmith ABAC](https://docs.langchain.com/langsmith/abac). Enterprise self-hosted ABAC requires documented minimum chart/application versions and feature enablement.

## 8. Honest assessment

- Platform RBAC is a real authorization system. Evidence:
  - explicit users, memberships, organizations, and workspaces;
  - explicit roles and custom roles;
  - explicit permission strings per API operation;
  - user and service-key scoping;
  - API/UI enforcement;
  - workspace isolation.
- Platform ABAC is also real but narrow. Its only current attribute source is resource tags. It protects platform resources, not arbitrary graph execution internals. Runtime custom auth is a real enforcement mechanism, but not a turnkey authorization model.
- It is stronger than a single shared API key when correctly implemented. It is thin by default because:
  - without custom auth, Agent Server sees the LangSmith API-key owner;
  - authenticated users share resources until authorization handlers are added;
  - policy data and membership validation are application responsibilities;
  - tool and node actions are outside the supported resource list;
  - arbitrary code keeps ambient credentials.
- It can become strong when:
  - token validation is correct;
  - deny-by-default handlers cover every resource/action;
  - tenant metadata is stamped atomically;
  - filters are applied consistently;
  - namespaces are rewritten;
  - tools call scoped backends;
  - an external FGA service decides complex relations.
- Best concise verdict:
  - Control plane: real Enterprise RBAC/ABAC.
  - Agent runtime resources: developer-programmed authorization hook.
  - Tool execution: no structural authorization boundary.
  - Default: principally API-key authentication, not end-user tenancy.

# Compared to a capability-based model

## Reference capability architecture

- Assumed design:
  - A trusted issuer authenticates the requester.
  - The issuer mints a branded runtime capability per request.
  - Capability names exact tenant, subject, resources, verbs, and constraints.
  - Every protected use re-validates the capability.
  - Capabilities are attenuable rather than amplifiable.
  - Execution grants alter resource identity itself.
  - A broader grant set and narrower grant set resolve to different runtime resources.
  - Tools receive only capability-bound handles.
  - No ambient global credential exists inside tool execution.
  - Bypass is structurally unavailable, not merely disallowed by convention.
- “Branded” must mean unforgeable at runtime, not a TypeScript nominal type alone. Structural non-bypass requires process/API design, not just a signed token. If arbitrary code can still read global secrets, the claimed structural property does not hold.

## Exact contrast

| Property | Mastra FGA | LangGraph custom auth | Capability model |
|---|---|---|---|
| Request identity | Auth provider user | `@auth.authenticate` user | Trusted issuer principal |
| Decision object | Resource type/ID | Thread/assistant/cron/store metadata | Capability-bound handle/resource identity |
| Decision verb | Permission string | Resource action/custom permissions | Minted verb set |
| Policy engine | Pluggable; WorkOS built-in | Application handler/external service | Issuer plus verifier/runtime |
| Built-in model | WorkOS hierarchical RBAC | None; owner filter examples | Capability grants |
| Per agent | Yes | Assistant only, not graph/tool agent authority | Yes if minted resource handle |
| Per tool | Yes at invocation | No automatic hook | Yes, if each tool use requires handle |
| Per memory | Thread-level | Thread/store namespace | Per handle/grant identity |
| Per workflow node | No | No | Possible |
| Re-check | Protected lifecycle invocation | Each matching HTTP resource request | Every protected use |
| Storage isolation | Optional metadata scope | Metadata/namespace filter | Structurally grant-specific resource |
| Ambient tool credentials | Possible | Possible | Excluded by design assumption |
| Direct SDK bypass | Documented workflow-run gaps | Arbitrary graph code outside handlers | Impossible if no unscoped resource exists |
| Tenant model | WorkOS org memberships | Platform workspace; app tenant is custom | Issuer-defined tenant in grant |
| Revocation | Provider check sees current roles | Handler can see current source | Depends on online re-check/revocation design |
| Paid tier | Enterprise production | SaaS deployment; Enterprise self-host/RBAC | Product-specific |

## Where the capability model is stronger

- It binds authority to the execution request, not merely to a user object in context. It can make confused-deputy boundaries explicit. An agent cannot silently substitute another tenant ID if the handle is tenant-bound. A tool cannot widen authority by choosing a different raw resource ID.
- The verifier can reject a mismatched handle before every operation. Grant attenuation can give subagents less authority than parents. A subagent cannot invent a broader branded capability. Grant-specific resource identity prevents cache/state aliasing across authority sets.
- If `resource(grants=A)` and `resource(grants=B)` are distinct objects, state created under A cannot accidentally be reused under B. Capability-bound storage handles can enforce row/prefix/database selection below agent code. Tool implementations do not need to remember to add tenant filters. A missing check becomes a missing handle, not a permissive code path.
- Durable resume can require a freshly minted capability rather than restoring stale authority. HITL can mint a one-shot approval capability for exact action, parameters, tenant, and expiry. Approval then becomes authorization evidence rather than a Boolean resume payload.

## Where Mastra is closest

- Mastra checks agent, workflow, tool, MCP tool, and memory invocation boundaries. Its `resourceMapping` translates framework identity into policy identity. Its `permissionMapping` makes verbs explicit. Its provider is called again at protected lifecycle points.
- Its custom `requireActor()` can constrain autonomous actors. Route metadata co-locates object and verb with the route. These are good policy-enforcement-point properties. Mastra is materially closer than route-only API-key auth.
- But authority remains a decision result, not a resource handle. After the Boolean allow, tool code may use ambient resources. `storedResources.scope` is a filter convention, not an unforgeable capability identity. Workflow `start/resume/restart` gaps show that entry-point enumeration can miss paths.
- `requireForProtectedRoutes` being optional means coverage is configuration-sensitive. Trusted system actors default to bypassing user-centric `require()` after only tenant-scope presence. `requireActor()` is optional provider work. Mastra gets enforcement breadth right.
- It gets structural confinement wrong or leaves it outside scope.

## Where LangGraph is weaker

- LangGraph runtime authorization primarily guards Agent Server resource APIs. It filters threads, assistants, crons, runs-via-thread, and store namespaces. The authenticated user object is passed into every node. That is context propagation, not capability confinement.
- There is no automatic tool object/verb check. There is no automatic node object/verb check. There is no automatic external API resource check. Returning raw user tokens to graph context increases ambient authority.
- Metadata stamping is vulnerable to incomplete action coverage or permissive specific handlers. Store namespace rewriting is effective only for the platform store API. Direct database/tool calls remain outside it. LangGraph gets flexible integration right.
- It gets default-deny completeness and tool-level authority wrong or leaves them to application code.

## Where conventional RBAC/FGA is stronger

- WorkOS and LangSmith have mature administration concepts. Human administrators understand roles, memberships, workspaces, and organization boundaries. Role changes can affect many users immediately. Resource discovery answers “what can this user access?” and “who can access this resource?”.
- WorkOS provides direct and inherited discovery APIs. LangSmith provides custom-role management, SSO, SCIM, PATs, and service keys. A pure capability system often struggles with global entitlement review. Capability inventories can be harder to explain to auditors.
- Role assignment is efficient for stable organizational policy. Workspace membership is efficient for operator access. Central deny policy is easier in LangSmith ABAC than in offline bearer capabilities. Online FGA checks naturally observe revocation and role changes.
- WorkOS documents low-latency checks that reflect role changes immediately. Source: [WorkOS quick start](https://workos.com/docs/fga/quick-start).

## What the capability model can get wrong

- Capability leakage can become authority leakage. Replay is dangerous without nonce, audience, expiry, and channel binding. Bearer capabilities are not automatically safe merely because they are signed. Offline validation weakens immediate revocation.
- Online re-check restores revocation but adds latency and availability dependency. Issuer compromise can mint arbitrary authority. A capability with broad resource patterns recreates ambient authority. Passing capabilities through model-visible text is credential exfiltration.
- Capabilities should be opaque runtime objects, not prompt tokens. Serialization across durable checkpoints needs encryption, expiry, and re-issuance rules. Grant-specific resource identity can explode cache/storage cardinality. Equality semantics must prevent cross-grant aliasing.
- Attenuation semantics must be formally monotonic. The runtime must reject capability amplification. The tool host must prevent access to environment-wide secrets. Native libraries, subprocesses, network, and filesystem access can reopen ambient paths.
- Structural enforcement therefore requires sandboxing or brokered I/O, not branding alone. Human approval capabilities need single-use and parameter binding. Otherwise an approval for one transfer can authorize another. Auditing must record issuer, subject, tenant, grant set, resource identity, use, and decision.
- Administration still needs a comprehensible entitlement model behind minting.

## Relative strength by problem

- LangSmith employee/operator access to platform workspaces:
  - Strongest fit: LangSmith RBAC/ABAC.
  - Capability-only design adds complexity unless layered beneath it.
- B2B SaaS membership and hierarchical project access:
  - Strong fit: WorkOS FGA through Mastra.
  - It provides organization membership, roles, hierarchy, and discovery.
- Per-agent/tool/thread framework entry checks:
  - Stronger shipped coverage: Mastra.
  - LangGraph requires custom tool/node code.
- Arbitrary tool side effects under least privilege:
  - Strongest design: structurally brokered capability handles.
  - Neither competitor documents equivalent confinement.
- Storage-row tenant isolation:
  - Capability-bound storage handle can be strongest if no raw DB path exists.
  - Mastra optional metadata scope is weaker.
  - LangGraph metadata/namespace filtering is weaker outside platform stores.
  - Database-native RLS can equal or exceed a capability layer when identity is correctly propagated.
- Immediate revocation:
  - Online Mastra/WorkOS or LangGraph external-policy checks are naturally strong.
  - Capability system must re-check online or use short expiry/revocation state.
- Durable execution resume:
  - Fresh per-resume capability is the cleanest authority boundary.
  - Mastra explicitly requires fresh actor handling but leaves uncovered SDK paths.
  - LangGraph re-authenticates HTTP requests but does not define action-specific approval authority.
- Audit and admin usability:
  - Conventional RBAC/FGA currently has the clearer product surface.
  - Capability model needs first-class grant issuance, introspection, revocation, and explanation UI.

## Final judgment

- Mastra is the stronger direct runtime-authorization competitor. It has explicit per-agent, per-tool, per-workflow, per-thread, MCP, stored-resource, and route checks. Its WorkOS provider supplies real organization membership and hierarchical resource grants. It should not be described as Zanzibar-style based on the documented built-in provider.
- Its most serious weaknesses are ambient tool authority, optional fail-closed coverage, system-actor bypass defaults, and direct workflow-run gaps. LangGraph Platform has the stronger mature control-plane governance story. Its workspace RBAC and tag ABAC are real Enterprise authorization systems. Its end-user Agent Server auth is an extensibility surface, not a turnkey tenancy model.
- Its metadata filters are useful for threads and stores but do not confine graph/tool execution. A correctly implemented capability architecture is stronger for execution-time least privilege. It wins only if every resource access is brokered and grant-specific identity cannot be bypassed. “Branded capability” without removal of ambient credentials is merely another token wrapper.
- The most defensible architecture is layered:
  - RBAC/ReBAC/ABAC for durable entitlement administration.
  - Trusted issuer resolves those entitlements per request.
  - Issuer mints attenuated, short-lived runtime capabilities.
  - Capability-bound handles are the only route to tools, storage, network, and secrets.
  - Every use validates audience, tenant, verb, resource, expiry, and revocation state.
  - Durable resumes obtain fresh capabilities.
  - HITL approval mints a one-shot action-specific capability.
- Against that bar:
  - Mastra has a credible policy layer but not structural non-bypass.
  - LangGraph has credible resource middleware but not execution authority.
  - Neither documented system makes bypass impossible by changing resource identity per grant set.

## Verification ledger

- VERIFIED: Mastra FGA is EE and requires a production license. VERIFIED: Mastra skips FGA when no provider is configured. VERIFIED: Mastra checks agent `generate`/`stream`. VERIFIED: Mastra checks `Workflow.execute()`.
- VERIFIED: Mastra checks standalone, agent, and MCP tools. VERIFIED: Mastra checks memory at thread level. VERIFIED: Mastra supports route-level FGA metadata. VERIFIED: Mastra supports optional protected-route coverage failure.
- VERIFIED: Mastra FGA does not automatically filter shared stored records. VERIFIED: Mastra offers separate stored-resource metadata scoping. VERIFIED: Mastra does not independently check direct workflow run `start/resume/restart` in the documented release. VERIFIED: Mastra trusted system actors bypass user-centric `require()` by default after tenant-scope check.
- VERIFIED: optional `requireActor()` can enforce per-agent least privilege. VERIFIED: WorkOS FGA subject is organization membership. VERIFIED: WorkOS grants resource-scoped roles. VERIFIED: WorkOS inherits permissions down a single-parent hierarchy.
- VERIFIED: WorkOS describes its model as hierarchical RBAC versus OpenFGA ReBAC. UNVERIFIED: per-workflow-node Mastra policy. UNVERIFIED: per-message or per-vector-row Mastra policy. UNVERIFIED: FGA-integrated per-tenant secret vault in Mastra.
- UNVERIFIED: independent FGA check inside `approveToolCall()`. VERIFIED: LangGraph authentication middleware runs every request. VERIFIED: LangGraph resource auth uses `@auth.on` handlers. VERIFIED: supported runtime resources are threads, assistants, crons, and store; runs inherit thread policy.
- VERIFIED: handlers can stamp metadata, filter, allow, or deny. VERIFIED: metadata filter operators are exact/`$eq`/`$contains` with AND across keys. VERIFIED: store isolation uses namespace mutation/validation. VERIFIED: only the most-specific handler runs.
- VERIFIED: default API-key identity does not distinguish application end users. VERIFIED: isolated OSS LangGraph use does not receive deployment custom-auth integration. VERIFIED: LangSmith workspace RBAC is Enterprise-only. VERIFIED: LangSmith ABAC is Enterprise-only and currently tag-only.
- VERIFIED: LangSmith Cloud deployment requires Plus or above. VERIFIED: full self-hosted platform requires Enterprise. VERIFIED: LangSmith uses organizations, workspaces, memberships, PATs, and scoped service keys. VERIFIED: `X-Tenant-Id` selects workspace for management APIs.
- UNVERIFIED: database-native RLS for Agent Server metadata filters. UNVERIFIED: automatic per-tool/per-node runtime authorization in LangGraph. UNVERIFIED: platform-custodied per-end-user credential rotation. UNVERIFIED: built-in identity/role rules for HITL approvers.

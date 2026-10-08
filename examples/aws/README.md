# AWS host recipe: AgentCore Runtime (or ECS) + Code Interpreter + one EFS folder per user

The standard agent (`examples/shared/standard-agent.mjs`) with its commands in an AgentCore Code Interpreter session and its files on the user's folder of one EFS file system. The decisions are in [HOST-RECIPE-AWS.md](../../docs/architecture/HOST-RECIPE-AWS.md); this folder is the code. Fictional content only. **It has never run against AWS**: everything here is proven offline (below), and the live run is pending an account.

| File | What it is |
|---|---|
| `server.mjs` | The container entry: `GET /ping`, `POST /invocations` (the chat transport operations in the JSON body) on `0.0.0.0:8080`; the same process runs as an ECS service |
| `jwt.mjs` | Host-owned RS256 bearer check against the issuer's JWKS (inline or fetched) |
| `fake-code-interpreter.mjs` | Offline fake of the Code Interpreter wire API (REST JSON + event stream) for the real AWS SDK client |
| `journey.mjs` | Offline journey: two users, the scripted model, the fake interpreter, a temporary directory standing for EFS |
| `template.yaml` | CloudFormation: VPC endpoints, EFS with the host's and an example user's access point, Code Interpreter in VPC mode, least-privilege roles, AgentCore Runtime or ECS behind an HTTPS load balancer |
| `provision-user.mjs` | Prints the `aws efs create-access-point` command and the `users.json` entry for one user (no AWS call) |
| `Dockerfile` | ARM64 image (AgentCore Runtime requires `linux/arm64`) |

## How the pieces fit

```
browser ──Bearer JWT──▶ AgentCore Runtime (one host session) or ECS task
                          server.mjs: one harness + chat transport, a workspace per user from its env
                          /mnt/efs  = EFS access point root /boring (uid 1000, gid 1000)
                             users/<id>/   the user's workspace          ◀─ the same files ─▶  Code Interpreter session
                             state/<id>/   journal.sqlite (harness.pi.sqlite in state/)                  /mnt/workspace = access point
                                                                                             root /boring/users/<id> (uid per user, gid 1000)
```

- **Per user**: `efsUserLayout` (`@hachej/boring-execution/aws-code-interpreter`) computes the folder, the access point (root `/boring/users/<id>`, POSIX uid per user, shared gid 1000, setgid `2770`), and the state directory. User ids are `[a-z0-9][a-z0-9_-]{0,63}`, never a path.
- **Commands** run in the user's Code Interpreter session, started on the first command with `filesystemConfigurations` naming the user's access point at `/mnt/workspace`. The runtime cannot mount an access point per user (its mounts are fixed for the runtime), so it mounts the host access point and confines itself in code to the user's folder; the interpreter, where the agent's commands run, is confined by the access point itself.
- **Files** (Pi's read/write/edit, `present`, the viewer, uploads) are read and written on the runtime's mount through `createCodeInterpreterEnv`: tool paths are interpreter paths (`/mnt/workspace/...`), mapped onto `/mnt/efs/users/<id>`, refusing `..`, absolute paths elsewhere and symbolic links whose target leaves the folder (dangling ones included). One folder, no copy, no sync.
- **Shared writes**: both sides use umask `002` and the shared gid, so a file the agent writes is editable by a command and the reverse.
- **One harness, a workspace per call**: one process and one native Harness serve every user. Its `env` resolves the conversation's owner (`<user>/<key>`, managed metadata) to the user's workspace from one `createWorkspaceCache` entry (folder, Code Interpreter session, provider and journal), attached to the env, and every tool takes the workspace of its call's env (`workspace: 'env'`); nothing per user is built at startup.
- **Single writer**: Pi's storage is one file, `state/harness.pi.sqlite`, held by this process. On AgentCore Runtime every client sends `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: <RUNTIME_SESSION_ID>` (`server.mjs`), so one microVM serves everyone; a request carrying another session id is refused (409). On ECS, one task, never two during a deployment.
- **Idle**: a user's workspace opens on their first call or request and closes after `workspaceIdleMs` (default 10 minutes) with no request and no live work (its interpreter session stopped, its journal released); the next use reopens it over the same files. `/ping` answers `HealthyBusy` while the harness has live tasks or unsettled submissions, with `time_of_last_update` changing only when the status does. Runtime lifecycle 900 s idle, 28 800 s maximum.
- **Lost interpreter session**: a command in an expired or stopped session fails with `shell_unavailable` (no silent restart); the host's next request calls `renew()` and the next command starts a new session over the same files.
- **Auth**: AgentCore's JWT authorizer checks the token; the container checks it again (`jwt.mjs`) because `sub` selects the folder and because the ECS mode has no authorizer. `users.json` (in `/mnt/efs/state/`) maps `sub` to uid and access point; an unknown user gets 403.

## Offline proof (no account, no key)

```sh
npm run build
node examples/aws/journey.mjs                                  # the recipe through /invocations, two users on one harness
STUDIO_VARIANT=aws STUDIO_AWS=fake STUDIO_ONLY=aws-shared-folder CHROMIUM=<binary> npm run studio:journey:scripted   # the same in the studio UI, viewer included
node --test test/packages/execution.test.mjs                   # the adapter through the real SDK client: output, timeout, abort, loss, two users, symlinks
uvx cfn-lint@1.57.2 --regions us-east-1 -- examples/aws/template.yaml
```

The fake implements StartCodeInterpreterSession, StopCodeInterpreterSession and the tools `startCommandExecution`, `getTask` and `stopTask` in the SDK's wire format; it rewrites the mount path in commands instead of mounting anything, and its output shapes follow the SDK model, not observed service behaviour.

## Harness per owner

The alternative when each conversation key should have its own microVM (an AgentCore session per `<user>/<key>`) or crash isolation: `@hachej/boring-agent/harness-pool` with one harness file per key (`efsUserLayout(...).harnessFile(key)`), each harness's `env` the owner's workspace from the same cache (`workspaces.acquire(user)`), its root conversation the key's, and the session check `runtimeSessionId(user, key)` per key. The agent and its tools stay as they are (`workspace: 'env'`). [FILES-GIT-EXEC](../../docs/architecture/FILES-GIT-EXEC.md#workspace-per-call) says when to choose it.

## Live run (pending: needs an AWS account)

Region with AgentCore Runtime and Code Interpreter; two of its supported Availability Zones; an OIDC issuer (for example a Cognito user pool) with a fictional test user; Bedrock model access for the chosen inference profile. Never against production data.

```sh
# 1. Image (ARM64) in ECR
aws ecr create-repository --repository-name boring-agent
docker buildx build --platform linux/arm64 -f examples/aws/Dockerfile -t <account>.dkr.ecr.<region>.amazonaws.com/boring-agent:<tag> --push .
# 2. Stack (HostMode agentcore or ecs; ecs also needs CertificateArn)
aws cloudformation deploy --stack-name boring-agent --template-file examples/aws/template.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides HostMode=agentcore ContainerImageUri=<uri> EcrRepositoryArn=<arn> AvailabilityZones=<az1>,<az2> \
  OidcIssuer=<issuer> OidcAudience=<client id> OidcJwks="$(curl -s <issuer>/.well-known/jwks.json)" \
  FoundationModelId=<model id> InferenceProfileId=<profile id> ExampleUserId=<sub of the test user> ExampleUserUid=2001
# 3. Users: the stack's example user, then one access point per further user
node examples/aws/provision-user.mjs <sub> <uid> <FileSystemId> <FileSystemArn>    # prints the create-access-point command and the users.json entry
#    write /mnt/efs/state/users.json (through the host access point, e.g. from a one-off ECS task) with every user's entry
# 4. Invoke (AgentCore): the session id is RUNTIME_SESSION_ID from server.mjs
curl -sN -X POST "https://bedrock-agentcore.<region>.amazonaws.com/runtimes/<url-encoded RuntimeArn>/invocations?qualifier=DEFAULT" \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -H "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: <session id>" \
  -d '{"op":"submit","input":{"requestId":"r1","content":"Write notes/plan.md, then run cat notes/plan.md in bash"}}'
#    then {"op":"entries","params":{"limit":"20"}}, {"op":"files"}, {"op":"file","params":{"path":"notes/plan.md"}}; a second user's token must not list the file
# 5. Delete: aws cloudformation delete-stack --stack-name boring-agent (the EFS file system is retained; delete it separately)
```

Things the live run must settle (open in HOST-RECIPE-AWS.md): the real `getTask` output shape (cumulative or incremental, `failed` statuses), whether the `Authorization` header reaches the container through `RequestHeaderAllowlist`, NDJSON streaming of `watch` through `InvokeAgentRuntime`, whether `/ping` `HealthyBusy` holds a session past the idle timeout, whether StartCodeInterpreterSession needs any EFS permission on the caller, SQLite latency on EFS with the network file system preset (every SQLite file here, Pi's harness files included, is opened with `sqliteSettings.networkFilesystem`: rollback journal, exclusive lock held by its one owner; decision 3 of HOST-RECIPE-AWS.md), and the cold start of a per-user interpreter session.

## Limits

- The browser UI is not wired to `/invocations` yet: `createRemoteChat` speaks `?op=` on one URL, so a browser in front of AgentCore needs a fetch adapter that moves the operation into the body (the operations and bodies are otherwise the same). The studio's `aws` variant shows the UI over the same execution environment offline, through the studio's own server rather than `/invocations`.
- Runtime-side confinement is code, not an access point: a bug in the path checks would expose other users' folders to the file tools (the interpreter stays confined by its access point). Checks race with concurrent symbolic link changes in the interpreter (time of check to time of use).
- The interpreter role may mount any access point of the file system except the host's; which user's access point a session gets is the host's choice. Per-user access points are provisioned outside the stack (`provision-user.mjs`), at most the EFS access point quota per file system.
- `createTempDir`/`createTempFile` refuse (`not_supported`); output is polled (`getTask`) and arrives in steps of the poll interval; stdout and stderr are delivered one after the other, not interleaved.
- The workspace provider's incarnation is a constant (`aws`): a deleted and recreated user folder is not detected as a new incarnation.
- No NAT gateway: the container reaches only Bedrock, AgentCore, ECR, Logs and S3 through VPC endpoints, and the interpreter only EFS. Another model provider needs egress.

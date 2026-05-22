# Spike: Vercel `/workspace` command cwd without command rewriting

Bead: `boring-ui-v2-reorg-ocu7`
Date: 2026-05-20

## Result

The viable path is to make `/workspace` a real directory in the Vercel VM and
execute commands with Vercel's `runCommand` metadata:

```ts
await sandbox.runCommand({
  cmd: 'sh',
  args: ['-c', userCommand],
  cwd: '/workspace',
  env: {
    ...userEnv,
    PWD: '/workspace',
    BORING_AGENT_WORKSPACE_ROOT: '/workspace',
  },
})
```

This does not require arbitrary command-string rewriting. The fixed bootstrap
step can create the directory once, before agent commands run:

```sh
uid=$(id -u)
gid=$(id -g)
sudo install -d -m 755 -o "$uid" -g "$gid" /workspace
```

The workspace adapter should then use `/workspace` as its canonical remote file
root. The Vercel SDK supports absolute file paths: its `writeFiles` path
normalizer treats absolute paths as absolute inside the archive, and `runCommand`
passes `cwd` through to the API request body.

## Why the existing symlink alias is not enough

Current init creates the internal storage root and best-effort symlink:

```sh
mkdir -p /vercel/sandbox && (ln -sfn /vercel/sandbox /workspace 2>/dev/null || true)
```

A symlink can make relative shell operations work from `/workspace`, and setting
`PWD=/workspace` makes the shell builtin `pwd` display `/workspace`. It does not
make `/workspace` the actual process cwd for non-shell tools: Node's
`process.cwd()` resolves to the symlink target (`/vercel/sandbox`). That leaks the
internal root and violates the stronger public contract that the agent-visible
cwd is actually `/workspace`.

Therefore the dependent implementation should not preserve the current
`/workspace` -> `/vercel/sandbox` alias as the success path. Use a real
`/workspace` directory, or stop for redesign if Vercel rejects creating or using
that directory in a live sandbox.

## Current code inspected

- `packages/agent/src/server/runtime/modes/vercel-sandbox.ts`
  - `ensureVercelWorkspaceRoot()` currently initializes `/vercel/sandbox` and
    best-effort symlinks `/workspace` to it.
- `packages/agent/src/server/sandbox/vercel-sandbox/createVercelSandboxExec.ts`
  - currently rewrites `/workspace` to `/vercel/sandbox` in `cwd`, command text,
    and env values before calling `sandbox.runCommand`.
- `@vercel/sandbox@2.0.0-beta.14` SDK
  - `Session.runCommand()` passes `cwd` and `env` directly to the API request.
  - `writeFiles()` normalizes absolute file paths as absolute paths under the
    archive extract root, so `/workspace/...` can be used directly if the VM path
    exists.

## Verification added

Local unit tests document the cwd mechanics that matter before touching the live
adapter:

```sh
pnpm --filter @hachej/boring-agent run test src/server/sandbox/vercel-sandbox/__tests__/workspaceCwdSpike.test.ts
```

They verify:

1. a real workspace directory gives shell `pwd`, `$PWD`, Node `process.cwd()`,
   and relative file operations the same root;
2. a symlink alias can make shell `pwd` logical but still leaves
   `process.cwd()` at the target path.

## Live Vercel repro

The original opt-in live repro script was removed after this spike graduated
into the runtime implementation. The checked-in verification now lives in unit
and runtime matrix tests, so the agent package does not carry credentialed,
one-off spike scripts.

## Follow-up for implementation bead

1. Replace Vercel workspace remote path mapping with `/workspace` as the
   canonical remote root.
2. Change Vercel bootstrap to create and own a real `/workspace` directory.
3. Remove command/env/cwd alias rewriting from `createVercelSandboxExec`.
4. Pass command `cwd: workspace.root` and env
   `BORING_AGENT_WORKSPACE_ROOT=/workspace`; set `PWD=/workspace` when invoking
   `sh -c` commands.
5. Keep `/vercel/sandbox` only as an internal legacy/reference path, not in the
   public successful command path.

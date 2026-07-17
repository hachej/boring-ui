FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY .npmrc pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/workspace/package.json packages/workspace/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY packages/boring-bash/package.json packages/boring-bash/package.json
COPY plugins/boring-mcp/package.json plugins/boring-mcp/package.json
COPY plugins/boring-governance/package.json plugins/boring-governance/package.json
COPY plugins/boring-automation/package.json plugins/boring-automation/package.json
COPY apps/full-app/package.json apps/full-app/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY packages/ packages/
COPY plugins/boring-mcp/ plugins/boring-mcp/
COPY plugins/boring-governance/ plugins/boring-governance/
COPY plugins/boring-automation/ plugins/boring-automation/
COPY apps/full-app/ apps/full-app/

# Build packages in dependency order.
# ui and agent need dts so workspace's vite-plugin-dts can resolve their types.
# workspace tsup skips dts (vite-plugin-dts covers the front entries instead).
# tsup's onSuccess hook copies core's hand-authored CSS (theme.css, styles.css,
# chatFirst/*) into dist, so this stays in sync with `pnpm build` automatically.
# build:assert (dts-agnostic) then verifies every exported artifact + CSS @import
# is present in dist, so a drift fails the image build instead of reaching prod.
RUN pnpm --filter @hachej/boring-core exec tsup --no-dts \
  && pnpm --filter @hachej/boring-core run build:assert

RUN pnpm --filter @hachej/boring-ui-kit exec tsup \
  && pnpm --filter @hachej/boring-ui-kit exec node scripts/build-styles.mjs

RUN pnpm --filter @hachej/boring-agent run build

RUN pnpm --filter @hachej/boring-bash exec tsup

RUN pnpm --filter @hachej/boring-workspace exec tsup --no-dts \
  && pnpm --filter @hachej/boring-workspace exec vite build \
  && pnpm --filter @hachej/boring-workspace exec node scripts/build-workspace-css.mjs

RUN pnpm --filter @hachej/boring-mcp exec tsup --no-dts

RUN pnpm --filter @hachej/boring-governance exec tsup --no-dts

RUN pnpm --filter @hachej/boring-automation exec tsup --no-dts

# BORING_USE_LOCAL_PACKAGES=1 lets Vite resolve @hachej/* from source so
# Tailwind scans the actual TSX files instead of compiled dist JS. Without
# this, Tailwind only sees packages/core/dist and tree-shakes all workspace
# utility classes out of the final CSS bundle.
RUN pnpm --filter full-app exec tsc -p tsconfig.server.json --noCheck \
  && test ! -e apps/full-app/dist/server/deployment \
  && BORING_USE_LOCAL_PACKAGES=1 pnpm --filter full-app exec vite build

FROM node:22-slim AS runtime
WORKDIR /app
ARG REVISION=unknown
ARG SOURCE=https://github.com/hachej/boring-ui-v2
LABEL org.opencontainers.image.source=$SOURCE \
  org.opencontainers.image.revision=$REVISION \
  org.opencontainers.image.title="boring-ui full-app" \
  boring.role="web"
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ca-certificates util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && groupadd --system --gid 10001 boring \
  && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin boring \
  && mkdir -p /data/workspaces /data/pi-sessions \
  && chown -R boring:boring /data

COPY --from=build /app/.npmrc /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./

# pnpm uses relative symlinks under node_modules to point at workspace
# packages. Copy the full link tree from build so runtime resolves correctly.
COPY --from=build /app/node_modules/ node_modules/

COPY --from=build /app/packages/core/dist/ packages/core/dist/
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/drizzle/ packages/core/drizzle/
COPY --from=build /app/packages/core/node_modules/ packages/core/node_modules/

COPY --from=build /app/packages/ui/dist/ packages/ui/dist/
COPY --from=build /app/packages/ui/package.json packages/ui/package.json
COPY --from=build /app/packages/ui/node_modules/ packages/ui/node_modules/

COPY --from=build /app/packages/agent/dist/ packages/agent/dist/
COPY --from=build /app/packages/agent/package.json packages/agent/package.json
COPY --from=build /app/packages/agent/node_modules/ packages/agent/node_modules/

COPY --from=build /app/packages/boring-bash/dist/ packages/boring-bash/dist/
COPY --from=build /app/packages/boring-bash/package.json packages/boring-bash/package.json
COPY --from=build /app/packages/boring-bash/node_modules/ packages/boring-bash/node_modules/

COPY --from=build /app/packages/workspace/dist/ packages/workspace/dist/
COPY --from=build /app/packages/workspace/package.json packages/workspace/package.json
COPY --from=build /app/packages/workspace/node_modules/ packages/workspace/node_modules/

COPY --from=build /app/plugins/boring-mcp/dist/ plugins/boring-mcp/dist/
COPY --from=build /app/plugins/boring-mcp/package.json plugins/boring-mcp/package.json
COPY --from=build /app/plugins/boring-mcp/node_modules/ plugins/boring-mcp/node_modules/

COPY --from=build /app/plugins/boring-governance/dist/ plugins/boring-governance/dist/
COPY --from=build /app/plugins/boring-governance/package.json plugins/boring-governance/package.json
COPY --from=build /app/plugins/boring-governance/node_modules/ plugins/boring-governance/node_modules/

COPY --from=build /app/plugins/boring-automation/dist/ plugins/boring-automation/dist/
COPY --from=build /app/plugins/boring-automation/package.json plugins/boring-automation/package.json
COPY --from=build /app/plugins/boring-automation/node_modules/ plugins/boring-automation/node_modules/

COPY --from=build /app/apps/full-app/dist/ apps/full-app/dist/
COPY --from=build /app/apps/full-app/boring.app.toml apps/full-app/boring.app.toml
COPY --from=build /app/apps/full-app/package.json apps/full-app/package.json
COPY --from=build /app/apps/full-app/node_modules/ apps/full-app/node_modules/
COPY apps/full-app/docker/web-entrypoint.sh /usr/local/bin/web-entrypoint
RUN chmod 0755 /usr/local/bin/web-entrypoint

# BORING_AGENT_MODE=vercel-sandbox: even on Fly.io the server itself runs here
# but agent tool execution (bash/files) runs in remote Vercel sandbox containers.
# Store chat transcripts on the Fly volume; the container root filesystem is ephemeral.
# Model config comes from Fly secrets.
ENV NODE_ENV=production \
  BORING_AGENT_MODE=vercel-sandbox \
  BORING_AGENT_WORKSPACE_ROOT=/data/workspaces \
  BORING_AGENT_SESSION_ROOT=/data/pi-sessions
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/web-entrypoint"]
CMD ["node", "apps/full-app/dist/server/main.js"]

FROM node:22-slim AS worker-runtime
WORKDIR /app
ARG REVISION=unknown
ARG SOURCE=https://github.com/hachej/boring-ui-v2
LABEL org.opencontainers.image.source=$SOURCE \
  org.opencontainers.image.revision=$REVISION \
  org.opencontainers.image.title="boring-ui full-app worker" \
  boring.role="worker"
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ca-certificates curl git python3 python3-pip python3-venv ripgrep util-linux \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && groupadd --system --gid 10001 boring \
  && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin boring \
  && mkdir -p /data/workspaces \
  && chown -R boring:boring /data

# Worker image intentionally excludes the full-app frontend and main server.
# It contains only the internal worker entrypoint plus the agent package it uses
# for workspace/path validation and bwrap execution.
RUN printf '{"type":"module"}\n' > package.json
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/packages/agent/dist/ packages/agent/dist/
COPY --from=build /app/packages/agent/package.json packages/agent/package.json
COPY --from=build /app/packages/agent/node_modules/ packages/agent/node_modules/
COPY --from=build /app/apps/full-app/dist/server/agent-worker.js worker/agent-worker.js
COPY apps/full-app/docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint
RUN chmod 0755 /usr/local/bin/worker-entrypoint

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

CMD ["/usr/local/bin/worker-entrypoint", "node", "worker/agent-worker.js"]

# Keep the public web app as the default image when no --target is provided.
# The worker image remains available via --target worker-runtime.
FROM runtime AS web-runtime

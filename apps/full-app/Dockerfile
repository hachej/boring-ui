FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY .npmrc pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/workspace/package.json packages/workspace/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY apps/full-app/package.json apps/full-app/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/ packages/
COPY apps/full-app/ apps/full-app/

# Build packages in dependency order.
# ui and agent need dts so workspace's vite-plugin-dts can resolve their types.
# workspace tsup skips dts (vite-plugin-dts covers the front entries instead).
RUN pnpm --filter @hachej/boring-core exec tsup --no-dts \
  && cp packages/core/src/front/theme.css packages/core/dist/front/theme.css \
  && cp packages/core/src/app/front/styles.css packages/core/dist/app/front/styles.css

RUN pnpm --filter @hachej/boring-ui-kit exec tsup \
  && pnpm --filter @hachej/boring-ui-kit exec node scripts/build-styles.mjs

RUN pnpm --filter @hachej/boring-agent exec tsup \
  && cp packages/agent/src/front/styles/globals.css packages/agent/dist/front/styles.css

RUN pnpm --filter @hachej/boring-workspace exec tsup --no-dts \
  && pnpm --filter @hachej/boring-workspace exec vite build \
  && pnpm --filter @hachej/boring-workspace exec node scripts/build-workspace-css.mjs

# BORING_USE_LOCAL_PACKAGES=1 lets Vite resolve @hachej/* from source so
# Tailwind scans the actual TSX files instead of compiled dist JS. Without
# this, Tailwind only sees packages/core/dist and tree-shakes all workspace
# utility classes out of the final CSS bundle.
RUN pnpm --filter full-app exec tsc -p tsconfig.server.json --noCheck \
  && BORING_USE_LOCAL_PACKAGES=1 pnpm --filter full-app exec vite build

FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

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

COPY --from=build /app/packages/workspace/dist/ packages/workspace/dist/
COPY --from=build /app/packages/workspace/package.json packages/workspace/package.json
COPY --from=build /app/packages/workspace/node_modules/ packages/workspace/node_modules/

COPY --from=build /app/apps/full-app/dist/ apps/full-app/dist/
COPY --from=build /app/apps/full-app/package.json apps/full-app/package.json
COPY --from=build /app/apps/full-app/node_modules/ apps/full-app/node_modules/

# BORING_AGENT_MODE=vercel-sandbox: even on Fly.io the server itself runs here
# but agent tool execution (bash/files) runs in remote Vercel sandbox containers.
# BORING_AGENT_WORKSPACE_ROOT and model config come from fly secrets.
ENV NODE_ENV=production \
  BORING_AGENT_MODE=vercel-sandbox \
  BORING_AGENT_WORKSPACE_ROOT=/data/workspaces
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

CMD ["node", "apps/full-app/dist/server/main.js"]

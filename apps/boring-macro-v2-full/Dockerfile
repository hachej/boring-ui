FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY .npmrc pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/workspace/package.json packages/workspace/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY apps/boring-macro-v2/package.json apps/boring-macro-v2/package.json
COPY apps/boring-macro-v2-full/package.json apps/boring-macro-v2-full/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/ packages/
COPY apps/boring-macro-v2/ apps/boring-macro-v2/
COPY apps/boring-macro-v2-full/ apps/boring-macro-v2-full/

RUN pnpm --filter @hachej/boring-core exec tsup --no-dts \
  && cp packages/core/src/front/theme.css packages/core/dist/front/theme.css \
  && cp packages/core/src/app/front/styles.css packages/core/dist/app/front/styles.css

RUN pnpm --filter @hachej/boring-ui-kit exec tsup

RUN pnpm --filter @hachej/boring-agent exec tsup \
  && cp packages/agent/src/front/styles/globals.css packages/agent/dist/front/styles.css

RUN pnpm --filter @hachej/boring-workspace exec tsup --no-dts \
  && pnpm --filter @hachej/boring-workspace exec vite build

# Compile the release migration separately from the Vite bundle. The app
# server still runs from source via tsx because the macro plugin keeps
# Python/template assets colocated under src/plugins.
RUN pnpm --filter @boring/macro-full exec tsc -p tsconfig.server.json --noCheck \
  && BORING_USE_LOCAL_PACKAGES=1 pnpm --filter @boring/macro-full exec vite build

FROM node:22-slim AS runtime
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY --from=build /app/.npmrc /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules/ node_modules/

COPY --from=build /app/packages/core/dist/ packages/core/dist/
COPY --from=build /app/packages/core/drizzle/ packages/core/drizzle/
COPY --from=build /app/packages/core/package.json packages/core/package.json
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

# Frontend dist (Vite output served by core's serveFrontend)
COPY --from=build /app/apps/boring-macro-v2-full/dist/ apps/boring-macro-v2-full/dist/
# Server source (tsx at runtime — macro plugin assets alongside .ts files)
COPY --from=build /app/apps/boring-macro-v2-full/src/ apps/boring-macro-v2-full/src/
COPY --from=build /app/apps/boring-macro-v2-full/package.json apps/boring-macro-v2-full/package.json
COPY --from=build /app/apps/boring-macro-v2-full/tsconfig.json apps/boring-macro-v2-full/tsconfig.json
COPY --from=build /app/apps/boring-macro-v2-full/tsconfig.server.json apps/boring-macro-v2-full/tsconfig.server.json
COPY --from=build /app/apps/boring-macro-v2-full/node_modules/ apps/boring-macro-v2-full/node_modules/

# boring-macro-v2 plugin + sandbox-template helper — referenced by relative imports in boring-macro-v2-full
COPY --from=build /app/apps/boring-macro-v2/src/plugins/ apps/boring-macro-v2/src/plugins/
COPY --from=build /app/apps/boring-macro-v2/src/server/macroSandboxTemplate.ts apps/boring-macro-v2/src/server/macroSandboxTemplate.ts
COPY --from=build /app/apps/boring-macro-v2/package.json apps/boring-macro-v2/package.json
COPY --from=build /app/apps/boring-macro-v2/node_modules/ apps/boring-macro-v2/node_modules/

ENV NODE_ENV=production \
    PORT=3000 \
    BORING_AGENT_MODE=vercel-sandbox \
    BORING_AGENT_WORKSPACE_ROOT=/data/workspaces
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "apps/boring-macro-v2-full/src/server/main.ts"]

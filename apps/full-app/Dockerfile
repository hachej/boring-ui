# Based on packages/core/Dockerfile.reference with full-app additions.

FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/workspace/package.json packages/workspace/package.json
COPY packages/agent/package.json packages/agent/package.json
COPY apps/full-app/package.json apps/full-app/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --prod=false --shamefully-hoist \
  && pnpm --filter @boring/core install --prod=false \
  && pnpm --filter @boring/workspace install --prod=false \
  && pnpm --filter @boring/agent install --prod=false

FROM deps AS build
COPY packages/ packages/
COPY apps/full-app/ apps/full-app/

# Remote Fly builds have occasionally produced workspace package bin shims
# without the backing dev tool packages. Force-link the build toolchain after
# source copy so package-local scripts (tsup/vite) resolve deterministically.
# Core frontend source is bundled by Vite from packages/core/src, so
# react-router-dom must also be root-visible for pnpm's hoisted resolver.
RUN pnpm --filter @boring/core add -D tsup@8.5.1 tailwindcss@4.2.4 --lockfile=false \
  && pnpm --filter @boring/agent add -D tsup@8.5.1 vitest@4.1.5 ai@5.0.106 --lockfile=false \
  && pnpm --filter @boring/workspace add -D tsup@8.5.1 vite@6.4.2 vite-plugin-dts@4.5.4 @vitejs/plugin-react@4.7.0 @tailwindcss/vite@4.2.4 tailwindcss@4.2.4 vitest@4.1.5 @testing-library/react@16.3.2 --lockfile=false \
  && pnpm --filter full-app add react-router-dom@7.14.2 --lockfile=false \
  && pnpm add -w react-router-dom@7.14.2 --lockfile=false

# Core dts generation is currently unstable under workspace zod peer resolution.
# Build runtime JS output directly for container usage.
RUN pnpm --filter @boring/core exec tsup --no-dts \
  && cp packages/core/src/front/theme.css packages/core/dist/front/theme.css

RUN pnpm --filter @boring/agent exec tsup --no-dts \
  && cp packages/agent/src/front/styles/globals.css packages/agent/dist/front/styles.css
RUN pnpm --filter @boring/workspace exec tsup --no-dts \
  && pnpm --filter @boring/workspace exec vite build
RUN pnpm --filter full-app exec tsc -p tsconfig.server.json --noCheck \
  && pnpm --filter full-app exec vite build

FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runtime
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY --from=build /app/pnpm-workspace.yaml /app/package.json /app/pnpm-lock.yaml ./

# pnpm uses relative symlinks under node_modules to point at workspace
# packages, so we need both the link tree and the link targets in the runtime
# image. Copying node_modules from `build` (rather than `deps`) preserves the
# version of the link tree that points at the built workspace packages.
COPY --from=build /app/node_modules/ node_modules/

COPY --from=build /app/packages/core/dist/ packages/core/dist/
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/drizzle/ packages/core/drizzle/
COPY --from=build /app/packages/core/node_modules/ packages/core/node_modules/

COPY --from=build /app/packages/agent/dist/ packages/agent/dist/
COPY --from=build /app/packages/agent/package.json packages/agent/package.json
COPY --from=build /app/packages/agent/node_modules/ packages/agent/node_modules/

COPY --from=build /app/packages/workspace/package.json packages/workspace/package.json
COPY --from=build /app/packages/workspace/dist/ packages/workspace/dist/
COPY --from=build /app/packages/workspace/node_modules/ packages/workspace/node_modules/

COPY --from=build /app/apps/full-app/dist/ apps/full-app/dist/
COPY --from=build /app/apps/full-app/package.json apps/full-app/package.json
COPY --from=build /app/apps/full-app/node_modules/ apps/full-app/node_modules/

ENV NODE_ENV=production \
  BORING_AGENT_MODE=vercel-sandbox \
  BORING_AGENT_WORKSPACE_ROOT=/data/workspaces
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

CMD ["node", "apps/full-app/dist/server/main.js"]

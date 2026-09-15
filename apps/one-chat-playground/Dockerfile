# Build from the boring-ui-v2 repository root:
#   docker build -f apps/one-chat-playground/Dockerfile .
FROM node:22-bookworm AS build

WORKDIR /app
# The non-slim build image includes Python, make, and a C++ compiler for
# better-sqlite3. Corepack installs the repository-pinned pnpm version.
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter one-chat-playground run build:deps
RUN pnpm --filter one-chat-playground run typecheck

# The editable app is intentionally a separate pnpm project. Install it here so
# its better-sqlite3 native addon is compiled for the image's Node/Linux ABI.
RUN pnpm --dir apps/one-chat-playground/template-app install --frozen-lockfile

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ARG REVISION=unknown
ARG SOURCE=https://github.com/hachej/boring-ui
LABEL org.opencontainers.image.source=$SOURCE \
  org.opencontainers.image.revision=$REVISION \
  org.opencontainers.image.title="Boring UI One Chat playground"

RUN corepack enable \
  && groupadd --system --gid 10001 boring \
  && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/boring boring \
  && mkdir -p /data/one-chat/workspaces /data/one-chat/sessions \
  && chown -R boring:boring /data/one-chat /home/boring

# Dev mode is deliberate for the tester rollout: the front and editable app
# both use Vite so edits made by the agent appear immediately. Keep the source,
# workspace links, built package artifacts, and both dependency trees together.
COPY --from=build --chown=boring:boring /app /app
COPY --chown=boring:boring apps/one-chat-playground/deploy/entrypoint.sh /usr/local/bin/one-chat-entrypoint
RUN chmod 0755 /usr/local/bin/one-chat-entrypoint

ENV NODE_ENV=development \
  HOST=0.0.0.0 \
  HOME=/home/boring \
  ONE_CHAT_PORT=5320 \
  ONE_CHAT_APP_PROXY_PORT=5321 \
  SAMPLE_APP_PORT=5322 \
  ONE_CHAT_APP_BASE=/app/ \
  ONE_CHAT_WORKSPACE_ROOT=/data/one-chat/workspaces/app \
  ONE_CHAT_TEMPLATE_ROOT=/app/apps/one-chat-playground/template-app \
  BORING_AGENT_SESSION_ROOT=/data/one-chat/sessions

VOLUME ["/data/one-chat/workspaces", "/data/one-chat/sessions"]
EXPOSE 5320 5321

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "Promise.all(['http://127.0.0.1:5320/health','http://127.0.0.1:5321/'].map(u=>fetch(u))).then(rs=>{if(rs.some(r=>!r.ok))throw Error('unhealthy')}).catch(()=>process.exit(1))"

USER boring
ENTRYPOINT ["/usr/local/bin/one-chat-entrypoint"]
CMD ["pnpm", "--filter", "one-chat-playground", "dev:app"]

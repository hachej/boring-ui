# boring-ui TS server: Node.js backend + built frontend
# Single Dockerfile for the TypeScript server migration.
#
# Required system packages for bwrap workspace sandboxes:
# - bubblewrap: exec isolation
# - python3 + python3-venv: workspace .venv creation inside sandbox
# - git: workspace git operations
# - jq, ripgrep, tree, curl: developer toolchain inside sandbox

ARG GIT_SHA=unknown

# Stage 1: Build frontend assets
FROM node:20-slim AS frontend-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY src/front ./src/front
COPY src/pi_service ./src/pi_service
COPY index.html vite.config.ts tailwind.config.js ./
COPY boring.app.toml ./boring.app.toml
RUN npx vite build

# Stage 2: Runtime
FROM node:20-slim

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.title="boring-ui-ts" \
      git_sha="${GIT_SHA}"

ENV NODE_ENV=production \
    BORING_UI_STATIC_DIR=/app/dist

WORKDIR /app

# System packages for bwrap sandbox and developer toolchain
RUN apt-get update && apt-get install -y --no-install-recommends \
    bubblewrap \
    curl \
    git \
    jq \
    python3 \
    python3-venv \
    ripgrep \
    tree \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies + tsx (needed for TS server startup)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx

# Server source
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY tsconfig.server.json ./

# Frontend static files from build stage
COPY --from=frontend-build /build/dist ./dist

EXPOSE 8000

CMD ["npx", "tsx", "src/server/index.ts"]

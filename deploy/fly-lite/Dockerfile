# boring-ui-lite: browser agent + thin exec endpoint
# No Node.js runtime needed — only used at build time for Vite.

# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY src/front ./src/front
COPY src/pi_service ./src/pi_service
COPY index.html vite.config.ts tailwind.config.js ./
COPY deploy/fly-lite/boring.app.toml ./boring.app.toml
RUN npx vite build

# Stage 2: Runtime with dev toolchain
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PYTHONPATH=/app/src/back \
    BORING_UI_STATIC_DIR=/app/dist

WORKDIR /app

# System packages + Node.js 20 (needed inside workspace sandboxes)
RUN apt-get update && apt-get install -y --no-install-recommends \
    bubblewrap \
    curl \
    git \
    jq \
    make \
    ripgrep \
    tree \
    unzip \
    wget \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
COPY README.md ./
COPY src/back ./src/back
COPY scripts ./scripts
COPY deploy/fly-lite/boring.app.toml ./boring.app.toml

RUN uv sync --frozen --no-dev

# Frontend static files from build stage
COPY --from=frontend-build /build/dist ./dist

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "boring_ui.runtime:app", "--host", "0.0.0.0", "--port", "8000"]

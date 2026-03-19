FROM golang:1.24-bookworm AS bui-build

WORKDIR /src/bui

COPY bui/go.mod bui/go.sum ./
RUN go mod download

COPY bui/ ./

ARG TARGETOS=linux
ARG TARGETARCH=amd64
ENV CGO_ENABLED=0

RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/bui .

FROM python:3.12-slim AS nsjail-build

ARG NSJAIL_REF=aac377c7d3145635702b982f831bd4a0d5ad69af

RUN apt-get update && apt-get install -y --no-install-recommends \
    autoconf \
    bison \
    flex \
    g++ \
    gcc \
    git \
    libnl-route-3-dev \
    libprotobuf-dev \
    libtool \
    make \
    pkg-config \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/nsjail

RUN git clone https://github.com/google/nsjail.git . \
    && git checkout "${NSJAIL_REF}" \
    && git submodule update --init --recursive \
    && make -j"$(nproc)"

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/boring \
    PYTHONPATH=/app/src/back \
    PATH=/opt/boring/bin:/app/.venv/bin:/usr/local/bin:/usr/bin:/bin \
    BUI_APP_TOML=/app/boring.app.toml \
    BORING_UI_STATIC_DIR=/app/dist

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    libcap2-bin \
    libnl-route-3-200 \
    libprotobuf32 \
    nodejs \
    npm \
    ripgrep \
    tini \
    tree \
    && rm -rf /var/lib/apt/lists/*

COPY --from=nsjail-build /tmp/nsjail/nsjail /usr/local/bin/nsjail
COPY --from=bui-build /out/bui /opt/boring/bin/bui

RUN chmod 4755 /usr/local/bin/nsjail \
    && chmod 0755 /opt/boring/bin/bui \
    && mkdir -p /data/workspaces /opt/boring/bin

RUN pip install --no-cache-dir uv

COPY . .

RUN uv sync --frozen --no-dev --extra sandbox \
    && npm ci \
    && npm run build

RUN mkdir -p /home/boring /data/workspaces \
    && chown -R 10001:10001 /app /data/workspaces /home/boring

USER 10001:10001

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "uvicorn", "boring_ui.app_config_loader:app", "--host", "0.0.0.0", "--port", "8000"]

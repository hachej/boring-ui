FROM golang@sha256:8bee1901f1e530bfb4a7850aa7a479d17ae3a18beb6e09064ed54cfd245b7191 AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/boring-runtime ./cmd/boring-runtime

FROM alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
RUN mkdir -p /opt/boring/bin /workspace && chown -R 65532:65532 /opt/boring /workspace
COPY --from=build --chown=65532:65532 /out/boring-runtime /opt/boring/bin/boring-runtime
USER 65532:65532
WORKDIR /workspace
CMD ["/opt/boring/bin/boring-runtime", "supervise"]

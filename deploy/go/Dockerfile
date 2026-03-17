FROM golang:1.24-alpine AS build

WORKDIR /src

RUN apk add --no-cache ca-certificates git

COPY go.mod go.sum ./
RUN go mod download

COPY boring.app.toml ./
COPY boringui.go public.go ./
COPY cmd/server ./cmd/server
COPY internal ./internal

ARG TARGETOS=linux
ARG TARGETARCH=amd64
ENV CGO_ENABLED=0

RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/boring-ui ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /out/boring-ui /boring-ui
COPY --from=build /src/boring.app.toml /app/boring.app.toml

ENV BUI_APP_TOML=/app/boring.app.toml \
    BORING_HOST=0.0.0.0 \
    BORING_PORT=8000

EXPOSE 8000

ENTRYPOINT ["/boring-ui"]

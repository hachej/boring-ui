# Transcription compute lifecycle daemon

This root-owned, loopback-only service leases an on-demand GPU to the live-transcription plugin. It is provider-specific at the host boundary; browser and plugin lifecycle code use the provider-neutral lease API.

## Safety model

- Listens only on `127.0.0.1` and requires a bearer token.
- Rejects requests with a browser `Origin` header.
- Exoscale credentials remain in root's Exoscale profile; they are never passed to Boring UI.
- Starts only after `/live start` or composer dictation requests a lease.
- Requires authenticated WebSocket readiness from **both** Kyutai and Sortformer before granting a lease.
- Uses 30-second app heartbeats and 90-second lease expiry.
- Stops after the final lease plus a three-minute idle grace.
- Reconciles a stranded running instance after daemon/app crashes.
- Retries stop and verifies provider state is `stopped`.
- Enforces a hard runtime (default four hours).

## Installation

Install `daemon.py` root-owned (mode `0755`) under `/opt/boring-gpu-lifecycle/`. Put secrets in `/etc/boring-gpu-lifecycle.env` (mode `0600`):

```sh
BORING_GPU_LIFECYCLE_BEARER_TOKEN=<random 32+ byte token>
BORING_GPU_READY_WEBSOCKETS=ws://127.0.0.1:18880/api/asr-streaming,ws://127.0.0.1:18881/v1/diarize
BORING_GPU_READY_AUTH_JSON=[{"header":"kyutai-api-key","value":"<kyutai token>"},{"header":"Authorization","value":"Bearer <sortformer token>"}]
```

Configure Clinic with the same lifecycle token in its root-owned environment file:

```sh
BORING_LIVE_TRANSCRIPTS_LIFECYCLE_URL=http://127.0.0.1:18882/v1
BORING_LIVE_TRANSCRIPTS_LIFECYCLE_BEARER_TOKEN=<same lifecycle token>
```

Example systemd unit:

```ini
[Unit]
Description=Boring transcription GPU lifecycle
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
EnvironmentFile=/etc/boring-gpu-lifecycle.env
ExecStart=/usr/bin/python3 /opt/boring-gpu-lifecycle/daemon.py \
  --instance-id 72974288-5e6b-4632-891d-14f60c58e0cb \
  --zone at-vie-2 \
  --idle-grace 180 \
  --max-runtime 15000
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
```

`--max-runtime` should be slightly greater than the application's maximum capture duration. Keep the existing manual instance/tunnel controls available as rollback. The SSH tunnel may retry harmlessly while the instance is stopped; the lifecycle service's readiness checks prevent a lease until both forwarded upstreams authenticate successfully.

## Tests

```sh
python3 -m unittest test_daemon.py
python3 -m py_compile daemon.py
```

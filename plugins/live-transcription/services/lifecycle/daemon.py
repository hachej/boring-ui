#!/usr/bin/env python3
"""Loopback-only renewable lease daemon for on-demand transcription compute."""
from __future__ import annotations

import argparse
import hmac
import json
import os
import secrets
import subprocess
import threading
import time
import urllib.parse
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable


@dataclass
class Lease:
    lease_id: str
    request_id: str
    expires_at: float
    created_at: float


class ExoscaleProvider:
    def __init__(self, exo_bin: str, instance_id: str, zone: str):
        self.exo_bin, self.instance_id, self.zone = exo_bin, instance_id, zone

    def state(self) -> str:
        result = subprocess.run(
            [self.exo_bin, "compute", "instance", "show", self.instance_id, "--zone", self.zone, "-O", "json"],
            check=True, capture_output=True, text=True, timeout=30,
        )
        return str(json.loads(result.stdout).get("state", "unknown")).lower()

    def start(self) -> None:
        self._request_transition("start")

    def stop(self) -> None:
        self._request_transition("stop")

    def _request_transition(self, action: str) -> None:
        try:
            subprocess.run(
                [self.exo_bin, "compute", "instance", action, self.instance_id, "--zone", self.zone, "--force"],
                check=True, capture_output=True, text=True, timeout=20,
            )
        except subprocess.TimeoutExpired:
            # exo waits for the asynchronous operation to finish. The request has
            # already been accepted; state polling below is the source of truth.
            return


class LeaseController:
    def __init__(self, provider: ExoscaleProvider, ready: Callable[[], bool], *, lease_ttl: float = 90,
                 idle_grace: float = 180, max_runtime: float = 4 * 3600, ready_timeout: float = 600):
        self.provider, self.ready = provider, ready
        self.lease_ttl, self.idle_grace = lease_ttl, idle_grace
        self.max_runtime, self.ready_timeout = max_runtime, ready_timeout
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.leases: dict[str, Lease] = {}
        self.requests: dict[str, str] = {}
        self.starting = False
        self.started_at: float | None = None
        self.stop_after: float | None = None
        self.closed = False
        self.worker = threading.Thread(target=self._sweep, daemon=True)
        self.worker.start()

    def acquire(self, request_id: str) -> Lease:
        if not request_id or len(request_id) > 200:
            raise ValueError("invalid requestId")
        with self.condition:
            existing_id = self.requests.get(request_id)
            if existing_id and existing_id in self.leases:
                lease = self.leases[existing_id]
                lease.expires_at = time.monotonic() + self.lease_ttl
                return lease
            while self.starting:
                self.condition.wait(timeout=1)
            if self.provider.state() == "running" and self.ready():
                return self._new_lease(request_id)
            self.starting = True
            self.stop_after = None
        try:
            if self.provider.state() == "stopped":
                self.provider.start()
            deadline = time.monotonic() + self.ready_timeout
            while time.monotonic() < deadline:
                if self.provider.state() == "running" and self.ready():
                    with self.condition:
                        self.started_at = self.started_at or time.monotonic()
                        return self._new_lease(request_id)
                time.sleep(2)
            raise RuntimeError("transcription compute readiness timed out")
        finally:
            with self.condition:
                self.starting = False
                if not self.leases and self.stop_after is None:
                    self.stop_after = time.monotonic() + self.idle_grace
                self.condition.notify_all()

    def heartbeat(self, lease_id: str) -> None:
        with self.lock:
            lease = self.leases.get(lease_id)
            if not lease:
                raise KeyError("lease not found")
            if self.started_at is not None and time.monotonic() - self.started_at > self.max_runtime:
                raise RuntimeError("maximum compute runtime exceeded")
            lease.expires_at = time.monotonic() + self.lease_ttl

    def release(self, lease_id: str) -> None:
        with self.lock:
            lease = self.leases.pop(lease_id, None)
            if lease:
                self.requests.pop(lease.request_id, None)
            if not self.leases:
                self.stop_after = time.monotonic() + self.idle_grace

    def close(self) -> None:
        self.closed = True
        self.worker.join(timeout=2)

    def _new_lease(self, request_id: str) -> Lease:
        now = time.monotonic()
        lease = Lease(secrets.token_urlsafe(32), request_id, now + self.lease_ttl, now)
        self.leases[lease.lease_id] = lease
        self.requests[request_id] = lease.lease_id
        self.stop_after = None
        self.started_at = self.started_at or now
        return lease

    def _sweep(self) -> None:
        # Crash reconciliation: a running provider with no recovered leases is stopped after grace.
        with self.lock:
            self.stop_after = time.monotonic() + self.idle_grace
        while not self.closed:
            time.sleep(2)
            now = time.monotonic()
            should_stop = False
            with self.lock:
                hard_limit_reached = self.started_at is not None and now - self.started_at > self.max_runtime
                for lease_id, lease in list(self.leases.items()):
                    if lease.expires_at <= now or hard_limit_reached:
                        self.leases.pop(lease_id, None)
                        self.requests.pop(lease.request_id, None)
                if hard_limit_reached:
                    self.stop_after = now
                if not self.leases and self.stop_after is None:
                    self.stop_after = now + self.idle_grace
                should_stop = not self.starting and not self.leases and self.stop_after is not None and now >= self.stop_after
                if should_stop:
                    self.stop_after = now + 30
            if should_stop:
                self._stop_until_verified()

    def _stop_until_verified(self) -> None:
        delay = 2
        for _ in range(6):
            try:
                if self.provider.state() == "stopped":
                    with self.lock:
                        self.started_at = None
                        self.stop_after = None
                    return
                self.provider.stop()
                if self.provider.state() == "stopped":
                    with self.lock:
                        self.started_at = None
                        self.stop_after = None
                    return
            except Exception as error:
                print(f"lifecycle stop attempt failed: {error}", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 30)


class ApiHandler(BaseHTTPRequestHandler):
    controller: LeaseController
    bearer_token: str

    def do_POST(self) -> None:
        if self.headers.get("Origin"):
            return self._send(403, {"error": "browser origins are forbidden"})
        supplied = self.headers.get("Authorization", "")
        if not hmac.compare_digest(supplied, f"Bearer {self.bearer_token}"):
            return self._send(401, {"error": "unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 4096:
                return self._send(413, {"error": "request too large"})
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/v1/leases/acquire":
                lease = self.controller.acquire(str(body.get("requestId", "")))
                return self._send(200, {"id": lease.lease_id})
            if self.path == "/v1/leases/heartbeat":
                self.controller.heartbeat(str(body.get("leaseId", "")))
                return self._send(200, {"ok": True})
            if self.path == "/v1/leases/release":
                self.controller.release(str(body.get("leaseId", "")))
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})
        except KeyError as error:
            return self._send(404, {"error": str(error)})
        except ValueError as error:
            return self._send(400, {"error": str(error)})
        except Exception as error:
            print(f"lifecycle request failed: {error}", flush=True)
            return self._send(503, {"error": "compute lifecycle operation failed"})

    def _send(self, status: int, payload: dict) -> None:
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"lifecycle api: {fmt % args}", flush=True)


def tcp_ready_targets(raw_targets: str, auth_entries: list[dict[str, str]]) -> Callable[[], bool]:
    import base64
    import socket
    targets = [urllib.parse.urlparse(item.strip()) for item in raw_targets.split(",") if item.strip()]
    if len(targets) < 2:
        raise ValueError("Kyutai and Sortformer authenticated readiness targets are required")
    if len(targets) != len(auth_entries):
        raise ValueError("readiness target/auth count mismatch")
    for auth in auth_entries:
        if auth.get("header", "").lower() not in {"authorization", "kyutai-api-key"} or not auth.get("value"):
            raise ValueError("invalid readiness authentication entry")
        if any(character in auth["value"] for character in "\r\n"):
            raise ValueError("invalid readiness authentication value")

    def ready() -> bool:
        for target, auth in zip(targets, auth_entries):
            if target.scheme != "ws" or target.hostname not in {"127.0.0.1", "localhost", "::1"} or not target.port:
                return False
            key = base64.b64encode(os.urandom(16)).decode()
            path = target.path + (("?" + target.query) if target.query else "")
            request = (f"GET {path} HTTP/1.1\r\nHost: {target.hostname}:{target.port}\r\nUpgrade: websocket\r\n"
                       f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                       f"{auth['header']}: {auth['value']}\r\n\r\n").encode()
            try:
                with socket.create_connection((target.hostname, target.port), timeout=3) as connection:
                    connection.sendall(request)
                    response = connection.recv(1024)
                if not response.startswith(b"HTTP/1.1 101"):
                    return False
            except OSError:
                return False
        return True
    return ready


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen", default="127.0.0.1:18882")
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--zone", required=True)
    parser.add_argument("--exo-bin", default="/usr/local/bin/exo")
    parser.add_argument("--idle-grace", type=float, default=180)
    parser.add_argument("--max-runtime", type=float, default=4 * 3600)
    args = parser.parse_args()
    host, port_text = args.listen.rsplit(":", 1)
    if host not in {"127.0.0.1", "::1"}:
        raise SystemExit("lifecycle daemon must bind to loopback")
    token = os.environ["BORING_GPU_LIFECYCLE_BEARER_TOKEN"]
    ready_targets = os.environ["BORING_GPU_READY_WEBSOCKETS"]
    ready_auth = json.loads(os.environ["BORING_GPU_READY_AUTH_JSON"])
    controller = LeaseController(
        ExoscaleProvider(args.exo_bin, args.instance_id, args.zone),
        tcp_ready_targets(ready_targets, ready_auth),
        idle_grace=args.idle_grace,
        max_runtime=args.max_runtime,
    )
    ApiHandler.controller = controller
    ApiHandler.bearer_token = token
    server = ThreadingHTTPServer((host, int(port_text)), ApiHandler)
    try:
        server.serve_forever()
    finally:
        controller.close()


if __name__ == "__main__":
    main()

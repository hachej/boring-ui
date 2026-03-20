"""Node.js PI sidecar harness and route proxy."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any, AsyncIterator, Callable

import httpx
import jwt as pyjwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from ..config import APIConfig
from ..middleware.request_id import ensure_request_id
from ..workspace import WorkspaceContext, build_workspace_context_resolver, resolve_workspace_context
from .harness import AgentHarness, HarnessHealth, SessionInfo, SessionRequest

logger = logging.getLogger(__name__)
_LOCAL_WORKSPACE_HEADER = "x-boring-local-workspace"
_PI_READY_TIMEOUT_SECONDS = 10.0
_PI_READY_POLL_INTERVAL_SECONDS = 0.1


def _create_workspace_token(workspace_id: str, *, secret: str, ttl_seconds: int = 300) -> str:
    now = int(time.time())
    payload = {"workspace_id": str(workspace_id).strip(), "scope": "workspace.exec", "iat": now, "exp": now + ttl_seconds}
    return pyjwt.encode(payload, secret, algorithm="HS256")


class PiHarness(AgentHarness):
    """Manage the PI sidecar process and proxy its HTTP surface."""

    def __init__(
        self,
        config: APIConfig,
        *,
        host: str = "127.0.0.1",
        port: int | None = None,
        command: tuple[str, ...] | None = None,
        healthcheck_interval: float = 5.0,
        max_restart_backoff: float = 30.0,
        client_factory: Callable[[], httpx.AsyncClient] | None = None,
    ) -> None:
        agent_config = config.agents.get("pi")
        configured_command = tuple(agent_config.command) if agent_config is not None else ()

        self.config = config
        self.host = host
        self.port = port or (agent_config.port if agent_config is not None else None) or 8789
        self.command = tuple(command or configured_command or self._default_command())
        self.healthcheck_interval = healthcheck_interval
        self.max_restart_backoff = max_restart_backoff
        self._client_factory = client_factory or self._default_client
        self._router = self._build_router()
        self._process: asyncio.subprocess.Process | None = None
        self._monitor_task: asyncio.Task[None] | None = None
        self._stopping = False
        self._restart_backoff = 1.0
        self._started = False
        self._start_lock = asyncio.Lock()
        self._ever_ready = False

    @property
    def name(self) -> str:
        return "pi"

    @property
    def ever_ready(self) -> bool:
        """True once the sidecar has been proven healthy at least once."""
        return self._ever_ready

    def routes(self) -> list[APIRouter]:
        return [self._router]

    async def start(self) -> None:
        if self._started:
            return
        if self._monitor_task is not None and not self._monitor_task.done():
            return

        self._stopping = False
        self._started = True
        await self._spawn_process()
        self._monitor_task = asyncio.create_task(self._monitor_loop(), name="pi-harness-monitor")

    async def ensure_started(self) -> None:
        """Start the sidecar on first use if not already running."""
        if self._started:
            return
        async with self._start_lock:
            if not self._started:
                await self.start()

    async def ensure_ready(
        self,
        *,
        timeout: float = _PI_READY_TIMEOUT_SECONDS,
        poll_interval: float = _PI_READY_POLL_INTERVAL_SECONDS,
    ) -> None:
        """Block until the sidecar is healthy, or fail fast with context."""
        await self.ensure_started()
        deadline = time.monotonic() + timeout
        last_detail = "pi sidecar not ready"

        while True:
            health = await self.healthy()
            if health.ok:
                probe = await self._probe_ready()
                if probe.ok:
                    self._restart_backoff = 1.0
                    self._ever_ready = True
                    return
                last_detail = probe.detail or last_detail
            else:
                last_detail = health.detail or last_detail

            process = self._process
            if process is None or process.returncode is not None:
                await self._restart(last_detail)

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise HTTPException(status_code=503, detail=last_detail)
            await self._sleep(min(poll_interval, remaining))

    async def stop(self) -> None:
        self._stopping = True
        self._started = False

        if self._monitor_task is not None:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
            self._monitor_task = None

        await self._terminate_process()

    async def healthy(self) -> HarnessHealth:
        process = self._process
        if process is None:
            return HarnessHealth(ok=False, detail="pi sidecar not started")
        if process.returncode is not None:
            return HarnessHealth(
                ok=False,
                detail=f"pi sidecar exited with code {process.returncode}",
                metadata={"returncode": process.returncode},
            )

        try:
            async with self._client_factory() as client:
                response = await client.get(self._service_url("/health"), timeout=5.0)
                payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
        except httpx.HTTPError as exc:
            return HarnessHealth(ok=False, detail=str(exc))

        if response.status_code != 200:
            return HarnessHealth(
                ok=False,
                detail=f"pi health returned {response.status_code}",
                metadata={"status_code": response.status_code},
            )

        if payload.get("status") != "ok":
            return HarnessHealth(ok=False, detail="pi health payload not ok", metadata=payload)

        return HarnessHealth(ok=True, metadata=payload)

    async def _probe_ready(self) -> HarnessHealth:
        """Verify a real PI route is accepting requests before proxying."""
        try:
            async with self._client_factory() as client:
                response = await client.get(self._service_url("/api/v1/agent/pi/sessions"), timeout=5.0)
        except httpx.HTTPError as exc:
            return HarnessHealth(ok=False, detail=str(exc))

        if response.status_code != 200:
            return HarnessHealth(
                ok=False,
                detail=f"pi readiness probe returned {response.status_code}",
                metadata={"status_code": response.status_code},
            )
        return HarnessHealth(ok=True)

    async def create_session(self, ctx: WorkspaceContext, req: SessionRequest) -> SessionInfo:
        payload = req.metadata or {}
        response = await self._json_request(
            "POST",
            "/api/v1/agent/pi/sessions/create",
            ctx=ctx,
            json=payload,
        )
        session = response.get("session") or {}
        return SessionInfo(
            session_id=str(session.get("id", "")),
            agent_name=self.name,
            workspace_id=ctx.workspace_id,
            metadata=session,
        )

    async def stream(self, ctx: WorkspaceContext, session_id: str) -> AsyncIterator[Any]:
        await self.ensure_ready()
        request = httpx.Request(
            "POST",
            self._service_url(f"/api/v1/agent/pi/sessions/{session_id}/stream"),
            headers=self._proxy_headers(ctx, request_id="pi-harness-stream"),
            json={},
        )
        client = self._client_factory()
        response = await client.send(request, stream=True)
        try:
            async for chunk in response.aiter_text():
                if chunk:
                    yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    async def send_user_message(
        self,
        ctx: WorkspaceContext,
        session_id: str,
        message: str,
    ) -> None:
        await self.ensure_ready()
        async with self._client_factory() as client:
            await client.post(
                self._service_url(f"/api/v1/agent/pi/sessions/{session_id}/stream"),
                json={"message": message},
                headers=self._proxy_headers(ctx, request_id="pi-harness-message"),
            )

    async def terminate_session(self, ctx: WorkspaceContext, session_id: str) -> None:
        await self.ensure_ready()
        async with self._client_factory() as client:
            await client.post(
                self._service_url(f"/api/v1/agent/pi/sessions/{session_id}/stop"),
                json={},
                headers=self._proxy_headers(ctx, request_id="pi-harness-stop"),
            )

    async def _json_request(
        self,
        method: str,
        path: str,
        *,
        ctx: WorkspaceContext,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        await self.ensure_ready()
        async with self._client_factory() as client:
            response = await client.request(
                method,
                self._service_url(path),
                json=json,
                headers=self._proxy_headers(ctx, request_id="pi-harness-json"),
            )
            response.raise_for_status()
            return response.json()

    async def _monitor_loop(self) -> None:
        try:
            while not self._stopping:
                await self._sleep(self.healthcheck_interval)
                await self._monitor_once()
        except asyncio.CancelledError:
            raise

    async def _monitor_once(self) -> None:
        if self._stopping:
            return

        process = self._process
        if process is None or process.returncode is not None:
            await self._restart(f"pi sidecar exited (code={getattr(process, 'returncode', '?')})")
            return

        health = await self.healthy()
        if health.ok:
            self._restart_backoff = 1.0
            return
        await self._restart(health.detail or "pi sidecar unhealthy")

    async def _restart(self, reason: str) -> None:
        delay = self._restart_backoff
        logger.warning("Restarting pi sidecar after %s (delay=%ss)", reason, delay)
        await self._terminate_process()
        await self._sleep(delay)
        self._restart_backoff = min(delay * 2, self.max_restart_backoff)
        await self._spawn_process()

    async def _drain_stderr(self) -> None:
        """Read stderr from sidecar process to prevent buffer deadlock."""
        process = self._process
        if process is None or process.stderr is None:
            return
        try:
            async for line in process.stderr:
                logger.warning("pi sidecar: %s", line.decode(errors="replace").rstrip())
        except Exception:
            pass

    async def _spawn_process(self) -> None:
        if self._process is not None and self._process.returncode is None:
            return

        self._process = await asyncio.create_subprocess_exec(
            *self.command,
            cwd=str(self._repo_root()),
            env=self._process_env(),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=(os.name != "nt"),
        )
        self._restart_backoff = 1.0
        # Drain stderr in background to prevent pipe buffer deadlock
        asyncio.create_task(self._drain_stderr(), name="pi-stderr-drain")

    async def _terminate_process(self) -> None:
        process = self._process
        if process is None:
            return
        self._process = None
        if process.returncode is not None:
            return

        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), timeout=5)
        except (ProcessLookupError, asyncio.TimeoutError):
            try:
                process.kill()
                await process.wait()
            except ProcessLookupError:
                pass

    async def _sleep(self, delay: float) -> None:
        await asyncio.sleep(delay)

    def _service_url(self, path: str) -> str:
        return f"http://{self.host}:{self.port}{path}"

    def _default_command(self) -> tuple[str, ...]:
        node = shutil.which("node") or "/usr/bin/node"
        return (node, str(self._repo_root() / "src/pi_service/server.mjs"))

    def _repo_root(self) -> Path:
        return Path(__file__).resolve().parents[5]

    def _process_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env.setdefault("PI_SERVICE_HOST", self.host)
        env["PI_SERVICE_PORT"] = str(self.port)
        # Use PORT env var if set (uvicorn convention), otherwise fall back to 8000
        backend_port = os.environ.get("PORT", "8000")
        env.setdefault("BORING_BACKEND_URL", f"http://127.0.0.1:{backend_port}")

        agent_config = self.config.agents.get("pi")
        if agent_config is not None:
            env.update({key: str(value) for key, value in agent_config.env.items()})
        return env

    def _default_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=None)

    def _proxy_headers(self, ctx: WorkspaceContext, request_id: str) -> dict[str, str]:
        headers = {
            "x-request-id": request_id,
            "x-boring-workspace-root": str(ctx.root_path),
        }
        if ctx.workspace_id:
            token = _create_workspace_token(
                ctx.workspace_id,
                secret=self.config.internal_api_token,
            )
            headers["x-boring-internal-token"] = token
            headers["authorization"] = f"Bearer {token}"
            headers["x-workspace-id"] = ctx.workspace_id
        return headers

    @staticmethod
    async def _close_stream(response: httpx.Response, client: httpx.AsyncClient) -> None:
        await response.aclose()
        await client.aclose()

    def _build_router(self) -> APIRouter:
        router = APIRouter(tags=["agent-pi"])
        local_workspace_resolver = build_workspace_context_resolver(
            self.config,
            single_mode=True,
        )

        async def _workspace_context(request: Request) -> WorkspaceContext:
            local_workspace = str(request.headers.get(_LOCAL_WORKSPACE_HEADER, "")).strip().lower()
            workspace_id = str(request.headers.get("x-workspace-id", "")).strip() or None
            if local_workspace in {"1", "true", "yes", "on"} and workspace_id:
                return local_workspace_resolver.resolve(workspace_id)
            return await resolve_workspace_context(request, config=self.config)

        async def _proxy_response(
            request: Request,
            upstream_path: str,
            *,
            ctx: WorkspaceContext,
        ) -> Response:
            await self.ensure_ready()
            request_id = ensure_request_id(request)
            body = await request.body()
            headers = self._proxy_headers(ctx, request_id)
            content_type = request.headers.get("content-type")
            if content_type:
                headers["content-type"] = content_type

            last_error: httpx.HTTPError | None = None
            for attempt in range(2):
                try:
                    async with self._client_factory() as client:
                        upstream = await client.request(
                            request.method,
                            self._service_url(upstream_path),
                            content=body or None,
                            headers=headers,
                        )
                    passthrough_headers = {
                        key: value
                        for key, value in upstream.headers.items()
                        if key.lower() in {"cache-control", "content-type"}
                    }
                    return Response(
                        content=upstream.content,
                        status_code=upstream.status_code,
                        headers=passthrough_headers,
                    )
                except httpx.HTTPError as exc:
                    last_error = exc
                    if attempt >= 1:
                        raise
                    logger.warning("pi proxy request failed for %s, restarting sidecar: %s", upstream_path, exc)
                    await self._restart(f"proxy request failed for {upstream_path}: {exc}")
                    await self.ensure_ready()
            if last_error is not None:
                raise last_error
            raise RuntimeError("pi proxy request failed without an upstream error")

        async def _proxy_stream(
            request: Request,
            upstream_path: str,
            *,
            ctx: WorkspaceContext,
        ) -> StreamingResponse:
            await self.ensure_ready()
            request_id = ensure_request_id(request)
            body = await request.body()
            headers = self._proxy_headers(ctx, request_id)
            content_type = request.headers.get("content-type")
            if content_type:
                headers["content-type"] = content_type

            last_error: httpx.HTTPError | None = None
            for attempt in range(2):
                client = self._client_factory()
                try:
                    upstream_request = client.build_request(
                        request.method,
                        self._service_url(upstream_path),
                        content=body or None, headers=headers,
                    )
                    upstream = await client.send(upstream_request, stream=True)
                    passthrough_headers = {
                        key: value
                        for key, value in upstream.headers.items()
                        if key.lower() in {"cache-control", "content-type"}
                    }
                    return StreamingResponse(
                        upstream.aiter_bytes(),
                        status_code=upstream.status_code,
                        headers=passthrough_headers,
                        background=BackgroundTask(self._close_stream, upstream, client),
                    )
                except httpx.HTTPError as exc:
                    last_error = exc
                    await client.aclose()
                    if attempt >= 1:
                        raise
                    logger.warning("pi proxy stream failed for %s, restarting sidecar: %s", upstream_path, exc)
                    await self._restart(f"proxy stream failed for {upstream_path}: {exc}")
                    await self.ensure_ready()
            if last_error is not None:
                raise last_error
            raise RuntimeError("pi proxy stream failed without an upstream error")

        def _add_proxy_route(path: str, endpoint, methods: list[str]) -> None:
            router.add_api_route(path, endpoint, methods=methods)
            # Don't register /w/{workspace_id} routes — the boundary router
            # handles workspace-scoped requests and fly-replays them to the
            # workspace Machine, where PiHarness serves them at the base path.

        async def list_sessions(
            request: Request,
            ctx: WorkspaceContext = Depends(_workspace_context),
        ) -> Response:
            return await _proxy_response(request, "/api/v1/agent/pi/sessions", ctx=ctx)

        async def create_session_route(
            request: Request,
            ctx: WorkspaceContext = Depends(_workspace_context),
        ) -> Response:
            return await _proxy_response(request, "/api/v1/agent/pi/sessions/create", ctx=ctx)

        async def session_history(
            request: Request,
            session_id: str,
            ctx: WorkspaceContext = Depends(_workspace_context),
        ) -> Response:
            return await _proxy_response(
                request,
                f"/api/v1/agent/pi/sessions/{session_id}/history",
                ctx=ctx,
            )

        async def stop_session(
            request: Request,
            session_id: str,
            ctx: WorkspaceContext = Depends(_workspace_context),
        ) -> Response:
            return await _proxy_response(
                request,
                f"/api/v1/agent/pi/sessions/{session_id}/stop",
                ctx=ctx,
            )

        async def stream_session(
            request: Request,
            session_id: str,
            ctx: WorkspaceContext = Depends(_workspace_context),
        ) -> StreamingResponse:
            return await _proxy_stream(
                request,
                f"/api/v1/agent/pi/sessions/{session_id}/stream",
                ctx=ctx,
            )

        _add_proxy_route("/api/v1/agent/pi/sessions", list_sessions, ["GET"])
        _add_proxy_route("/api/v1/agent/pi/sessions/create", create_session_route, ["POST"])
        _add_proxy_route("/api/v1/agent/pi/sessions/{session_id}/history", session_history, ["GET"])
        _add_proxy_route("/api/v1/agent/pi/sessions/{session_id}/stop", stop_session, ["POST"])
        _add_proxy_route("/api/v1/agent/pi/sessions/{session_id}/stream", stream_session, ["POST"])

        return router


__all__ = ["PiHarness"]

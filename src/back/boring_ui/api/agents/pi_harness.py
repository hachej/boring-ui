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
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from ..config import APIConfig
from ..middleware.request_id import ensure_request_id
from ..workspace import WorkspaceContext, resolve_workspace_context
from .harness import AgentHarness, HarnessHealth, SessionInfo, SessionRequest

logger = logging.getLogger(__name__)


def _create_workspace_token(workspace_id: str, *, secret: str, ttl_seconds: int = 300) -> str:
    now = int(time.time())
    payload = {"workspace_id": str(workspace_id).strip(), "scope": "workspace.sandbox.exec", "iat": now, "exp": now + ttl_seconds}
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

    @property
    def name(self) -> str:
        return "pi"

    def routes(self) -> list[APIRouter]:
        return [self._router]

    async def start(self) -> None:
        if self._monitor_task is not None and not self._monitor_task.done():
            return

        self._stopping = False
        await self._spawn_process()
        self._monitor_task = asyncio.create_task(self._monitor_loop(), name="pi-harness-monitor")

    async def stop(self) -> None:
        self._stopping = True

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
        async with self._client_factory() as client:
            await client.post(
                self._service_url(f"/api/v1/agent/pi/sessions/{session_id}/stream"),
                json={"message": message},
                headers=self._proxy_headers(ctx, request_id="pi-harness-message"),
            )

    async def terminate_session(self, ctx: WorkspaceContext, session_id: str) -> None:
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
            await self._restart("pi sidecar exited")
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

    async def _spawn_process(self) -> None:
        if self._process is not None and self._process.returncode is None:
            return

        self._process = await asyncio.create_subprocess_exec(
            *self.command,
            cwd=str(self._repo_root()),
            env=self._process_env(),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=(os.name != "nt"),
        )
        self._restart_backoff = 1.0

    async def _terminate_process(self) -> None:
        process = self._process
        self._process = None
        if process is None:
            return
        if process.returncode is not None:
            return

        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

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
        env.setdefault("BORING_BACKEND_URL", "http://127.0.0.1:8000")

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

        async def _workspace_context(request: Request) -> WorkspaceContext:
            return await resolve_workspace_context(request, config=self.config)

        async def _proxy_response(
            request: Request,
            upstream_path: str,
            *,
            ctx: WorkspaceContext,
        ) -> Response:
            request_id = ensure_request_id(request)
            body = await request.body()
            headers = self._proxy_headers(ctx, request_id)
            content_type = request.headers.get("content-type")
            if content_type:
                headers["content-type"] = content_type

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

        async def _proxy_stream(
            request: Request,
            upstream_path: str,
            *,
            ctx: WorkspaceContext,
        ) -> StreamingResponse:
            request_id = ensure_request_id(request)
            body = await request.body()
            headers = self._proxy_headers(ctx, request_id)
            content_type = request.headers.get("content-type")
            if content_type:
                headers["content-type"] = content_type

            client = self._client_factory()
            upstream_request = client.build_request(
                request.method,
                self._service_url(upstream_path),
                content=body or None,
                headers=headers,
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

        def _add_proxy_route(path: str, endpoint, methods: list[str]) -> None:
            router.add_api_route(path, endpoint, methods=methods)
            router.add_api_route(f"/w/{{workspace_id}}{path}", endpoint, methods=methods)

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

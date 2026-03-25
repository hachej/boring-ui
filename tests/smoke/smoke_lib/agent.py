"""Agent WebSocket smoke helpers."""
from __future__ import annotations

import asyncio
import json


async def _agent_roundtrip_async(
    ws_url: str,
    *,
    message: str = "Say exactly: SMOKE_OK",
    timeout_seconds: float = 30.0,
    cookies: dict[str, str] | None = None,
) -> dict:
    """Connect to agent WebSocket, send a message, wait for a response frame."""
    loop = asyncio.get_running_loop()
    try:
        import websockets
    except ImportError:
        return {"ok": False, "error": "websockets package not installed", "skipped": True}

    extra_headers = {}
    if cookies:
        cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
        extra_headers["Cookie"] = cookie_str

    async with websockets.connect(
        ws_url,
        additional_headers=extra_headers,
        open_timeout=timeout_seconds,
    ) as ws:
        # Wait for connected system message
        connected = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout_seconds))
        if connected.get("type") != "system" or connected.get("subtype") != "connected":
            return {"ok": False, "error": f"Expected connected message, got: {connected}"}

        # Send user message
        await ws.send(json.dumps({"type": "user", "message": message}))

        # Wait for assistant response
        deadline = loop.time() + timeout_seconds
        while loop.time() < deadline:
            remaining = deadline - loop.time()
            raw = await asyncio.wait_for(ws.recv(), timeout=max(remaining, 1.0))
            frame = json.loads(raw)
            if frame.get("type") == "assistant":
                return {"ok": True, "frame": frame}
            if frame.get("type") == "result":
                return {"ok": True, "frame": frame}

    return {"ok": False, "error": "No assistant response within timeout"}


def agent_roundtrip(
    base_url: str,
    *,
    ws_path: str = "/ws/agent/normal/stream",
    message: str = "Say exactly: SMOKE_OK",
    timeout_seconds: float = 30.0,
    cookies: dict[str, str] | None = None,
) -> dict:
    """Synchronous wrapper for agent WebSocket roundtrip."""
    scheme = "wss" if base_url.startswith("https") else "ws"
    host = base_url.replace("https://", "").replace("http://", "").rstrip("/")
    ws_url = f"{scheme}://{host}{ws_path}"
    print(f"[smoke] Agent roundtrip: {ws_url}")
    result = asyncio.run(
        _agent_roundtrip_async(ws_url, message=message, timeout_seconds=timeout_seconds, cookies=cookies)
    )
    if result.get("ok"):
        print("[smoke] Agent roundtrip OK")
    elif result.get("skipped"):
        print(f"[smoke] Agent roundtrip skipped: {result.get('error')}")
    else:
        print(f"[smoke] Agent roundtrip FAILED: {result.get('error')}")
    return result

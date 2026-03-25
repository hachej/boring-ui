import asyncio
import json
import sys

from tests.smoke.smoke_lib import agent as agent_module


class _FakeWebSocket:
    def __init__(self, frames):
        self._frames = [json.dumps(frame) for frame in frames]
        self.sent = []

    async def recv(self):
        return self._frames.pop(0)

    async def send(self, payload):
        self.sent.append(json.loads(payload))


class _FakeConnect:
    def __init__(self, websocket):
        self.websocket = websocket

    async def __aenter__(self):
        return self.websocket

    async def __aexit__(self, exc_type, exc, tb):
        return False


def test_agent_roundtrip_uses_asyncio_run(monkeypatch):
    expected = {"ok": True, "frame": {"type": "assistant", "message": "SMOKE_OK"}}
    captured = {}
    real_run = asyncio.run

    async def fake_roundtrip_async(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return expected

    def fake_run(coro):
        captured["used_asyncio_run"] = True
        return real_run(coro)

    monkeypatch.setattr(agent_module, "_agent_roundtrip_async", fake_roundtrip_async)
    monkeypatch.setattr(agent_module.asyncio, "run", fake_run)

    result = agent_module.agent_roundtrip(
        "http://example.test/base",
        message="Say exactly: SMOKE_OK",
        timeout_seconds=12.5,
        cookies={"boring_session": "cookie"},
    )

    assert result == expected
    assert captured["used_asyncio_run"] is True
    assert captured["args"] == ("ws://example.test/base/ws/agent/normal/stream",)
    assert captured["kwargs"] == {
        "message": "Say exactly: SMOKE_OK",
        "timeout_seconds": 12.5,
        "cookies": {"boring_session": "cookie"},
    }


def test_agent_roundtrip_async_does_not_use_legacy_event_loop_access(monkeypatch):
    websocket = _FakeWebSocket([
        {"type": "system", "subtype": "connected"},
        {"type": "assistant", "message": "SMOKE_OK"},
    ])
    fake_websockets = type(
        "FakeWebsockets",
        (),
        {
            "connect": staticmethod(
                lambda *args, **kwargs: _FakeConnect(websocket),
            ),
        },
    )
    monkeypatch.setitem(sys.modules, "websockets", fake_websockets)

    async def run_case():
        monkeypatch.setattr(
            agent_module.asyncio,
            "get_event_loop",
            lambda: (_ for _ in ()).throw(AssertionError("legacy get_event_loop access is not allowed")),
        )
        return await agent_module._agent_roundtrip_async(
            "ws://example.test/ws/agent/normal/stream",
            timeout_seconds=5.0,
            cookies={"boring_session": "cookie"},
        )

    result = asyncio.run(run_case())

    assert result["ok"] is True
    assert result["frame"]["message"] == "SMOKE_OK"
    assert websocket.sent == [{"type": "user", "message": "Say exactly: SMOKE_OK"}]

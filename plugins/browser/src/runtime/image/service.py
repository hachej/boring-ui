#!/usr/bin/env python3
"""Fixed trusted-service-v1 browser protocol. No Agent/model/MCP catalog is created."""
import asyncio
import json
import os
import shutil
from pathlib import Path

from browser_use import BrowserProfile, BrowserSession

SOCKET = Path("/run/boring-browser/control.sock")
PROFILE = Path("/var/lib/boring-browser/profile")
MAX_REQUEST = 64 * 1024
OPERATIONS = {"start", "observe", "act", "takeover", "return-control", "stop"}

class FixedBrowserService:
    def __init__(self):
        self.browser: BrowserSession | None = None
        self.lock = asyncio.Lock()

    async def start(self):
        if self.browser is not None:
            return {"state": "ready"}
        PROFILE.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.browser = BrowserSession(browser_profile=BrowserProfile(
            executable_path="/usr/bin/chromium",
            user_data_dir=str(PROFILE),
            headless=False,
            args=["--no-first-run", "--disable-sync", "--disable-quic", "--disable-webrtc"],
        ))
        await self.browser.start()
        return {"state": "ready"}

    async def page(self):
        await self.start()
        assert self.browser is not None
        return await self.browser.must_get_current_page()

    async def observe(self):
        page = await self.page()
        result = await page.evaluate("""() => {
          const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')).slice(0, 10000);
          return {
            url: location.href,
            title: document.title,
            elements: candidates.slice(0, 500).map((el, index) => ({
              index,
              role: el.getAttribute('role') || el.tagName.toLowerCase(),
              text: String(el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0, 512)
            }))
          };
        }""")
        return json.loads(result) if isinstance(result, str) else result

    async def act(self, action):
        page = await self.page()
        kind = action.get("kind")
        if kind == "navigate":
            url = action.get("url")
            if not isinstance(url, str) or not url.startswith(("http://", "https://")):
                raise ValueError("invalid navigation")
            await page.goto(url)
        else:
            target = action.get("target")
            index = target.get("index") if isinstance(target, dict) else None
            if not isinstance(index, int) or index < 0 or index > 10000:
                raise ValueError("invalid target")
            selector = "a,button,input,textarea,select,[role],[tabindex]"
            if kind == "click":
                script = f"() => document.querySelectorAll({json.dumps(selector)})[{index}]?.click()"
            elif kind == "type":
                value = json.dumps(str(action.get("text", ""))[:8192])
                script = f"() => {{ const e=document.querySelectorAll({json.dumps(selector)})[{index}]; if(!e) throw Error('target'); e.value={value}; e.dispatchEvent(new Event('input',{{bubbles:true}})); }}"
            elif kind == "select":
                value = json.dumps(str(action.get("value", ""))[:1024])
                script = f"() => {{ const e=document.querySelectorAll({json.dumps(selector)})[{index}]; if(!e) throw Error('target'); e.value={value}; e.dispatchEvent(new Event('change',{{bubbles:true}})); }}"
            else: raise ValueError("unsupported action")
            await page.evaluate(script)
        return {"state": "settled"}

    async def invoke(self, operation, payload):
        async with self.lock:
            if operation == "start": return await self.start()
            if operation == "observe": return await self.observe()
            if operation == "act": return await self.act(payload)
            if operation in {"takeover", "return-control"}:
                await self.start(); return {"state": operation}
            if operation == "stop":
                if self.browser is not None:
                    await self.browser.stop()
                    self.browser = None
                shutil.rmtree(PROFILE, ignore_errors=True)
                return {"state": "stopped"}
            raise ValueError("unsupported operation")

service = FixedBrowserService()

async def handle(reader, writer):
    try:
        raw = await reader.readline()
        if not raw or len(raw) > MAX_REQUEST: raise ValueError("invalid request")
        request = json.loads(raw)
        if request.get("v") != 1 or request.get("operation") not in OPERATIONS: raise ValueError("invalid protocol")
        if set(request) - {"v", "operation", "payload"}: raise ValueError("unsupported field")
        payload = request.get("payload") or {}
        if not isinstance(payload, dict): raise ValueError("invalid payload")
        result = await service.invoke(request["operation"], payload)
        response = {"v": 1, "status": "ok", "payload": result}
    except Exception:
        response = {"v": 1, "status": "rejected"}
    writer.write((json.dumps(response, separators=(",", ":")) + "\n").encode())
    await writer.drain()
    writer.close()
    await writer.wait_closed()

async def main():
    SOCKET.unlink(missing_ok=True)
    server = await asyncio.start_unix_server(handle, path=SOCKET)
    os.chmod(SOCKET, 0o600)
    async with server: await server.serve_forever()

if __name__ == "__main__": asyncio.run(main())

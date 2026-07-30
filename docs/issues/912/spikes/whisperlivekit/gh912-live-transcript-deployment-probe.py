#!/usr/bin/env python3
"""End-to-end GH-912 deployment probe through Boring's public control plane.

Requires ffmpeg plus the pinned environment's aiohttp and websockets packages.
The supplied consented fixture is read in place and converted through stdout;
this probe writes no audio file. Optional session-log/workspace checks prove the
60-second same-session agent review and durable Markdown result.
"""

import argparse
import asyncio
import json
import subprocess
import time
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

import aiohttp
import websockets


BASE_PATH = "/api/v1/live-transcripts"
SAMPLE_RATE = 16_000
FRAME_MS = 100
FRAME_BYTES = SAMPLE_RATE * 2 * FRAME_MS // 1_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument("--base-url", default="http://127.0.0.1:1913")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--live-seconds", type=float, default=65.0)
    parser.add_argument("--review-interval-seconds", type=float, default=60.0)
    parser.add_argument("--review-timeout-seconds", type=float, default=30.0)
    parser.add_argument("--session-log", type=Path, required=True)
    parser.add_argument("--workspace-root", type=Path, required=True)
    return parser.parse_args()


def websocket_url(base_url: str, path: str) -> str:
    parsed = urlsplit(urljoin(base_url.rstrip("/") + "/", path.lstrip("/")))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunsplit((scheme, parsed.netloc, parsed.path, parsed.query, ""))


async def post_json(
    session: aiohttp.ClientSession,
    base_url: str,
    path: str,
    body: dict,
) -> tuple[int, dict]:
    async with session.post(urljoin(base_url.rstrip("/") + "/", path.lstrip("/")), json=body) as response:
        raw = await response.text()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"non-JSON response from {path}: {response.status} {raw[:200]!r}") from error
        return response.status, payload


def find_review_evidence(
    session_log: Path,
    transcript_path: str,
    earliest_review_ms: int,
) -> tuple[bool, bool, int | None]:
    prompt_index = None
    prompt_timestamp = None
    assistant_response = False
    for index, line in enumerate(session_log.read_text(encoding="utf-8").splitlines()):
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = event.get("message") or {}
        content = message.get("content") or []
        text = "\n".join(
            part.get("text", "") for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
        if (
            prompt_index is None
            and message.get("role") == "user"
            and "[Automatic transcript review]" in text
            and f"`{transcript_path}`" in text
        ):
            timestamp = event.get("timestamp")
            if isinstance(timestamp, str):
                # Pi event timestamps are ISO while message timestamps are ms.
                timestamp = message.get("timestamp")
            if isinstance(timestamp, (int, float)) and timestamp >= earliest_review_ms:
                prompt_index = index
                prompt_timestamp = int(timestamp)
            continue
        if prompt_index is not None and index > prompt_index and message.get("role") == "assistant":
            if message.get("errorMessage"):
                continue
            if any(
                isinstance(part, dict)
                and part.get("type") == "text"
                and str(part.get("text", "")).strip()
                for part in content
            ):
                assistant_response = True
                break
    return prompt_index is not None, assistant_response, prompt_timestamp


async def wait_for_review(
    session_log: Path,
    transcript_path: str,
    earliest_review_ms: int,
    timeout_seconds: float,
) -> tuple[int, bool]:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if session_log.is_file():
            prompt, response, timestamp = find_review_evidence(
                session_log,
                transcript_path,
                earliest_review_ms,
            )
            if prompt and response and timestamp is not None:
                return timestamp, True
        await asyncio.sleep(0.5)
    prompt, response, timestamp = find_review_evidence(session_log, transcript_path, earliest_review_ms)
    raise RuntimeError(
        "same-session automatic review evidence incomplete: "
        f"prompt={prompt} assistantResponse={response} timestamp={timestamp}"
    )


async def run(args: argparse.Namespace) -> dict:
    if not args.audio.is_file():
        raise FileNotFoundError(args.audio)
    if args.live_seconds < args.review_interval_seconds + 1:
        raise ValueError("--live-seconds must exceed the review interval by at least one second")
    subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True)

    wall_started_ms = int(time.time() * 1_000)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None)) as http:
        status, started = await post_json(http, args.base_url, BASE_PATH, {
            "sessionId": args.session_id,
            "title": "GH-912 deployment probe",
        })
        if status != 200:
            raise RuntimeError(f"live start failed: {status} {started}")
        live_id = started["liveSessionId"]
        transcript_path = started["transcriptPath"]
        nonce = started["socketNonce"]
        socket_path = f"{BASE_PATH}/{live_id}/audio"
        process = subprocess.Popen(
            [
                "ffmpeg", "-loglevel", "error", "-i", str(args.audio),
                "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1",
                "-ar", str(SAMPLE_RATE), "pipe:1",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        assert process.stdout is not None
        target_frames = int(args.live_seconds * 1_000 / FRAME_MS)
        audio_frames = 0
        started_monotonic = time.monotonic()
        terminal = False
        try:
            async with websockets.connect(websocket_url(args.base_url, socket_path), max_size=1_000_000) as websocket:
                await websocket.send(nonce.encode())
                if await asyncio.wait_for(websocket.recv(), timeout=10) != b"\x01":
                    raise RuntimeError("browser nonce was not acknowledged")
                for frame_index in range(target_frames):
                    frame = process.stdout.read(FRAME_BYTES)
                    if frame:
                        audio_frames += 1
                        if len(frame) < FRAME_BYTES:
                            frame += bytes(FRAME_BYTES - len(frame))
                    else:
                        frame = bytes(FRAME_BYTES)
                    await websocket.send(frame)
                    if await asyncio.wait_for(websocket.recv(), timeout=10) != b"\x01":
                        raise RuntimeError(f"PCM frame {frame_index} was not acknowledged")
                    target = started_monotonic + (frame_index + 1) * FRAME_MS / 1_000
                    await asyncio.sleep(max(0, target - time.monotonic()))

                review_timestamp, assistant_response = await wait_for_review(
                    args.session_log,
                    transcript_path,
                    wall_started_ms + int(args.review_interval_seconds * 1_000) - 2_000,
                    args.review_timeout_seconds,
                )
                review_delay_seconds = (review_timestamp - wall_started_ms) / 1_000
                if review_delay_seconds > args.review_interval_seconds + 10:
                    raise RuntimeError(
                        f"automatic review arrived too late: {review_delay_seconds:.3f}s"
                    )

                stop_status, stopped = await post_json(
                    http,
                    args.base_url,
                    f"{BASE_PATH}/{live_id}/stop",
                    {},
                )
                if stop_status != 200 or stopped.get("state") != "complete":
                    raise RuntimeError(f"graceful stop failed: {stop_status} {stopped}")
                terminal = True
        finally:
            if not process.stdout.closed:
                process.stdout.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            if not terminal:
                try:
                    await post_json(
                        http,
                        args.base_url,
                        f"{BASE_PATH}/{live_id}/interrupt",
                        {"reason": "attachment_failed"},
                    )
                except Exception:
                    # Preserve the original probe failure; the server also
                    # interrupts this session when the browser socket closes.
                    pass

    root = args.workspace_root.resolve()
    transcript = (root / transcript_path).resolve()
    if root not in transcript.parents:
        raise RuntimeError("server returned a transcript path outside the workspace")
    markdown = transcript.read_text(encoding="utf-8")
    if "- State: complete" not in markdown or "**Speaker " not in markdown:
        raise RuntimeError("terminal transcript is missing complete state or speaker text")

    return {
        "ok": True,
        "liveSessionId": live_id,
        "transcriptPath": transcript_path,
        "audioSeconds": round(audio_frames * FRAME_MS / 1_000, 3),
        "wallSeconds": round(time.monotonic() - started_monotonic, 3),
        "reviewTimestamp": review_timestamp,
        "reviewDelaySeconds": review_delay_seconds,
        "assistantResponse": assistant_response,
        "transcriptVerified": True,
    }


def main() -> None:
    args = parse_args()
    print(json.dumps(asyncio.run(run(args)), ensure_ascii=False))


if __name__ == "__main__":
    main()

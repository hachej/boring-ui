#!/usr/bin/env python3
"""Loopback-only, speaker-only Streaming Sortformer WebSocket sidecar.

Requires WhisperLiveKit with its Sortformer/NeMo dependencies installed. It
reuses only WLK's raw Sortformer backend; no secondary ASR is started.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import asdict, dataclass

import numpy as np
import websockets
PROTOCOL = "boring.sortformer.v1"
FRAME_BYTES = 3_200
MAX_MESSAGE_BYTES = 1_000_000
MAX_SEGMENTS = 2_000


@dataclass(frozen=True)
class Segment:
    speaker: int
    startSeconds: float
    endSeconds: float


def parse_start(raw: str) -> None:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("malformed start message") from error
    expected = {
        "type": "start",
        "protocol": PROTOCOL,
        "encoding": "pcm_s16le",
        "sampleRateHz": 16_000,
        "channels": 1,
        "frameDurationMs": 100,
    }
    if value != expected:
        raise ValueError("unsupported start message")


def parse_stop(raw: str) -> int:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("malformed stop message") from error
    if not isinstance(value, dict) or value.get("type") != "stop" or not isinstance(value.get("id"), int):
        raise ValueError("unsupported control message")
    return value["id"]


def append_segments(segments: list[Segment], new_segments, audio_through: float) -> None:
    for item in new_segments:
        start = max(0.0, float(item.start))
        end = min(audio_through, float(item.end))
        if start >= audio_through or end <= start:
            continue
        candidate = Segment(int(item.speaker), start, end)
        if segments and segments[-1].speaker == candidate.speaker and abs(segments[-1].endSeconds - candidate.startSeconds) <= 0.02:
            segments[-1] = Segment(candidate.speaker, segments[-1].startSeconds, candidate.endSeconds)
        else:
            segments.append(candidate)


async def send_snapshot(socket, revision: int, samples: int, segments: list[Segment]) -> None:
    await socket.send(json.dumps({
        "type": "snapshot",
        "revision": revision,
        "throughSeconds": samples / 16_000,
        "segments": [asdict(segment) for segment in segments],
    }, separators=(",", ":")))


class Sidecar:
    def __init__(self, model_path: str | None, token: str):
        from whisperlivekit.diarization.sortformer_backend import (
            SortformerDiarization,
            SortformerDiarizationOnline,
        )
        self.online_type = SortformerDiarizationOnline
        self.shared_model = SortformerDiarization(model_path=model_path) if model_path else SortformerDiarization()
        self.token = token
        self.session = asyncio.Semaphore(1)

    async def handle(self, socket) -> None:
        request = getattr(socket, "request", None)
        path = getattr(request, "path", getattr(socket, "path", ""))
        headers = getattr(request, "headers", getattr(socket, "request_headers", {}))
        if path != "/v1/diarize":
            await socket.close(code=4404, reason="not found")
            return
        if headers.get("Origin") is not None:
            await socket.close(code=4403, reason="browser origins forbidden")
            return
        if headers.get("Authorization") != f"Bearer {self.token}":
            await socket.close(code=4401, reason="unauthorized")
            return
        if self.session.locked():
            await socket.close(code=4429, reason="speaker service busy")
            return
        async with self.session:
            await self._run_session(socket)

    async def _run_session(self, socket) -> None:
        online = None
        try:
            first = await asyncio.wait_for(socket.recv(), timeout=5)
            if not isinstance(first, str):
                raise ValueError("start message must be text")
            parse_start(first)
            online = self.online_type(shared_model=self.shared_model)
            await socket.send(json.dumps({"type": "ready", "protocol": PROTOCOL, "maxSpeakers": 4}))
            segments: list[Segment] = []
            revision = 0
            samples = 0
            async for message in socket:
                if isinstance(message, bytes):
                    if len(message) != FRAME_BYTES:
                        raise ValueError("audio frame must contain exactly 100 ms of PCM16")
                    samples += len(message) // 2
                    pcm = np.frombuffer(message, dtype="<i2").astype(np.float32) / 32768.0
                    online.insert_audio_chunk(pcm)
                    new_segments = await online.diarize()
                    if not new_segments:
                        continue
                    append_segments(segments, new_segments, samples / 16_000)
                    if len(segments) > MAX_SEGMENTS:
                        raise ValueError("speaker segment limit exceeded")
                    revision += 1
                    await send_snapshot(socket, revision, samples, segments)
                    continue
                stop_id = parse_stop(message)
                # Sortformer emits only complete model chunks. Pad the private
                # in-memory tail with silence, then clamp output to real audio.
                threshold = int(online.chunk_duration_seconds * 16_000)
                if 0 < len(online.buffer_audio) < threshold:
                    online.insert_audio_chunk(np.zeros(threshold - len(online.buffer_audio), dtype=np.float32))
                    final_segments = await online.diarize()
                    if final_segments:
                        append_segments(segments, final_segments, samples / 16_000)
                        if len(segments) > MAX_SEGMENTS:
                            raise ValueError("speaker segment limit exceeded")
                        revision += 1
                        await send_snapshot(socket, revision, samples, segments)
                await socket.send(json.dumps({"type": "stopped", "id": stop_id}))
                return
        except (ValueError, asyncio.TimeoutError) as error:
            await socket.close(code=4400, reason=str(error)[:120])
        finally:
            if online is not None:
                online.close()


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18881)
    parser.add_argument("--model-path")
    parser.add_argument("--token", default=os.environ.get("BORING_SORTFORMER_TOKEN"))
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("Sortformer sidecar must bind to loopback")
    if not args.token:
        raise SystemExit("BORING_SORTFORMER_TOKEN or --token is required")
    sidecar = Sidecar(args.model_path, args.token)
    async with websockets.serve(sidecar.handle, args.host, args.port, max_size=MAX_MESSAGE_BYTES, max_queue=8):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())

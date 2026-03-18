"""Claude stream WebSocket router for boring-ui API."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ...config import APIConfig
from ...middleware.request_id import ensure_request_id, request_id_header_pair
from ...observability import ensure_metrics_registry, log_event
from ...workspace import resolve_websocket_workspace_context
from .service import (
    StreamSession,
    build_stream_args,
    _persist_permission_suggestions,
    _split_permission_suggestions,
    _map_permission_mode,
    _SESSION_REGISTRY,
    _SESSION_REGISTRY_LOCK,
    MAX_SESSIONS,
)

logger = logging.getLogger("boring_ui.stream")


async def handle_stream_websocket(
    websocket: WebSocket,
    cmd: str = "claude",
    base_args: Optional[list[str]] = None,
    cwd: Optional[str] = None,
) -> None:
    """
    Handle a WebSocket connection for Claude stream-json bridging.

    Query parameters:
    - session_id: Session ID for Claude CLI (auto-generated if not provided)
    - resume: If "1", resume existing session
    - force_new: If "1", force new session (terminate existing)
    - mode: UI mode - "ask", "act", or "plan" (maps to --permission-mode)

    Client messages:
    - {"type": "user", "message": "..."} - Send message to Claude
    - {"type": "ping"} - Keep-alive ping

    Server messages:
    - Forward Claude's JSON output directly
    - {"type": "system", "subtype": "...", ...} - System messages (errors, etc.)
    """
    request_id = ensure_request_id(websocket)
    metrics = ensure_metrics_registry(websocket.app)
    await websocket.accept(headers=[request_id_header_pair(request_id)])

    async def _send_json(payload: dict[str, Any]) -> None:
        if "request_id" not in payload:
            payload = dict(payload)
            payload["request_id"] = request_id
        await websocket.send_json(payload)

    def _is_valid_uuid(value: str) -> bool:
        """Check if a string is a valid UUID."""
        try:
            uuid.UUID(value)
            return True
        except (ValueError, TypeError):
            return False

    params = websocket.query_params
    original_session_id = params.get("session_id")
    if original_session_id and _is_valid_uuid(original_session_id):
        session_id = original_session_id
    else:
        session_id = str(uuid.uuid4())
        if original_session_id:
            print(f"[Stream] Invalid session_id '{original_session_id}', using new UUID: {session_id}")
    resume = params.get("resume", "0") in ("1", "true")
    force_new = params.get("force_new", "0") in ("1", "true")
    mode = params.get("mode", "ask")

    def _parse_csv(param_value: Optional[str]) -> Optional[list[str]]:
        if not param_value:
            return None
        items = [item.strip() for item in param_value.split(",")]
        cleaned = [item for item in items if item]
        return cleaned or None

    def _parse_int(value: Optional[str]) -> Optional[int]:
        if value is None or value == "":
            return None
        try:
            return int(value)
        except ValueError:
            return None

    def _parse_float(value: Optional[str]) -> Optional[float]:
        if value is None or value == "":
            return None
        try:
            return float(value)
        except ValueError:
            return None

    def _parse_file_specs(values: list[str]) -> Optional[list[str]]:
        if not values:
            return None
        cleaned = [value.strip() for value in values if value and value.strip()]
        if not cleaned:
            return None
        seen = set()
        ordered: list[str] = []
        for value in cleaned:
            if value in seen:
                continue
            seen.add(value)
            ordered.append(value)
        return ordered

    model = params.get("model") or None
    allowed_tools = _parse_csv(params.get("allowed_tools") or params.get("allowedTools"))
    disallowed_tools = _parse_csv(params.get("disallowed_tools") or params.get("disallowedTools"))
    max_thinking_tokens = _parse_int(params.get("max_thinking_tokens"))
    max_turns = _parse_int(params.get("max_turns"))
    max_budget_usd = _parse_float(params.get("max_budget_usd"))
    test_events = params.get("test_events", "0") in ("1", "true")
    file_specs = _parse_file_specs(params.getlist("file"))
    if file_specs is None:
        raw_files = params.get("files")
        if raw_files:
            file_specs = _parse_file_specs(raw_files.split(","))

    extra_env = {
        "BORING_UI_REQUEST_ID": request_id,
        "KURT_SESSION_PROVIDER": "claude-stream",
        "KURT_SESSION_NAME": session_id,
    }

    def _extract_text_from_content(message_content: Any) -> str:
        if isinstance(message_content, str):
            return message_content
        if isinstance(message_content, dict):
            message_content = message_content.get("content")
        if isinstance(message_content, list):
            for part in message_content:
                if isinstance(part, dict) and part.get("type") == "text":
                    return part.get("text", "")
        return ""

    stale: list[StreamSession] = []
    created = False

    async with _SESSION_REGISTRY_LOCK:
        existing = _SESSION_REGISTRY.get(session_id)
        should_resume = False

        if existing:
            should_resume = True

        requested_options = {
            "model": model,
            "allowed_tools": allowed_tools,
            "disallowed_tools": disallowed_tools,
            "max_thinking_tokens": max_thinking_tokens,
            "max_turns": max_turns,
            "max_budget_usd": max_budget_usd,
            "file_specs": file_specs,
        }

        if force_new and existing:
            stale.append(existing)
            _SESSION_REGISTRY.pop(session_id, None)
            existing = None
            should_resume = True
            print(f"[Stream] Force new session requested, will resume: {session_id}")

        if existing and existing.is_alive():
            existing_mode = getattr(existing, "_mode", None)
            existing_options = getattr(existing, "_options", None)
            if existing_mode != mode or existing_options != requested_options:
                print("[Stream] Session options changed; will resume with new settings")
                stale.append(existing)
                _SESSION_REGISTRY.pop(session_id, None)
                existing = None
                should_resume = True

        if existing and existing.is_alive():
            session = existing
        else:
            if existing:
                stale.append(existing)
                _SESSION_REGISTRY.pop(session_id, None)
                should_resume = True

            while len(_SESSION_REGISTRY) >= MAX_SESSIONS:
                idle_sessions = [
                    (sid, sess) for sid, sess in _SESSION_REGISTRY.items()
                    if not sess.clients
                ]
                if idle_sessions:
                    evict_id, evict_sess = idle_sessions[0]
                    print(f"[Stream] Evicting idle session {evict_id} (at max {MAX_SESSIONS})")
                    stale.append(evict_sess)
                    _SESSION_REGISTRY.pop(evict_id, None)
                else:
                    print(f"[Stream] Max sessions ({MAX_SESSIONS}) reached, no idle to evict")
                    break

            use_resume = should_resume
            args = build_stream_args(
                base_args or [],
                session_id,
                resume=use_resume,
                cwd=cwd,
                mode=mode,
                model=model,
                allowed_tools=allowed_tools,
                disallowed_tools=disallowed_tools,
                max_thinking_tokens=max_thinking_tokens,
                max_turns=max_turns,
                max_budget_usd=max_budget_usd,
                file_specs=file_specs,
            )
            print(
                f"[Stream] Building new session: resume={use_resume} (frontend={resume}, registry={should_resume}), mode={mode}"
            )

            session = StreamSession(
                cmd=cmd,
                args=args,
                cwd=cwd or os.getcwd(),
                extra_env=extra_env,
            )
            session.session_id = session_id
            session._mode = mode
            session._options = requested_options
            _SESSION_REGISTRY[session_id] = session
            created = True

    for stale_session in stale:
        await stale_session.terminate(force=True)

    await session.add_client(websocket)
    metrics.set_gauge("pi_sessions_active", float(len(_SESSION_REGISTRY)))
    log_event(
        logger,
        "stream_session_connected",
        request_id=request_id,
        workspace_id=str(websocket.headers.get("x-workspace-id", "") or ""),
        session_id=session_id,
        resumed=(not created and not force_new),
    )

    if created:
        try:
            await session.spawn()
            await session.start_read_loop()
            await asyncio.sleep(0.2)
            if session.proc and session.proc.returncode is not None:
                await _send_json({
                    "type": "system",
                    "subtype": "error",
                    "message": "Claude process exited unexpectedly. Session may be in use.",
                })
                await websocket.close()
                await session.terminate()
                return
        except Exception as e:
            await _send_json({
                "type": "system",
                "subtype": "error",
                "message": f"Failed to start session: {e}",
            })
            await websocket.close()
            await session.terminate()
            return

    current_options = getattr(session, "_options", None) or {}
    effective_model = current_options.get("model") or "sonnet"
    await _send_json({
        "type": "system",
        "subtype": "connected",
        "session_id": session_id,
        "resumed": not created and not force_new,
        "settings": {
            "max_thinking_tokens": current_options.get("max_thinking_tokens"),
            "model": effective_model,
        },
    })

    if not created and session._last_init_message:
        print("[Stream] Sending stored init message to resumed client")
        await _send_json(session._last_init_message)

    try:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                payload = {"type": "user", "message": message}

            msg_type = payload.get("type")

            if msg_type == "user":
                user_message = payload.get("message", "")
                context_files = payload.get("context_files", [])
                images = payload.get("images", [])

                print(f"[Stream] USER MSG: message type={type(user_message).__name__}")
                if isinstance(user_message, dict):
                    msg_content = user_message.get("content", [])
                    content_types = (
                        [c.get("type") for c in msg_content]
                        if isinstance(msg_content, list)
                        else "not-list"
                    )
                    print(f"[Stream] USER MSG: content types={content_types}, images param={len(images)}")

                content: Optional[list[dict[str, Any]]] = None

                if isinstance(user_message, dict):
                    content = user_message.get("content")
                elif isinstance(user_message, list):
                    content = user_message
                elif isinstance(user_message, str):
                    content = [{"type": "text", "text": user_message}]

                if context_files:
                    file_refs = " ".join(f"@{f}" for f in context_files)
                    prefix = {"type": "text", "text": file_refs}
                    if content:
                        content = [prefix, *content]
                    else:
                        content = [prefix]

                if images:
                    if content is None:
                        content = []
                    for img in images:
                        if isinstance(img, dict) and "data" in img:
                            content.append({
                                "type": "image",
                                "data": img.get("data", ""),
                                "mimeType": img.get("mimeType", "image/png"),
                            })

                if content:
                    if test_events:
                        text_content = _extract_text_from_content(content)
                        triggered = False
                        if "__emit_permission__" in text_content:
                            await _send_json({
                                "type": "control_request",
                                "request_id": "perm-1",
                                "request": {
                                    "subtype": "can_use_tool",
                                    "tool_name": "Write",
                                    "input": {"file_path": "README.md", "content": "hello"},
                                    "tool_use_id": "toolu_write_1",
                                    "permission_suggestions": [{
                                        "type": "setMode",
                                        "mode": "acceptEdits",
                                        "destination": "session",
                                    }],
                                },
                            })
                            triggered = True
                        if "__emit_question__" in text_content:
                            await _send_json({
                                "type": "control",
                                "subtype": "user_question_request",
                                "request_id": "quest-1",
                                "questions": [
                                    {
                                        "question": "Pick a color",
                                        "header": "Color",
                                        "multiSelect": False,
                                        "options": [
                                            {"label": "Red", "description": "Warm"},
                                            {"label": "Blue", "description": "Cool"},
                                        ],
                                    },
                                    {
                                        "question": "Pick extras",
                                        "header": "Extras",
                                        "multiSelect": True,
                                        "options": [
                                            {"label": "Alpha", "description": "First"},
                                            {"label": "Beta", "description": "Second"},
                                        ],
                                    },
                                ],
                            })
                            triggered = True
                        if "__emit_tool__" in text_content:
                            await _send_json({
                                "type": "assistant",
                                "message": {
                                    "role": "assistant",
                                    "id": "msg-1",
                                    "content": [{
                                        "type": "tool_use",
                                        "id": "toolu-1",
                                        "name": "Bash",
                                        "input": {"command": "ls", "description": "list"},
                                    }],
                                },
                            })
                            await _send_json({
                                "type": "user",
                                "message": {
                                    "role": "user",
                                    "content": [{
                                        "type": "tool_result",
                                        "tool_use_id": "toolu-1",
                                        "content": "file-a\nfile-b",
                                    }],
                                },
                            })
                            triggered = True
                        if triggered:
                            continue

                    for block in content:
                        if block.get("type") == "image":
                            source = block.get("source", {})
                            print(f"[Stream] Image block: source.type={source.get('type')}, media_type={source.get('media_type')}")
                    await session.write_message_content(content)

            elif msg_type == "command":
                command = payload.get("command", "")
                print(f"[Stream] COMMAND received: {command}")
                if command:
                    await session.write_message(command)
                    print(f"[Stream] COMMAND sent to CLI: {command}")

            elif msg_type == "control":
                subtype = payload.get("subtype")

                if subtype == "initialize":
                    session._capabilities = payload.get("capabilities", {})
                    await _send_json({"type": "system", "subtype": "echo", "payload": payload})
                    continue

                if subtype == "set_permission_mode":
                    requested_mode = payload.get("mode")
                    mode_map = {
                        "default": "ask",
                        "acceptEdits": "act",
                        "plan": "plan",
                        "bypassPermissions": "act",
                        "dontAsk": "act",
                        "delegate": "ask",
                    }
                    if requested_mode:
                        session._mode = mode_map.get(requested_mode, session._mode)

                if subtype == "set_model":
                    model_name = payload.get("model")
                    if model_name:
                        options = getattr(session, "_options", None) or {}
                        options["model"] = model_name
                        session._options = options

                if subtype == "set_max_thinking_tokens":
                    max_tokens = payload.get("max_thinking_tokens")
                    if max_tokens is not None:
                        options = getattr(session, "_options", None) or {}
                        options["max_thinking_tokens"] = max_tokens
                        session._options = options

                await session.write_json(payload)

            elif msg_type == "control_response":
                if isinstance(payload.get("response"), dict):
                    await session.write_json(payload)
                    continue
                if payload.get("answers") is not None:
                    await session.write_json(payload)
                    continue

                request_id = payload.get("request_id")
                decision = payload.get("decision")
                behavior = payload.get("behavior")
                allow = payload.get("allow")
                tool_input = payload.get("tool_input", {})
                updated_input = payload.get("updatedInput") or payload.get("updated_input")
                permission_suggestions = payload.get("permission_suggestions") or payload.get("permissionSuggestions")
                deny_message = payload.get("message", "User denied permission")

                if decision is None:
                    decision = behavior
                if decision is None and allow is not None:
                    decision = "allow" if allow else "deny"
                if decision is None:
                    decision = "allow"

                behavior_value = decision
                behavior_text = str(behavior_value).lower() if isinstance(behavior_value, str) else ""
                is_deny = behavior_text in ("deny", "reject", "block")
                updated_value = updated_input if updated_input is not None else tool_input

                if not is_deny:
                    response_payload = {
                        "type": "control_response",
                        "response": {
                            "subtype": "success",
                            "request_id": request_id,
                            "response": {
                                "behavior": behavior_value,
                                "updatedInput": updated_value,
                            },
                        },
                    }
                    if permission_suggestions is not None:
                        response_payload["response"]["response"]["permission_suggestions"] = permission_suggestions
                else:
                    response_payload = {
                        "type": "control_response",
                        "response": {
                            "subtype": "success",
                            "request_id": request_id,
                            "response": {
                                "behavior": behavior_value,
                                "message": deny_message,
                            },
                        },
                    }

                await session.write_json(response_payload)

                if permission_suggestions and not is_deny:
                    session_suggestions, persist_suggestions = _split_permission_suggestions(permission_suggestions)
                    if persist_suggestions:
                        await _persist_permission_suggestions(persist_suggestions, session.cwd)
                    for suggestion in session_suggestions:
                        if suggestion.get("type") != "setMode":
                            continue
                        suggested_mode = suggestion.get("mode")
                        if not suggested_mode:
                            continue
                        session._mode = _map_permission_mode(suggested_mode) or session._mode
                        await session.write_json({
                            "type": "control",
                            "subtype": "set_permission_mode",
                            "mode": suggested_mode,
                        })
                        await session.broadcast({
                            "type": "control",
                            "subtype": "set_permission_mode",
                            "mode": suggested_mode,
                        })

            elif msg_type == "interrupt":
                await session.interrupt()
                await _send_json({
                    "type": "system",
                    "subtype": "interrupted",
                    "session_id": session_id,
                })

            elif msg_type == "ping":
                await _send_json({"type": "pong"})

            elif msg_type == "restart":
                await session.terminate()
                async with _SESSION_REGISTRY_LOCK:
                    session = StreamSession(
                        cmd=cmd,
                        args=args,
                        cwd=cwd or os.getcwd(),
                        extra_env=extra_env,
                    )
                    session.session_id = session_id
                    _SESSION_REGISTRY[session_id] = session
                await session.spawn()
                await session.start_read_loop()
                await session.add_client(websocket)
                await _send_json({
                    "type": "system",
                    "subtype": "restarted",
                    "session_id": session_id,
                })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[Stream] WebSocket error: {e}")
    finally:
        await session.remove_client(websocket)
        metrics.set_gauge("pi_sessions_active", float(len(_SESSION_REGISTRY)))
        log_event(
            logger,
            "stream_session_disconnected",
            request_id=request_id,
            workspace_id=str(websocket.headers.get("x-workspace-id", "") or ""),
            session_id=session_id,
        )


def create_stream_router(config: APIConfig) -> APIRouter:
    """Create Claude stream WebSocket router (kurt-core aligned)."""
    router = APIRouter(tags=["stream"])

    # Canonical agent-normal stream endpoint (legacy `/ws/claude-stream` rewritten).
    @router.websocket("/stream")
    async def stream_websocket(websocket: WebSocket):
        try:
            ctx = await resolve_websocket_workspace_context(websocket, config=config)
        except ValueError as exc:
            await websocket.close(code=4004, reason=str(exc))
            return
        await handle_stream_websocket(websocket, cwd=str(ctx.root_path))

    return router

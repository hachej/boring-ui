"""CLI entry point: bm run/list/scaffold"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import run_transform, _WORKSPACE_ROOT

_TOOL_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")

_BUILTINS_ROOT = (Path(__file__).resolve().parent / "transforms" / "builtins").resolve()
_CUSTOM_ROOT = (_WORKSPACE_ROOT / "transforms/custom").resolve()


@dataclass
class TransformTool:
    tool_id: str
    name: str
    tool_type: str  # builtin | custom
    path: Path
    description: str
    inputs: str


def _parse_tool_metadata(path: Path) -> tuple[str, str]:
    description = ""
    inputs = "?"
    try:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if not isinstance(target, ast.Name):
                    continue
                if target.id == "DESCRIPTION":
                    try:
                        v = ast.literal_eval(node.value)
                        if isinstance(v, str):
                            description = v.strip()
                    except Exception:
                        pass
                if target.id == "INPUTS":
                    try:
                        v = ast.literal_eval(node.value)
                        inputs = str(v) if isinstance(v, int) else "?"
                    except Exception:
                        pass
    except Exception:
        pass
    return description, inputs


def _discover(root: Path, tool_type: str) -> dict[str, TransformTool]:
    out: dict[str, TransformTool] = {}
    if not root.is_dir():
        return out
    for path in sorted(root.glob("*.py")):
        if path.name.startswith("_"):
            continue
        desc, inputs = _parse_tool_metadata(path)
        name = path.stem
        out[name] = TransformTool(
            tool_id=f"{tool_type}:{name}",
            name=name,
            tool_type=tool_type,
            path=path.resolve(),
            description=desc,
            inputs=inputs,
        )
    return out


def _resolve_tool(ref: str) -> TransformTool:
    ref = ref.strip()
    builtins = _discover(_BUILTINS_ROOT, "builtin")
    customs = _discover(_CUSTOM_ROOT, "custom")

    if ref.startswith("builtin:"):
        name = ref.split(":", 1)[1]
        if name not in builtins:
            raise ValueError(f"Unknown builtin: {ref}")
        return builtins[name]
    if ref.startswith("custom:"):
        name = ref.split(":", 1)[1]
        if name not in customs:
            raise ValueError(f"Unknown custom: {ref}")
        return customs[name]

    in_b, in_c = ref in builtins, ref in customs
    if in_b and in_c:
        raise ValueError(f"Ambiguous '{ref}': exists as both builtin and custom. Use builtin:{ref} or custom:{ref}.")
    if in_b:
        return builtins[ref]
    if in_c:
        return customs[ref]
    raise ValueError(f"Unknown tool '{ref}'. Run `bm list`.")


def _cmd_run(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="bm run")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--tool", help="Tool id/name (e.g. custom:ma12, yoy)")
    group.add_argument("--script", help="Path to a transform .py file")
    p.add_argument("--input", required=True, help="Comma-separated input series ids")
    p.add_argument("--output", required=True, help="Output derived series id")
    p.add_argument("--title", required=True, help="Derived series title")
    p.add_argument("--params-json", help="JSON params passed to transform")
    args = p.parse_args(argv)

    input_ids = [s.strip() for s in args.input.split(",") if s.strip()]
    params: dict[str, Any] = json.loads(args.params_json) if args.params_json else {}

    if args.tool:
        tool = _resolve_tool(args.tool)
        script_path = str(tool.path)
        transform_name = tool.name
    else:
        script_path = args.script
        transform_name = None

    result = run_transform(
        script_path,
        input_ids=input_ids,
        output_id=args.output,
        title=args.title,
        transform_name=transform_name,
        params=params,
    )
    print(json.dumps(result, ensure_ascii=True))
    return 0 if result.get("ok") else 1


def _cmd_list(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="bm list")
    p.add_argument("--json", action="store_true")
    args = p.parse_args(argv)

    tools = sorted(
        list(_discover(_BUILTINS_ROOT, "builtin").values()) +
        list(_discover(_CUSTOM_ROOT, "custom").values()),
        key=lambda t: (t.tool_type, t.name),
    )

    if args.json:
        print(json.dumps({"ok": True, "count": len(tools), "tools": [
            {"tool_id": t.tool_id, "name": t.name, "tool_type": t.tool_type,
             "path": str(t.path), "inputs": t.inputs, "description": t.description}
            for t in tools
        ]}, ensure_ascii=True))
        return 0

    if not tools:
        print("No transforms found. Create one with: bm scaffold --name <name>")
        return 0
    print(f"Available transforms ({len(tools)}):")
    for t in tools:
        desc = f" — {t.description}" if t.description else ""
        print(f"  {t.tool_id} (inputs={t.inputs}){desc}")
    return 0


_SCAFFOLD_TEMPLATE = '''\
import pandas as pd

INPUTS = 1
DESCRIPTION = "Describe what this transform computes."


def transform(frames: dict[str, pd.DataFrame], input_ids: list[str], params: dict | None = None) -> pd.DataFrame:
    params = params or {{}}
    df = frames[input_ids[0]].copy()
    df = df.sort_values("date").reset_index(drop=True)
    # TODO: replace with your logic
    return df[["date", "value"]]
'''


def _cmd_scaffold(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="bm scaffold")
    p.add_argument("--name", required=True, help="Transform name (e.g. arima_forecast)")
    p.add_argument("--force", action="store_true", help="Overwrite if exists")
    args = p.parse_args(argv)

    name = args.name.strip()
    if not _TOOL_NAME_RE.match(name):
        raise ValueError("Invalid name. Use letters/digits/_/- starting with a letter.")

    _CUSTOM_ROOT.mkdir(parents=True, exist_ok=True)
    path = _CUSTOM_ROOT / f"{name}.py"
    existed = path.exists()
    if existed and not args.force:
        raise FileExistsError(f"Already exists: {path} (use --force to overwrite)")

    path.write_text(_SCAFFOLD_TEMPLATE, encoding="utf-8")
    print(json.dumps({"ok": True, "action": "updated" if existed else "created",
                      "tool_id": f"custom:{name}", "path": str(path)}, ensure_ascii=True))
    return 0


def _print_help() -> None:
    print("""Usage: bm <command> [args]\n\nCommands:\n  list            List available transforms\n  run             Execute a transform and persist derived output\n  scaffold        Create a new custom transform template\n\nHelp:\n  bm --help       Show this help\n  bm <command> --help\n""")


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        _print_help()
        return 1
    cmd, rest = argv[0], argv[1:]
    try:
        if cmd in {"-h", "--help", "help"}:
            _print_help()
            return 0
        if cmd == "run":
            return _cmd_run(rest)
        if cmd == "list":
            return _cmd_list(rest)
        if cmd == "scaffold":
            return _cmd_scaffold(rest)
        print(json.dumps({"ok": False, "error": f"Unknown command: {cmd}"}))
        return 1
    except SystemExit:
        raise
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

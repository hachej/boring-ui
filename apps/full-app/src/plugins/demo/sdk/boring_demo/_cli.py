"""Dummy demo CLI for the boring-ui full-app (provisioning demo/test)."""
import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(prog="democli", description="boring-ui full-app demo CLI")
    parser.add_argument("command", nargs="?", default="hello", help="hello | info | echo")
    parser.add_argument("args", nargs="*", help="extra args for echo")
    ns = parser.parse_args()

    if ns.command == "info":
        print(json.dumps({
            "tool": "democli",
            "version": __import__("boring_demo").__version__,
            "python": sys.version.split()[0],
            "executable": sys.executable,
        }, indent=2))
    elif ns.command == "echo":
        print(" ".join(ns.args))
    else:  # hello
        print("👋 democli is installed and working — boring-ui full-app demo SDK")
        print(f"   python {sys.version.split()[0]} @ {sys.executable}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

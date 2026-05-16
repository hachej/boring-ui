#!/usr/bin/env bash
# Multi-model triangulation for Phase 4 / Phase 7.
# See references/ORCHESTRATION.md §Triangulation-recipe.
#
# Usage: triangulate.sh <mdx-path> <rubric-path> [models...]
# Defaults to claude,codex,gemini.

set -euo pipefail

TARGET="${1:?usage: triangulate.sh <mdx-path> <rubric-path> [models...]}"
RUBRIC="${2:?usage: triangulate.sh <mdx-path> <rubric-path> [models...]}"
shift 2
if [[ $# -eq 0 ]]; then
  MODELS=(claude codex gemini)
else
  MODELS=("$@")
fi

WORKSPACE="${WORKSPACE_DIR:-workspace}/polish"
mkdir -p "$WORKSPACE"
slug="$(basename "$TARGET" .mdx)"

echo "Triangulating $TARGET across: ${MODELS[*]}"
for model in "${MODELS[@]}"; do
  case "$model" in
    claude)
      if ! command -v claude >/dev/null 2>&1; then
        echo "skip claude: CLI not found" >&2
        continue
      fi
      claude --print --model claude-opus-4-7 \
        --system "$(cat "$RUBRIC")" \
        < "$TARGET" > "$WORKSPACE/$slug.claude.patch" || echo "claude failed"
      ;;
    codex)
      if ! command -v codex >/dev/null 2>&1; then
        echo "skip codex: CLI not found" >&2
        continue
      fi
      codex --print --system "$(cat "$RUBRIC")" \
        < "$TARGET" > "$WORKSPACE/$slug.codex.patch" || echo "codex failed"
      ;;
    gemini)
      if ! command -v gemini >/dev/null 2>&1; then
        echo "skip gemini: CLI not found" >&2
        continue
      fi
      gemini --print --system "$(cat "$RUBRIC")" \
        < "$TARGET" > "$WORKSPACE/$slug.gemini.patch" || echo "gemini failed"
      ;;
    *)
      echo "unknown model: $model" >&2
      ;;
  esac
done

echo "Wrote reviewer patches to $WORKSPACE/$slug.*.patch"
echo "Next: run the adjudication agent to merge → $WORKSPACE/$slug.merged.mdx"

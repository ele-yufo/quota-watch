#!/usr/bin/env bash
# Clear the REVIEW GATE for the current set of code changes. Run only AFTER a
# real code review (Codex or code-reviewer subagent) whose findings are handled.
set -uo pipefail
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
cd "$ROOT" || exit 1
mkdir -p .claude
git diff origin/main -- ios packages mac | shasum | awk '{print $1}' > .claude/.review-sig
echo "✓ review recorded for current ios/ packages/ mac/ diff — gate cleared"

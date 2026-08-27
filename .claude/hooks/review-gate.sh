#!/usr/bin/env bash
# Stop hook — REVIEW GATE.
#
# Blocks the agent from finishing while there are code changes under
# ios/ packages/ mac/ that haven't been reviewed since they last changed.
# Exit 2 blocks the stop and feeds the message back to the model, forcing it to
# run a code review (Codex primary, code-reviewer subagent fallback) first.
#
# Cleared by .claude/hooks/mark-reviewed.sh after a review is done.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$ROOT" ] && cd "$ROOT" 2>/dev/null || exit 0

GLOBS="ios packages mac"

# All undelivered code changes vs the pushed baseline (committed + uncommitted).
if git diff --quiet origin/main -- $GLOBS 2>/dev/null; then
  exit 0   # nothing undelivered → allow stop
fi

sig="$(git diff origin/main -- $GLOBS 2>/dev/null | shasum | awk '{print $1}')"
if [ "$sig" = "$(cat "$ROOT/.claude/.review-sig" 2>/dev/null)" ]; then
  exit 0   # this exact state was already reviewed → allow stop
fi

cat >&2 <<'MSG'
⛔ REVIEW GATE — you have code changes (ios/ packages/ mac/) that have NOT been
reviewed since they last changed. Do NOT deliver yet. Run a real code review:

  PRIMARY (Codex):
    git diff origin/main -- ios packages mac \
      | codex exec "Review this diff. Focus on bugs: SwiftUI/WidgetKit layout & sizing, timeline/threading/async, logic and edge cases. Be concise; list concrete issues with file:line."

  FALLBACK (only if codex fails/unavailable):
    spawn a code-reviewer subagent on the same diff.

Fix every real issue it finds (or state why it's a non-issue). THEN clear the
gate and stop again:

    .claude/hooks/mark-reviewed.sh
MSG
exit 2

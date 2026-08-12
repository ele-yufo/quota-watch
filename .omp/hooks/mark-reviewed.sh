#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
mkdir -p .omp

hash_diff() {
  if command -v sha1sum >/dev/null 2>&1; then
    sha1sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha1 | awk '{print $NF}'
  else
    echo "ERROR: sha1sum, shasum, or openssl is required" >&2
    return 1
  fi
}

git diff origin/main -- ios packages mac | hash_diff > .omp/.review-sig
echo "review recorded for current ios/ packages/ mac/ diff — OMP gate cleared"

#!/usr/bin/env bash
# Mimics `grok --output-format streaming-json` for tests.
# Emits a fixed sequence of NDJSON events with a short delay.
# Usage: fake-grok.sh [--ok|--fail|--hang|--slow|--mixed]
set -euo pipefail

mode="${1:---ok}"
emit() { printf '%s\n' "$1"; sleep 0.02; }

case "$mode" in
  --ok|"")
    emit '{"type":"thought","data":"thinking"}'
    emit '{"type":"text","data":"hello"}'
    emit '{"type":"text","data":" world"}'
    emit '{"type":"end","stopReason":"EndTurn","sessionId":"sess-1","requestId":"req-1"}'
    ;;
  --fail)
    emit '{"type":"thought","data":"trying"}'
    >&2 echo "fake-grok: simulated failure"
    exit 2
    ;;
  --hang)
    emit '{"type":"thought","data":"hanging"}'
    sleep 600
    ;;
  --slow)
    emit '{"type":"thought","data":"slow start"}'
    sleep 3
    emit '{"type":"text","data":"finally"}'
    emit '{"type":"end","stopReason":"EndTurn","sessionId":"sess-slow","requestId":"req-slow"}'
    ;;
  --mixed)
    emit '{"type":"thought","data":"start"}'
    emit '{"type":"future_event","data":"unknown payload"}'
    emit '{"not":"json valid for our schema either"}'
    echo 'plain text garbage'
    emit '{"type":"text","data":"recovered"}'
    emit '{"type":"end","stopReason":"EndTurn","sessionId":"s","requestId":"r"}'
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 1
    ;;
esac

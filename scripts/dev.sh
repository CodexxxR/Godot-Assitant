#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AI_SERVICE_DIR="$ROOT_DIR/services/ai-service"
DESKTOP_APP_DIR="$ROOT_DIR/apps/desktop-app"

AI_SERVICE_PORT="${AI_SERVICE_PORT:-3001}"
AI_SERVICE_URL="${VITE_AI_SERVICE_URL:-http://localhost:$AI_SERVICE_PORT}"
CHROMA_HOST="${CHROMA_HOST:-localhost}"
CHROMA_PORT="${CHROMA_PORT:-8000}"
START_CHROMA="${START_CHROMA:-1}"
DEV_WAIT_SECONDS="${DEV_WAIT_SECONDS:-180}"

PIDS=()

log() {
  printf '\033[1;36m[dev]\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33m[dev]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[dev]\033[0m %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local exit_code=$?

  if [ "${#PIDS[@]}" -gt 0 ]; then
    log "Stopping local dev processes..."
    for pid in "${PIDS[@]}"; do
      kill "$pid" >/dev/null 2>&1 || true
    done
    wait "${PIDS[@]}" >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found."
}

is_port_open() {
  nc -z "$1" "$2" >/dev/null 2>&1
}

is_url_up() {
  curl -fsS "$1" >/dev/null 2>&1
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local name="$3"

  for _ in $(seq 1 "$DEV_WAIT_SECONDS"); do
    if is_port_open "$host" "$port"; then
      log "$name is ready on $host:$port"
      return 0
    fi
    sleep 1
  done

  fail "$name did not become ready on $host:$port."
}

wait_for_url() {
  local url="$1"
  local name="$2"

  for _ in $(seq 1 "$DEV_WAIT_SECONDS"); do
    if is_url_up "$url"; then
      log "$name is ready"
      return 0
    fi
    sleep 1
  done

  fail "$name did not become ready at $url."
}

install_dependencies_if_needed() {
  local dir="$1"
  local name="$2"

  if [ -d "$dir/node_modules" ]; then
    return 0
  fi

  log "Installing $name dependencies..."
  if [ -f "$dir/package-lock.json" ]; then
    npm --prefix "$dir" ci || npm --prefix "$dir" install
  else
    npm --prefix "$dir" install
  fi
}

start_chroma() {
  if is_port_open "$CHROMA_HOST" "$CHROMA_PORT"; then
    log "Chroma is already running on $CHROMA_HOST:$CHROMA_PORT"
    return 0
  fi

  if [ "$START_CHROMA" = "0" ]; then
    warn "START_CHROMA=0 and Chroma is not reachable on $CHROMA_HOST:$CHROMA_PORT"
    return 0
  fi

  if command -v chroma >/dev/null 2>&1; then
    log "Starting Chroma with the local chroma CLI..."
    (cd "$AI_SERVICE_DIR" && npm run chroma) &
    PIDS+=("$!")
    wait_for_port "$CHROMA_HOST" "$CHROMA_PORT" "Chroma"
    return 0
  fi

  if command -v docker >/dev/null 2>&1; then
    log "Starting Chroma with Docker..."
    docker run --rm -p "$CHROMA_PORT:8000" chromadb/chroma &
    PIDS+=("$!")
    wait_for_port "$CHROMA_HOST" "$CHROMA_PORT" "Chroma"
    return 0
  fi

  fail "Chroma is not running. Install Docker or the chroma CLI, or start Chroma manually on port $CHROMA_PORT."
}

start_ai_service() {
  if is_url_up "$AI_SERVICE_URL/health"; then
    log "AI service is already running at $AI_SERVICE_URL"
    return 0
  fi

  if is_port_open localhost "$AI_SERVICE_PORT"; then
    fail "Port $AI_SERVICE_PORT is already in use, but $AI_SERVICE_URL/health is not responding."
  fi

  log "Starting AI service..."
  (cd "$AI_SERVICE_DIR" && npm start) &
  PIDS+=("$!")
  wait_for_url "$AI_SERVICE_URL/health" "AI service"
}

start_desktop_app() {
  log "Starting desktop app..."
  local desktop_pid
  (cd "$DESKTOP_APP_DIR" && VITE_AI_SERVICE_URL="$AI_SERVICE_URL" npm run dev) &
  desktop_pid="$!"
  PIDS+=("$desktop_pid")

  wait "$desktop_pid"
}

require_command npm
require_command nc
require_command curl

install_dependencies_if_needed "$AI_SERVICE_DIR" "AI service"
install_dependencies_if_needed "$DESKTOP_APP_DIR" "desktop app"

start_chroma
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  warn "OPENROUTER_API_KEY is not set. The app can index and edit files, but AI generation will fail until it is provided."
fi
start_ai_service
start_desktop_app

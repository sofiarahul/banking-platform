#!/usr/bin/env bash
#
# Starts the Spring Boot backend and the frontend dev server together.
# Ctrl+C (or either process dying) shuts everything down cleanly.
#
# Layout assumed (adjust ROOT_DIR if yours differs):
#   <root>/backend
#   <root>/frontend
#   <root>/<this script's folder>/dev.sh

set -Eeuo pipefail
set -m   # give each background job its own process group so we can kill whole trees

# ---- Config -----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$SCRIPT_DIR/run_app.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  source "$CONFIG_FILE"
  set +a
fi

ROOT_DIR="${ROOT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
BACKEND_DIR="${BACKEND_DIR:-$ROOT_DIR/backend}"
FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/.dev-logs}"

BACKEND_PORT="${BACKEND_PORT:-8080}"
BACKEND_TIMEOUT="${BACKEND_TIMEOUT:-120}"   # seconds to wait for backend to come up
SEED_PERSONAS="${SEED_PERSONAS:-true}"

BACKEND_PID=""
FRONTEND_PID=""

# ---- Helpers ----------------------------------------------------------------
log()  { printf '\033[1;34m[dev]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[dev]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

kill_tree() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  # Negative PID = whole process group (works because of `set -m`)
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
}

CLEANING_UP=0
cleanup() {
  local code=$?
  trap - EXIT INT TERM
  [[ $CLEANING_UP -eq 1 ]] && return
  CLEANING_UP=1
  echo
  log "Shutting down..."
  kill_tree "$FRONTEND_PID"
  kill_tree "$BACKEND_PID"
  wait 2>/dev/null || true
  log "Stopped."
  exit "$code"
}
trap cleanup EXIT INT TERM

# ---- Preflight checks -------------------------------------------------------
require_cmd java
require_cmd node
require_cmd npm

[[ -d "$BACKEND_DIR"  ]] || die "Backend directory not found: $BACKEND_DIR"
[[ -d "$FRONTEND_DIR" ]] || die "Frontend directory not found: $FRONTEND_DIR"
[[ -f "$BACKEND_DIR/mvnw" ]] || die "mvnw not found in $BACKEND_DIR"
[[ -f "$FRONTEND_DIR/package.json" ]] || die "package.json not found in $FRONTEND_DIR"

[[ -x "$BACKEND_DIR/mvnw" ]] || chmod +x "$BACKEND_DIR/mvnw"

port_in_use "$BACKEND_PORT" && die "Port $BACKEND_PORT is already in use (is the backend already running?)"

mkdir -p "$LOG_DIR"

# ---- Frontend deps (before starting anything, so failures stop early) -------
log "Installing frontend dependencies..."
(cd "$FRONTEND_DIR" && npm install) || die "npm install failed"

# ---- Backend ----------------------------------------------------------------
log "Starting backend (logs: $LOG_DIR/backend.log)..."
(
  cd "$BACKEND_DIR"
  exec ./mvnw spring-boot:run \
    -Dspring-boot.run.arguments="--app.seed.personas.enabled=$SEED_PERSONAS"
) >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

log "Waiting for backend on port $BACKEND_PORT (up to ${BACKEND_TIMEOUT}s)..."
elapsed=0
until port_in_use "$BACKEND_PORT"; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    err "Backend exited during startup. Last log lines:"
    tail -n 30 "$LOG_DIR/backend.log" >&2 || true
    exit 1
  fi
  if (( elapsed >= BACKEND_TIMEOUT )); then
    err "Backend did not start within ${BACKEND_TIMEOUT}s. See $LOG_DIR/backend.log"
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
log "Backend is up."

# ---- Frontend ---------------------------------------------------------------
log "Starting frontend (logs: $LOG_DIR/frontend.log)..."
(
  cd "$FRONTEND_DIR"
  exec npm run dev
) >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

log "Both running. Backend PID=$BACKEND_PID, Frontend PID=$FRONTEND_PID"
log "Tail logs with: tail -f $LOG_DIR/backend.log $LOG_DIR/frontend.log"
log "Press Ctrl+C to stop both."

# ---- Supervise: exit if either process dies ---------------------------------
while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    err "Backend stopped unexpectedly. See $LOG_DIR/backend.log"
    exit 1
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    err "Frontend stopped unexpectedly. See $LOG_DIR/frontend.log"
    exit 1  
  fi
  sleep 2
done
#!/bin/zsh

set -u

PACKAGE_ROOT="${0:A:h}"
RUNTIME_NODE="$PACKAGE_ROOT/runtime/node"
SERVER_SCRIPT="$PACKAGE_ROOT/scripts/serve.mjs"
START_PORT="${BADGE_REMOVER_PORT:-4173}"
MAX_PORT=$((START_PORT + 20))

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "Badge Blur requires an Apple-silicon Mac."
  echo
  read -k 1 "REPLY?Press any key to close."
  echo
  exit 1
fi

if [[ ! -x "$RUNTIME_NODE" || ! -f "$SERVER_SCRIPT" ]]; then
  echo "The package is incomplete. Keep all files inside this folder together."
  echo
  read -k 1 "REPLY?Press any key to close."
  echo
  exit 1
fi

PACKAGE_VERSION="$(
  "$RUNTIME_NODE" -e \
    'console.log(require(process.argv[1]).version)' \
    "$PACKAGE_ROOT/package.json"
)"

is_badge_remover() {
  /usr/bin/curl --silent --fail --max-time 1 "${1}api/status" 2>/dev/null |
    /usr/bin/grep --quiet "\"appVersion\":\"${PACKAGE_VERSION}\""
}

open_app() {
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    /usr/bin/open -a "Google Chrome" "$1"
  elif [[ -d "/Applications/Microsoft Edge.app" ]]; then
    /usr/bin/open -a "Microsoft Edge" "$1"
  else
    /usr/bin/open "$1"
  fi
}

port="$START_PORT"
while (( port <= MAX_PORT )); do
  url="http://127.0.0.1:${port}/"

  if is_badge_remover "$url"; then
    open_app "$url"
    echo "Badge Blur is already running at $url"
    exit 0
  fi

  if ! /usr/bin/nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
    break
  fi

  (( port += 1 ))
done

if (( port > MAX_PORT )); then
  echo "Could not find an available local port."
  echo
  read -k 1 "REPLY?Press any key to close."
  echo
  exit 1
fi

export BADGE_REMOVER_PORT="$port"
"$RUNTIME_NODE" "$SERVER_SCRIPT" &
server_pid=$!

cleanup() {
  if kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null
    wait "$server_pid" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM HUP

ready=0
for attempt in {1..100}; do
  if is_badge_remover "$url"; then
    ready=1
    break
  fi

  if ! kill -0 "$server_pid" 2>/dev/null; then
    break
  fi

  sleep 0.1
done

if (( ready == 0 )); then
  echo "Badge Blur could not start."
  echo
  read -k 1 "REPLY?Press any key to close."
  echo
  exit 1
fi

open_app "$url"
echo
echo "Badge Blur is running privately on this Mac:"
echo "$url"
echo
echo "Keep this Terminal window open while using the app."
echo "Press Control-C or close this window to stop it."
echo

wait "$server_pid"

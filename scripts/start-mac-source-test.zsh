#!/bin/zsh

set -euo pipefail

SCRIPT_DIRECTORY="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIRECTORY:h}"
PORTABLE_NODE_BIN="${PROJECT_ROOT}/.runtime/node-current/bin"

if [[ -x "${PORTABLE_NODE_BIN}/node" ]]; then
  export PATH="${PORTABLE_NODE_BIN}:${PATH}"
fi

if ! command -v node >/dev/null 2>&1 ||
   ! command -v npm >/dev/null 2>&1 ||
   [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  print -u2 "Badge Blur needs its local setup refreshed."
  print -u2 "Run the two-command installer again to repair this source-test copy."
  exit 1
fi

cd "${PROJECT_ROOT}"
exec npm start

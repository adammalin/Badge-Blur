#!/bin/zsh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$PROJECT_ROOT"
npm run build

BADGE_REMOVER_SKIP_BUILD=1 zsh scripts/package-portable.sh
BADGE_REMOVER_SKIP_BUILD=1 zsh scripts/package-windows.sh

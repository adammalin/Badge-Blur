#!/bin/zsh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
NODE_VERSION="22.23.1"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe"
NODE_SHA256="f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed"
CACHE_DIR="$PROJECT_ROOT/.cache/windows-runtime"
NODE_EXE="$CACHE_DIR/node-v${NODE_VERSION}-win-x64.exe"
RELEASE_DIR="$PROJECT_ROOT/releases"
PACKAGE_NAME="Local Badge Remover"
ZIP_NAME="Local-Badge-Remover-Windows-x64-v${VERSION}.zip"
ZIP_PATH="$RELEASE_DIR/$ZIP_NAME"
CHECKSUM_PATH="$ZIP_PATH.sha256"
STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/badge-remover-windows.XXXXXX")"
PACKAGE_ROOT="$STAGING_ROOT/$PACKAGE_NAME"

cleanup() {
  if [[ "$STAGING_ROOT" == *"/badge-remover-windows."* && -d "$STAGING_ROOT" ]]; then
    /bin/rm -rf "$STAGING_ROOT"
  fi
}
trap cleanup EXIT

verify_node() {
  [[ -f "$NODE_EXE" ]] || return 1
  local actual
  actual="$(/usr/bin/shasum -a 256 "$NODE_EXE" | /usr/bin/awk '{print $1}')"
  [[ "$actual" == "$NODE_SHA256" ]]
}

/bin/mkdir -p "$CACHE_DIR" "$RELEASE_DIR"

if ! verify_node; then
  echo "Downloading the pinned official Windows Node runtime..."
  /usr/bin/curl --fail --location --retry 3 --output "$NODE_EXE" "$NODE_URL"
fi

if ! verify_node; then
  echo "Windows Node runtime checksum verification failed." >&2
  exit 1
fi

if ! /usr/bin/file "$NODE_EXE" | /usr/bin/grep -q "PE32+ executable.*x86-64"; then
  echo "Downloaded runtime is not a Windows x64 executable." >&2
  exit 1
fi

cd "$PROJECT_ROOT"
if [[ "${BADGE_REMOVER_SKIP_BUILD:-0}" != "1" ]]; then
  npm run build
fi

/bin/mkdir -p \
  "$PACKAGE_ROOT/runtime" \
  "$PACKAGE_ROOT/scripts"

/usr/bin/ditto "$PROJECT_ROOT/dist" "$PACKAGE_ROOT/dist"
/usr/bin/ditto "$PROJECT_ROOT/demo-test-images" "$PACKAGE_ROOT/demo-test-images"
/bin/cp "$NODE_EXE" "$PACKAGE_ROOT/runtime/node.exe"
/bin/cp "$PROJECT_ROOT/scripts/serve.mjs" "$PACKAGE_ROOT/scripts/serve.mjs"
/bin/cp "$PROJECT_ROOT/scripts/image-runtime.mjs" \
  "$PACKAGE_ROOT/scripts/image-runtime.mjs"
/bin/cp "$PROJECT_ROOT/packaging/package.json" \
  "$PACKAGE_ROOT/package.json"
/bin/cp "$PROJECT_ROOT/packaging/package-lock.json" \
  "$PACKAGE_ROOT/package-lock.json"
/bin/cp "$PROJECT_ROOT/packaging/Start Badge Remover.cmd" \
  "$PACKAGE_ROOT/Start Badge Remover.cmd"
/bin/cp "$PROJECT_ROOT/packaging/README-Windows.txt" "$PACKAGE_ROOT/README.txt"
/bin/cp "$PROJECT_ROOT/THIRD_PARTY_NOTICES.md" \
  "$PACKAGE_ROOT/THIRD_PARTY_NOTICES.md"

# Use native Windows line endings for the files recipients open directly.
/usr/bin/perl -pi -e 's/\r?\n/\r\n/g' \
  "$PACKAGE_ROOT/Start Badge Remover.cmd" \
  "$PACKAGE_ROOT/README.txt"

(
  cd "$PACKAGE_ROOT"
  npm ci --omit=dev --include=optional --os=win32 --cpu=x64
)

if [[ -e "$ZIP_PATH" || -e "$CHECKSUM_PATH" ]]; then
  echo "Release already exists. Move it aside or increment the version:" >&2
  echo "$ZIP_PATH" >&2
  exit 1
fi

(
  cd "$STAGING_ROOT"
  /usr/bin/zip -q -r -X "$ZIP_PATH" "$PACKAGE_NAME"
)
(
  cd "$RELEASE_DIR"
  /usr/bin/shasum -a 256 "$ZIP_NAME" > "$ZIP_NAME.sha256"
)

echo
echo "Created:"
echo "$ZIP_PATH"
echo "$CHECKSUM_PATH"

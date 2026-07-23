#!/bin/zsh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$PROJECT_ROOT/package.json').version")"
ARCH="$(uname -m)"
NODE_BIN="${PORTABLE_NODE_BIN:-$(command -v node)}"
RELEASE_DIR="$PROJECT_ROOT/releases"
PACKAGE_NAME="Local Badge Remover"
ZIP_NAME="Local-Badge-Remover-Mac-arm64-v${VERSION}.zip"
ZIP_PATH="$RELEASE_DIR/$ZIP_NAME"
CHECKSUM_PATH="$ZIP_PATH.sha256"
STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/badge-remover-package.XXXXXX")"
PACKAGE_ROOT="$STAGING_ROOT/$PACKAGE_NAME"
APP_ROOT="$PACKAGE_ROOT/Badge Remover.app"
APP_RESOURCES="$APP_ROOT/Contents/Resources"

cleanup() {
  if [[ "$STAGING_ROOT" == *"/badge-remover-package."* && -d "$STAGING_ROOT" ]]; then
    /bin/rm -rf "$STAGING_ROOT"
  fi
}
trap cleanup EXIT

if [[ "$ARCH" != "arm64" ]]; then
  echo "Portable packaging currently supports Apple silicon only." >&2
  exit 1
fi

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node runtime not found: $NODE_BIN" >&2
  exit 1
fi

if ! /usr/bin/file "$NODE_BIN" | /usr/bin/grep -q "arm64"; then
  echo "Node runtime is not an arm64 macOS executable: $NODE_BIN" >&2
  exit 1
fi

cd "$PROJECT_ROOT"
if [[ "${BADGE_REMOVER_SKIP_BUILD:-0}" != "1" ]]; then
  npm run build
fi

/bin/mkdir -p \
  "$APP_RESOURCES/runtime" \
  "$APP_RESOURCES/scripts" \
  "$RELEASE_DIR"

/usr/bin/ditto "$PROJECT_ROOT/packaging/Badge Remover.app" "$APP_ROOT"
/bin/mkdir -p \
  "$APP_RESOURCES/runtime" \
  "$APP_RESOURCES/scripts"
/usr/bin/ditto "$PROJECT_ROOT/dist" "$APP_RESOURCES/dist"
/usr/bin/ditto "$PROJECT_ROOT/demo-test-images" "$PACKAGE_ROOT/demo-test-images"
/bin/cp "$NODE_BIN" "$APP_RESOURCES/runtime/node"
/bin/cp "$PROJECT_ROOT/scripts/serve.mjs" "$APP_RESOURCES/scripts/serve.mjs"
/bin/cp "$PROJECT_ROOT/scripts/image-runtime.mjs" \
  "$APP_RESOURCES/scripts/image-runtime.mjs"
/bin/cp "$PROJECT_ROOT/packaging/package.json" \
  "$APP_RESOURCES/package.json"
/bin/cp "$PROJECT_ROOT/packaging/package-lock.json" \
  "$APP_RESOURCES/package-lock.json"
/bin/cp "$PROJECT_ROOT/packaging/README.txt" "$PACKAGE_ROOT/README.txt"
/bin/cp "$PROJECT_ROOT/THIRD_PARTY_NOTICES.md" \
  "$PACKAGE_ROOT/THIRD_PARTY_NOTICES.md"

/bin/chmod 755 \
  "$APP_RESOURCES/runtime/node" \
  "$PACKAGE_ROOT/Badge Remover.app/Contents/MacOS/Badge Remover"

/usr/libexec/PlistBuddy -c \
  "Set :CFBundleShortVersionString $VERSION" \
  "$PACKAGE_ROOT/Badge Remover.app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c \
  "Set :CFBundleVersion ${VERSION#0.}" \
  "$PACKAGE_ROOT/Badge Remover.app/Contents/Info.plist"

(
  cd "$APP_RESOURCES"
  npm ci --omit=dev --include=optional --os=darwin --cpu=arm64
)

# Ad-hoc signing verifies bundle integrity and catches malformed app bundles.
# Public distribution without a Gatekeeper warning still requires a real
# Developer ID signature and Apple notarization.
/usr/bin/codesign --force --deep --sign - \
  "$PACKAGE_ROOT/Badge Remover.app"
/usr/bin/codesign --verify --deep --strict \
  "$PACKAGE_ROOT/Badge Remover.app"

if [[ -e "$ZIP_PATH" || -e "$CHECKSUM_PATH" ]]; then
  echo "Release already exists. Move it aside or increment the version:" >&2
  echo "$ZIP_PATH" >&2
  exit 1
fi

/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_ROOT" "$ZIP_PATH"
(
  cd "$RELEASE_DIR"
  /usr/bin/shasum -a 256 "$ZIP_NAME" > "$ZIP_NAME.sha256"
)

echo
echo "Created:"
echo "$ZIP_PATH"
echo "$CHECKSUM_PATH"

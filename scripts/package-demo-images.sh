#!/bin/zsh

set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
SOURCE_DIR="$PROJECT_ROOT/demo-test-images"
DOWNLOAD_DIR="$PROJECT_ROOT/downloads"
ARCHIVE_NAME="Badge-Blur-Demo-Test-Images.zip"
ARCHIVE_PATH="$DOWNLOAD_DIR/$ARCHIVE_NAME"
CHECKSUM_PATH="$ARCHIVE_PATH.sha256"
STAGING_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/badge-blur-demo-images.XXXXXX")"
STAGED_ARCHIVE="$STAGING_ROOT/$ARCHIVE_NAME"

cleanup() {
  if [[ "$STAGING_ROOT" == *"/badge-blur-demo-images."* && -d "$STAGING_ROOT" ]]; then
    find "$STAGING_ROOT" -depth -delete
  fi
}
trap cleanup EXIT

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Demo image source folder is missing: $SOURCE_DIR" >&2
  exit 1
fi

/bin/mkdir -p "$DOWNLOAD_DIR"
(
  cd "$PROJECT_ROOT"
  COPYFILE_DISABLE=1 /usr/bin/zip -X -q -r \
    "$STAGED_ARCHIVE" \
    demo-test-images \
    -x "*.DS_Store"
)

/bin/mv -f "$STAGED_ARCHIVE" "$ARCHIVE_PATH"
(
  cd "$DOWNLOAD_DIR"
  /usr/bin/shasum -a 256 "$ARCHIVE_NAME" > "$ARCHIVE_NAME.sha256"
)

echo "Created:"
echo "$ARCHIVE_PATH"
echo "$CHECKSUM_PATH"

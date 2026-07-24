#!/bin/zsh

set -euo pipefail

SOURCE_ARCHIVE_URL="${BADGE_BLUR_SOURCE_ARCHIVE_URL:-https://github.com/adammalin/Badge-Blur/archive/refs/heads/main.zip}"
DEFAULT_TARGET_DIRECTORY="${PWD}/Badge-Blur-source-test"
TARGET_DIRECTORY="${1:-${DEFAULT_TARGET_DIRECTORY}}"
SKIP_SETUP="${BADGE_BLUR_BOOTSTRAP_SKIP_SETUP:-0}"

print ""
print "Badge Blur — source test bootstrap"
print "=================================="
print ""
print "Source: ${SOURCE_ARCHIVE_URL}"
print "Target: ${TARGET_DIRECTORY}"
print ""

if ! command -v curl >/dev/null 2>&1; then
  print -u2 "curl was not found. It is included with supported macOS versions."
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  print -u2 "unzip was not found. It is included with supported macOS versions."
  exit 1
fi

if [[ "${TARGET_DIRECTORY:A}" == "/" ||
      "${TARGET_DIRECTORY:A}" == "${HOME:A}" ||
      -L "${TARGET_DIRECTORY}" ]]; then
  print -u2 "Refusing to update an unsafe target: ${TARGET_DIRECTORY}"
  exit 1
fi

UPDATE_EXISTING=0
if [[ -e "${TARGET_DIRECTORY}" ]]; then
  if [[ ! -d "${TARGET_DIRECTORY}" ||
        ! -f "${TARGET_DIRECTORY}/package.json" ||
        ! -f "${TARGET_DIRECTORY}/scripts/setup-mac-source-test.zsh" ]] ||
      ! grep -q '"name"[[:space:]]*:[[:space:]]*"badge-blur"' \
        "${TARGET_DIRECTORY}/package.json"; then
    print -u2 "The existing target is not a recognized Badge Blur source-test folder:"
    print -u2 "${TARGET_DIRECTORY}"
    print -u2 "Nothing was overwritten."
    exit 1
  fi
  UPDATE_EXISTING=1
fi

TEMPORARY_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/badge-blur-bootstrap.XXXXXX")"
ARCHIVE_PATH="${TEMPORARY_DIRECTORY}/Badge-Blur-main.zip"
EXTRACT_DIRECTORY="${TEMPORARY_DIRECTORY}/extract"

cleanup() {
  if [[ -n "${TEMPORARY_DIRECTORY:-}" &&
        "${TEMPORARY_DIRECTORY}" == */badge-blur-bootstrap.* &&
        -d "${TEMPORARY_DIRECTORY}" ]]; then
    rm -rf "${TEMPORARY_DIRECTORY}"
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "${EXTRACT_DIRECTORY}"

print "Downloading the latest main-branch source ZIP..."
curl --fail --location --show-error \
  --output "${ARCHIVE_PATH}" \
  "${SOURCE_ARCHIVE_URL}"

print "Expanding the source ZIP..."
unzip -q "${ARCHIVE_PATH}" -d "${EXTRACT_DIRECTORY}"

EXPANDED_DIRECTORY="${EXTRACT_DIRECTORY}/Badge-Blur-main"
if [[ ! -f "${EXPANDED_DIRECTORY}/scripts/setup-mac-source-test.zsh" ]] ||
   ! grep -q '"name"[[:space:]]*:[[:space:]]*"badge-blur"' \
     "${EXPANDED_DIRECTORY}/package.json"; then
  print -u2 "The downloaded archive did not contain the expected setup script."
  exit 1
fi

if (( UPDATE_EXISTING )); then
  print "Updating the existing Badge Blur source-test folder..."
  print "Preserving downloaded models, generated exports, and repository metadata."
  rsync -a --delete \
    --exclude "/.git/" \
    --exclude "/node_modules/" \
    --exclude "/public/models/" \
    --exclude "/public/vendor/" \
    --exclude "/exports/" \
    --exclude "/badge-remover-output/" \
    --exclude "/releases/" \
    --exclude "/out/" \
    "${EXPANDED_DIRECTORY}/" "${TARGET_DIRECTORY}/"
else
  mv "${EXPANDED_DIRECTORY}" "${TARGET_DIRECTORY}"
fi

print ""
if (( UPDATE_EXISTING )); then
  print "Source updated in:"
else
  print "Source downloaded to:"
fi
print "${TARGET_DIRECTORY}"
print ""

if [[ "${SKIP_SETUP}" != "1" ]]; then
  zsh "${TARGET_DIRECTORY}/scripts/setup-mac-source-test.zsh"
fi

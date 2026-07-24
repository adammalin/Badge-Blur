#!/bin/zsh

set -euo pipefail

SOURCE_ARCHIVE_URL="https://github.com/adammalin/Badge-Blur/archive/refs/heads/main.zip"
DEFAULT_TARGET_DIRECTORY="${PWD}/Badge-Blur-source-test"
TARGET_DIRECTORY="${1:-${DEFAULT_TARGET_DIRECTORY}}"

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

if [[ -e "${TARGET_DIRECTORY}" ]]; then
  print -u2 "The target already exists, so nothing was overwritten:"
  print -u2 "${TARGET_DIRECTORY}"
  print -u2 ""
  print -u2 "Move or rename that folder, or provide a different destination:"
  print -u2 "zsh badge-blur-bootstrap.zsh /path/to/new-folder"
  exit 1
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
if [[ ! -f "${EXPANDED_DIRECTORY}/scripts/setup-mac-source-test.zsh" ]]; then
  print -u2 "The downloaded archive did not contain the expected setup script."
  exit 1
fi

mv "${EXPANDED_DIRECTORY}" "${TARGET_DIRECTORY}"

print ""
print "Source downloaded to:"
print "${TARGET_DIRECTORY}"
print ""

zsh "${TARGET_DIRECTORY}/scripts/setup-mac-source-test.zsh"

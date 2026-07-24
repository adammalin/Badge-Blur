#!/bin/zsh

set -euo pipefail

SCRIPT_DIRECTORY="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIRECTORY:h}"
PINNED_NODE_VERSION="22.23.1"
PORTABLE_RUNTIME_ROOT="${PROJECT_ROOT}/.runtime"
PORTABLE_NODE_LINK="${PORTABLE_RUNTIME_ROOT}/node-current"

print ""
print "Badge Blur — local source test setup"
print "====================================="
print ""
print "This runs Badge Blur from source through the official Electron runtime."
print "It does not install an app in /Applications, disable Gatekeeper, remove"
print "quarantine attributes, or make system-wide changes."
print ""

use_portable_node() {
  local machine_architecture node_architecture archive_name node_url
  local checksums_url temporary_directory archive_path checksums_path
  local expected_checksum actual_checksum extracted_directory runtime_directory

  for command_name in curl tar shasum; do
    if ! command -v "${command_name}" >/dev/null 2>&1; then
      print -u2 "${command_name} is required to install the local Node runtime."
      exit 1
    fi
  done

  machine_architecture="$(uname -m)"
  case "${machine_architecture}" in
    arm64)
      node_architecture="arm64"
      ;;
    x86_64)
      node_architecture="x64"
      ;;
    *)
      print -u2 "Unsupported Mac architecture: ${machine_architecture}"
      exit 1
      ;;
  esac

  archive_name="node-v${PINNED_NODE_VERSION}-darwin-${node_architecture}.tar.gz"
  node_url="https://nodejs.org/dist/v${PINNED_NODE_VERSION}/${archive_name}"
  checksums_url="https://nodejs.org/dist/v${PINNED_NODE_VERSION}/SHASUMS256.txt"
  runtime_directory="${PORTABLE_RUNTIME_ROOT}/node-v${PINNED_NODE_VERSION}-darwin-${node_architecture}"

  if [[ ! -x "${runtime_directory}/bin/node" ]]; then
    mkdir -p "${PORTABLE_RUNTIME_ROOT}"
    temporary_directory="$(mktemp -d "${PORTABLE_RUNTIME_ROOT}/download.XXXXXX")"
    archive_path="${temporary_directory}/${archive_name}"
    checksums_path="${temporary_directory}/SHASUMS256.txt"

    cleanup_runtime_download() {
      if [[ -n "${temporary_directory:-}" &&
            "${temporary_directory}" == "${PORTABLE_RUNTIME_ROOT}"/download.* &&
            -d "${temporary_directory}" ]]; then
        rm -rf "${temporary_directory}"
      fi
    }
    trap cleanup_runtime_download EXIT INT TERM

    print "Node.js 22 was not found. Downloading a private pinned runtime..."
    curl --fail --location --show-error --retry 3 \
      --output "${archive_path}" "${node_url}"
    curl --fail --location --show-error --retry 3 \
      --output "${checksums_path}" "${checksums_url}"

    expected_checksum="$(
      awk -v archive="${archive_name}" '$2 == archive { print $1 }' \
        "${checksums_path}"
    )"
    actual_checksum="$(shasum -a 256 "${archive_path}" | awk '{ print $1 }')"
    if [[ -z "${expected_checksum}" ||
          "${actual_checksum}" != "${expected_checksum}" ]]; then
      print -u2 "The downloaded Node.js checksum did not match the official list."
      exit 1
    fi

    tar -xzf "${archive_path}" -C "${temporary_directory}"
    extracted_directory="${temporary_directory}/${archive_name%.tar.gz}"
    if [[ ! -x "${extracted_directory}/bin/node" ]]; then
      print -u2 "The downloaded Node.js archive did not contain the expected runtime."
      exit 1
    fi
    if [[ -e "${runtime_directory}" ]]; then
      mv "${runtime_directory}" "${runtime_directory}.invalid.$(date +%Y%m%d-%H%M%S)"
    fi
    mv "${extracted_directory}" "${runtime_directory}"
    cleanup_runtime_download
    trap - EXIT INT TERM
  fi

  ln -sfn "${runtime_directory:t}" "${PORTABLE_NODE_LINK}"
  export PATH="${PORTABLE_NODE_LINK}/bin:${PATH}"
}

SYSTEM_NODE_USABLE=0
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "${NODE_MAJOR}" == "22" ]]; then
    SYSTEM_NODE_USABLE=1
  fi
fi

if (( ! SYSTEM_NODE_USABLE )); then
  use_portable_node
fi

if ! command -v node >/dev/null 2>&1 ||
   ! command -v npm >/dev/null 2>&1 ||
   [[ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]]; then
  print -u2 "Badge Blur could not prepare its required Node.js 22 runtime."
  exit 1
fi

if [[ "${BADGE_BLUR_SETUP_ONLY_RUNTIME:-0}" == "1" ]]; then
  print "Verified Node runtime: $(node --version)"
  exit 0
fi

cd "${PROJECT_ROOT}"

print "Project: ${PROJECT_ROOT}"
print "Node:    $(node --version)"
print "npm:     $(npm --version)"
print ""
print "Installing the exact dependency versions from package-lock.json..."
npm ci --no-audit --no-fund

print ""
print "Downloading or verifying the pinned local models and runtime files..."
npm run prepare

print ""
print "Building the local interface..."
npm run build

print ""
print "Setup complete. Starting Badge Blur..."
print "Close the Badge Blur window or press Command-Q to stop its local service."
print "For later launches, run: zsh scripts/start-mac-source-test.zsh"
print ""

exec zsh "${PROJECT_ROOT}/scripts/start-mac-source-test.zsh"

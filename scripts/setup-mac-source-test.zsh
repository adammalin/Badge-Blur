#!/bin/zsh

set -euo pipefail

SCRIPT_DIRECTORY="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIRECTORY:h}"

print ""
print "Badge Blur — local source test setup"
print "====================================="
print ""
print "This runs Badge Blur from source through the official Electron runtime."
print "It does not install an app in /Applications, disable Gatekeeper, remove"
print "quarantine attributes, or make system-wide changes."
print ""

if ! command -v node >/dev/null 2>&1; then
  print -u2 "Node.js was not found."
  print -u2 "Install the approved Node.js 22 release, then run this script again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  print -u2 "npm was not found. Reinstall the approved Node.js 22 package."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "${NODE_MAJOR}" != "22" ]]; then
  print -u2 "Badge Blur source testing currently requires Node.js 22."
  print -u2 "Detected: $(node --version)"
  exit 1
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
print "For later launches, open Terminal in this folder and run: npm start"
print ""

exec npm start

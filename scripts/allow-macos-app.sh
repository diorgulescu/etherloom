#!/usr/bin/env bash
# ==============================================================================
# scripts/allow-macos-app.sh
# Clears macOS Gatekeeper quarantine attributes (com.apple.quarantine) added by
# Safari/browsers on unsigned open-source builds and verifies ad-hoc signing for
# Apple Silicon (M1/M2/M3/M4, macOS 13 through macOS 27+).
# License: GNU GPLv3
# ==============================================================================

set -euo pipefail

usage() {
  cat <<EOF
Usage:
  $(basename "$0") [path/to/Etherloom.app]

Defaults to /Applications/Etherloom.app when no path is given.

Options:
  -h, --help   Show this help message
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

APP_PATH="${1:-/Applications/Etherloom.app}"

if [[ ! -d "${APP_PATH}" ]]; then
  printf '[ERROR] Application bundle not found at: %s\n' "${APP_PATH}" >&2
  printf 'Drag Etherloom.app into /Applications first, or pass its path explicitly.\n' >&2
  exit 1
fi

printf '[INFO]  Clearing com.apple.quarantine on %s ...\n' "${APP_PATH}"
xattr -dr com.apple.quarantine "${APP_PATH}" 2>/dev/null || true

if ! codesign --verify --deep --strict "${APP_PATH}" >/dev/null 2>&1; then
  printf '[INFO]  Applying Apple Silicon ad-hoc code signature ...\n'
  codesign --force --deep --sign - "${APP_PATH}"
fi

codesign --verify --deep --strict "${APP_PATH}"
printf '[OK]    %s is ready to launch on macOS!\n' "${APP_PATH}"

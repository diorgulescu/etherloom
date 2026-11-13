#!/usr/bin/env bash
# ==============================================================================
# scripts/prepare-library.sh
# Convenience entrypoint forwarding to scripts/prepare_library.sh.
# License: GNU GPLv3 (GPL-3.0-or-later)
# ==============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/prepare_library.sh" "$@"

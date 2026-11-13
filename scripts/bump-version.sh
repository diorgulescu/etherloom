#!/usr/bin/env bash
# ==============================================================================
# scripts/bump-version.sh
# Synchronizes and bumps Etherloom's semantic version (MAJOR.MINOR.PATCH) across
# VERSION, package.json, package-lock.json, Tauri config, and Cargo manifests.
# License: GNU GPLv3
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

VERSION_FILE="${REPO_ROOT}/VERSION"
PACKAGE_JSON="${REPO_ROOT}/package.json"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") <command> [version]

Commands:
  current            Print the current semantic version (e.g. 0.5.0)
  patch              Increment revision/patch version (e.g. 0.5.0 -> 0.5.1)
  minor              Increment minor version and reset patch (e.g. 0.5.2 -> 0.6.0)
  major              Increment major version and reset minor/patch (e.g. 0.6.1 -> 1.0.0)
  set <X.Y.Z>        Explicitly set semantic version to <X.Y.Z>
  sync               Synchronize all manifests to match VERSION without incrementing
  -h, --help         Show this help message

Environment:
  ETHERLOOM_SKIP_VERSION_BUMP=1   Skip automatic patch bump in .githooks/pre-commit
EOF
}

die() {
  printf '[bump-version] ERROR: %s\n' "$*" >&2
  exit 1
}

read_current_version() {
  if [[ -f "${VERSION_FILE}" ]]; then
    tr -d '[:space:]' < "${VERSION_FILE}"
    return 0
  fi

  python3 - "${PACKAGE_JSON}" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    print(json.load(fh)["version"].strip())
PY
}

validate_semver() {
  local ver="$1"
  if [[ ! "${ver}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    die "Invalid semantic version '${ver}' (expected MAJOR.MINOR.PATCH, e.g. 0.5.0)"
  fi
}

apply_version_everywhere() {
  local target_version="$1"
  validate_semver "${target_version}"

  printf '%s\n' "${target_version}" > "${VERSION_FILE}"

  python3 - "${REPO_ROOT}" "${target_version}" <<'PY'
import json
import os
import re
import sys

repo_root = sys.argv[1]
target_version = sys.argv[2]

def update_json_version(rel_path: str, update_lock_root: bool = False) -> None:
    full_path = os.path.join(repo_root, rel_path)
    if not os.path.isfile(full_path):
        return
    with open(full_path, "r", encoding="utf-8") as fh:
        content = fh.read()
    data = json.loads(content)
    data["version"] = target_version
    if update_lock_root and isinstance(data.get("packages"), dict) and "" in data["packages"]:
        data["packages"][""]["version"] = target_version
    serialized = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if serialized != content:
        with open(full_path, "w", encoding="utf-8") as fh:
            fh.write(serialized)

# 1. package.json, package-lock.json, src-tauri/tauri.conf.json
update_json_version("package.json")
update_json_version("package-lock.json", update_lock_root=True)
update_json_version(os.path.join("src-tauri", "tauri.conf.json"))

# 2. src-tauri/Cargo.toml ([package] version = "...")
cargo_toml = os.path.join(repo_root, "src-tauri", "Cargo.toml")
if os.path.isfile(cargo_toml):
    with open(cargo_toml, "r", encoding="utf-8") as fh:
        toml_text = fh.read()
    updated_toml, count = re.subn(
        r'(?m)^(\[package\]\s*\n(?:[^\[]*\n)*?version\s*=\s*")[^"]+(")',
        rf'\g<1>{target_version}\2',
        toml_text,
        count=1,
    )
    if count == 1 and updated_toml != toml_text:
        with open(cargo_toml, "w", encoding="utf-8") as fh:
            fh.write(updated_toml)

# 3. src-tauri/Cargo.lock ([[package]] name = "etherloom" version = "...")
cargo_lock = os.path.join(repo_root, "src-tauri", "Cargo.lock")
if os.path.isfile(cargo_lock):
    with open(cargo_lock, "r", encoding="utf-8") as fh:
        lock_text = fh.read()
    updated_lock, count = re.subn(
        r'(name\s*=\s*"etherloom"\s*\nversion\s*=\s*")[^"]+(")',
        rf'\g<1>{target_version}\2',
        lock_text,
        count=1,
    )
    if count == 1 and updated_lock != lock_text:
        with open(cargo_lock, "w", encoding="utf-8") as fh:
            fh.write(updated_lock)
PY
}

cmd="${1:-patch}"

case "${cmd}" in
  -h|--help|help)
    usage
    exit 0
    ;;
  current)
    read_current_version
    exit 0
    ;;
  sync)
    cur="$(read_current_version)"
    apply_version_everywhere "${cur}"
    printf '%s\n' "${cur}"
    ;;
  set)
    [[ $# -ge 2 ]] || die "Missing version argument for 'set' (e.g. $(basename "$0") set 0.5.0)"
    target="$2"
    apply_version_everywhere "${target}"
    printf '%s\n' "${target}"
    ;;
  patch|--patch|minor|--minor|major|--major)
    cur="$(read_current_version)"
    validate_semver "${cur}"
    IFS='.' read -r major minor patch <<< "${cur}"
    case "${cmd}" in
      patch|--patch)
        patch=$((patch + 1))
        ;;
      minor|--minor)
        minor=$((minor + 1))
        patch=0
        ;;
      major|--major)
        major=$((major + 1))
        minor=0
        patch=0
        ;;
    esac
    next_ver="${major}.${minor}.${patch}"
    apply_version_everywhere "${next_ver}"
    printf '%s\n' "${next_ver}"
    ;;
  *)
    die "Unknown command '${cmd}'. Run '$(basename "$0") --help' for usage."
    ;;
esac

#!/bin/bash
# sync-claude-config.sh — Merge host ~/.claude config into the container volume.
#
# Strategy:
#   1. rsync bulk files EXCEPT plugins/ and JSON configs (--ignore-existing)
#   2. rsync plugins/ directory with --update (newer file wins on conflicts)
#   3. JSON-merge key config files: host as base, container as overlay
#      (container values win on conflicts, new host entries are added)
#
# This runs as postStartCommand in the devcontainer.

set -euo pipefail

HOST_DIR="${CLAUDE_HOST_CONFIG_DIR:-/home/node/.claude-host}"
DEST_DIR="${CLAUDE_CONFIG_DIR:-/home/node/.claude}"

if [ ! -d "$HOST_DIR" ]; then
  echo "[sync-claude-config] No host config mounted at $HOST_DIR, skipping."
  exit 0
fi

echo "[sync-claude-config] Syncing host Claude config..."

# --- Step 1: rsync bulk files, skipping plugins/ and JSON configs ---
rsync -a --ignore-existing \
  --exclude "plugins/" \
  --exclude "settings.json" \
  --exclude ".claude.json" \
  "$HOST_DIR/" "$DEST_DIR/"

# --- Step 2: rsync plugins/ with --update (newer file wins) ---
# This picks up host-side edits to plugin files while preserving
# container-local edits that are more recent.
if [ -d "$HOST_DIR/plugins" ]; then
  rsync -a --update \
    --exclude "installed_plugins.json" \
    "$HOST_DIR/plugins/" "$DEST_DIR/plugins/"
  echo "[sync-claude-config] Synced plugins directory (newer files win)"
fi

# --- Step 3: JSON-aware merge for config files ---

# merge_json HOST_FILE DEST_FILE
#   Deep-merges two JSON files. DEST (container) values take precedence.
#   If only HOST exists, copies it. If only DEST exists, keeps it.
merge_json() {
  local host_file="$1"
  local dest_file="$2"

  if [ ! -f "$host_file" ]; then
    return  # nothing to merge from host
  fi

  if [ ! -f "$dest_file" ]; then
    # container has no version yet — just copy from host
    mkdir -p "$(dirname "$dest_file")"
    cp "$host_file" "$dest_file"
    echo "[sync-claude-config] Copied $(basename "$dest_file") from host (no local version)"
    return
  fi

  # Both exist — deep merge with container winning conflicts
  local merged
  merged=$(jq -s '.[0] * .[1]' "$host_file" "$dest_file" 2>/dev/null) || {
    echo "[sync-claude-config] Warning: failed to merge $(basename "$dest_file"), keeping container version"
    return
  }

  echo "$merged" > "$dest_file"
  echo "[sync-claude-config] Merged $(basename "$dest_file") (host base + container overlay)"
}

# merge_plugins HOST_FILE DEST_FILE
#   Special merge for installed_plugins.json: union of plugin keys.
#   If both sides have the same plugin, container version wins.
merge_plugins() {
  local host_file="$1"
  local dest_file="$2"

  if [ ! -f "$host_file" ]; then
    return
  fi

  if [ ! -f "$dest_file" ]; then
    mkdir -p "$(dirname "$dest_file")"
    cp "$host_file" "$dest_file"
    echo "[sync-claude-config] Copied installed_plugins.json from host (no local version)"
    return
  fi

  # Merge: take container's version field, union plugin entries (container wins per-key)
  local merged
  merged=$(jq -n \
    --slurpfile host "$host_file" \
    --slurpfile dest "$dest_file" \
    '$dest[0].version as $v | ($host[0].plugins // {}) * ($dest[0].plugins // {}) | {version: $v, plugins: .}' \
    2>/dev/null) || {
    echo "[sync-claude-config] Warning: failed to merge installed_plugins.json, keeping container version"
    return
  }

  echo "$merged" > "$dest_file"
  echo "[sync-claude-config] Merged installed_plugins.json (host base + container overlay)"
}

merge_plugins "$HOST_DIR/plugins/installed_plugins.json" "$DEST_DIR/plugins/installed_plugins.json"
merge_json "$HOST_DIR/settings.json" "$DEST_DIR/settings.json"
merge_json "$HOST_DIR/.claude.json" "$DEST_DIR/.claude.json"

echo "[sync-claude-config] Done."

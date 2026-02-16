#!/bin/bash
# sync-claude-config.sh — Merge host ~/.claude config into the container volume.
#
# Strategy:
#   1. Detect host's .claude path and set up path rewriting
#   2. rsync bulk files EXCEPT plugins/ and JSON configs (--ignore-existing)
#   3. rsync plugins/ directory with --update (newer file wins on conflicts)
#   4. JSON-merge key config files: host as base, container as overlay
#      (container values win on conflicts, new host entries are added)
#   5. Rewrite any remaining host paths in synced files
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

# --- Step 1: Detect the host's .claude directory path ---
# Look at installPath in the host's plugins manifest to find the host's home.
# e.g. "/home/tyto/.claude/plugins/cache/..." → HOST_CLAUDE_DIR="/home/tyto/.claude"
HOST_CLAUDE_DIR=""
if [ -f "$HOST_DIR/plugins/installed_plugins.json" ]; then
  HOST_CLAUDE_DIR=$(jq -r '
    [.plugins[][].installPath // empty] | first |
    capture("^(?<prefix>.*)/plugins/cache/") | .prefix
  ' "$HOST_DIR/plugins/installed_plugins.json" 2>/dev/null) || true
fi

if [ -n "$HOST_CLAUDE_DIR" ] && [ "$HOST_CLAUDE_DIR" != "$DEST_DIR" ]; then
  echo "[sync-claude-config] Host .claude path: $HOST_CLAUDE_DIR → rewriting to $DEST_DIR"
else
  HOST_CLAUDE_DIR=""  # no rewriting needed
fi

# rewrite_paths FILE
#   Replace host .claude paths with container paths in a file (in-place).
rewrite_paths() {
  local file="$1"
  if [ -z "$HOST_CLAUDE_DIR" ]; then
    return  # no rewriting needed
  fi
  if [ ! -f "$file" ]; then
    return
  fi
  # Only rewrite text files that actually contain the host path
  if grep -q "$HOST_CLAUDE_DIR" "$file" 2>/dev/null; then
    sed -i "s|$HOST_CLAUDE_DIR|$DEST_DIR|g" "$file"
  fi
}

# --- Step 2: rsync bulk files, skipping plugins/ and JSON configs ---
rsync -a --ignore-existing \
  --exclude "plugins/" \
  --exclude "settings.json" \
  --exclude ".claude.json" \
  "$HOST_DIR/" "$DEST_DIR/"

# Rewrite paths in any files that were just copied
if [ -n "$HOST_CLAUDE_DIR" ]; then
  find "$DEST_DIR" -maxdepth 1 -name "*.json" -newer "$HOST_DIR" -print0 2>/dev/null | \
    while IFS= read -r -d '' f; do rewrite_paths "$f"; done
  # Also catch config.json and any other top-level files that may have been copied
  for f in "$DEST_DIR"/config.json "$DEST_DIR"/.credentials.json; do
    rewrite_paths "$f"
  done
fi

# --- Step 3: rsync plugins/ with --update (newer file wins) ---
# This picks up host-side edits to plugin files while preserving
# container-local edits that are more recent.
if [ -d "$HOST_DIR/plugins" ]; then
  rsync -a --update \
    --exclude "installed_plugins.json" \
    "$HOST_DIR/plugins/" "$DEST_DIR/plugins/"
  echo "[sync-claude-config] Synced plugins directory (newer files win)"
fi

# --- Step 4: JSON-aware merge for config files ---

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
    rewrite_paths "$dest_file"
    echo "[sync-claude-config] Copied $(basename "$dest_file") from host (no local version)"
    return
  fi

  # Both exist — deep merge with container winning conflicts
  # If host file needs path rewriting, do it in a temp copy
  local host_source="$host_file"
  if [ -n "$HOST_CLAUDE_DIR" ] && grep -q "$HOST_CLAUDE_DIR" "$host_file" 2>/dev/null; then
    host_source=$(mktemp)
    sed "s|$HOST_CLAUDE_DIR|$DEST_DIR|g" "$host_file" > "$host_source"
  fi

  local merged
  merged=$(jq -s '.[0] * .[1]' "$host_source" "$dest_file" 2>/dev/null) || {
    echo "[sync-claude-config] Warning: failed to merge $(basename "$dest_file"), keeping container version"
    [ "$host_source" != "$host_file" ] && rm -f "$host_source"
    return
  }

  [ "$host_source" != "$host_file" ] && rm -f "$host_source"
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

  # Create a path-rewritten temp copy of the host file if needed
  local host_source="$host_file"
  if [ -n "$HOST_CLAUDE_DIR" ]; then
    host_source=$(mktemp)
    sed "s|$HOST_CLAUDE_DIR|$DEST_DIR|g" "$host_file" > "$host_source"
    echo "[sync-claude-config] Rewrote host plugin paths: $HOST_CLAUDE_DIR → $DEST_DIR"
  fi

  if [ ! -f "$dest_file" ]; then
    mkdir -p "$(dirname "$dest_file")"
    cp "$host_source" "$dest_file"
    [ "$host_source" != "$host_file" ] && rm -f "$host_source"
    echo "[sync-claude-config] Copied installed_plugins.json from host (no local version)"
    return
  fi

  # Merge: take container's version field, union plugin entries (container wins per-key)
  local merged
  merged=$(jq -n \
    --slurpfile host "$host_source" \
    --slurpfile dest "$dest_file" \
    '$dest[0].version as $v | ($host[0].plugins // {}) * ($dest[0].plugins // {}) | {version: $v, plugins: .}' \
    2>/dev/null) || {
    echo "[sync-claude-config] Warning: failed to merge installed_plugins.json, keeping container version"
    [ "$host_source" != "$host_file" ] && rm -f "$host_source"
    return
  }

  [ "$host_source" != "$host_file" ] && rm -f "$host_source"
  echo "$merged" > "$dest_file"
  echo "[sync-claude-config] Merged installed_plugins.json (host base + container overlay)"
}

merge_plugins "$HOST_DIR/plugins/installed_plugins.json" "$DEST_DIR/plugins/installed_plugins.json"
merge_json "$HOST_DIR/settings.json" "$DEST_DIR/settings.json"
merge_json "$HOST_DIR/.claude.json" "$DEST_DIR/.claude.json"
merge_json "$HOST_DIR/config.json" "$DEST_DIR/config.json"

echo "[sync-claude-config] Done."

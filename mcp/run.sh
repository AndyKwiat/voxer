#!/bin/sh
# Launches the Voxer MCP server. GUI apps (Claude desktop) don't load your shell profile, so `bun`
# may not be on PATH: look in $BUN, PATH, then the standard install locations.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
for b in "$BUN" "$(command -v bun 2>/dev/null)" "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
  if [ -n "$b" ] && [ -x "$b" ]; then
    PATH="$(dirname "$b"):$PATH"; export PATH  # so package scripts (bun run build) find bun too
    cd "$DIR" && exec "$b" mcp/server.ts
  fi
done
echo "voxer-mcp: bun not found; install it (https://bun.sh) or set BUN=/path/to/bun" >&2
exit 1

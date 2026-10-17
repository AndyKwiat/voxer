#!/bin/sh
# Launches the Voxer MCP server. GUI apps (Claude desktop) don't load your shell profile, so `bun`
# may not be on PATH: look in $BUN, PATH, then the standard install locations.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
for b in "$BUN" "$(command -v bun 2>/dev/null)" "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do
  if [ -n "$b" ] && [ -x "$b" ]; then
    PATH="$(dirname "$b"):$PATH"; export PATH  # so package scripts (bun run build) find bun too
    cd "$DIR" || exit 1
    # Clients like Claude Code connect stdio as a socket; older Bun can't read a socket stdin
    # (fstat EINVAL), so relay through pipes with cat. The server exits when stdin closes.
    cat | "$b" mcp/server.ts | cat
    exit $?
  fi
done
echo "voxer-mcp: bun not found; install it (https://bun.sh) or set BUN=/path/to/bun" >&2
exit 1

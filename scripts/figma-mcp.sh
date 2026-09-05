#!/usr/bin/env bash
# Minimal MCP client for the Figma Dev Mode server (streamable HTTP on localhost).
# Cursor's MCP namespace for Figma Desktop keeps dropping out; this talks to the
# same endpoint directly so the design can still be pulled.
#
# Usage: figma-mcp.sh <method> [json-params]
#   figma-mcp.sh tools/list
#   figma-mcp.sh tools/call '{"name":"get_metadata","arguments":{}}'
set -euo pipefail

URL="${FIGMA_MCP_URL:-http://127.0.0.1:3845/mcp}"
METHOD="$1"
PARAMS="${2:-}"
[ -n "$PARAMS" ] || PARAMS='{}'
ACCEPT='application/json, text/event-stream'

post() {
  curl -s -m 120 -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -H "Accept: $ACCEPT" \
    ${SESSION:+-H "mcp-session-id: $SESSION"} \
    -d "$1"
}

# Handshake: the session id comes back as a response header.
SESSION=$(curl -s -m 20 -D - -o /dev/null -X POST "$URL" \
  -H 'Content-Type: application/json' -H "Accept: $ACCEPT" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cursor-shell","version":"1.0"}}}' \
  | tr -d '\r' | awk 'tolower($1)=="mcp-session-id:"{print $2}')

[ -n "$SESSION" ] || { echo "could not get an mcp session from $URL" >&2; exit 1; }

post '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' >/dev/null

# Responses come back as SSE frames; unwrap the data payload.
post "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"$METHOD\",\"params\":$PARAMS}" \
  | sed -n 's/^data: //p'

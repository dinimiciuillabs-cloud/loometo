# Loometo MCP — drive the canvas from your AI coding agent

Point Claude Code, Codex, Cursor, or any MCP client at your running Loometo,
then just ask: *"build me a UGC pipeline"* or *"add a Text→Image node on
flux-2-pro and wire it to an Output."* Nodes appear and wire themselves in
your browser, live.

It's a zero-dependency stdio server (`loometo-mcp.mjs`, needs Node 18+). It
forwards each tool call to the Loometo dev server's canvas bridge — nothing to
install.

## 1. Start Loometo

```bash
npm run dev            # serves on http://localhost:3005
```
Open it in a browser tab and leave it open — that tab is what updates live.

## 2. Register the MCP server in your agent

Use the **absolute path** to `mcp/loometo-mcp.mjs`. Set `LOOMETO_URL` only if
you changed the port.

**Claude Code** — `.mcp.json` (project) or `~/.claude.json` (global), or run
`claude mcp add loometo -- node /abs/path/to/mcp/loometo-mcp.mjs`:
```jsonc
{
  "mcpServers": {
    "loometo": {
      "command": "node",
      "args": ["/abs/path/to/loometo/mcp/loometo-mcp.mjs"],
      "env": { "LOOMETO_URL": "http://localhost:3005" }
    }
  }
}
```

**Codex** — `~/.codex/config.toml`:
```toml
[mcp_servers.loometo]
command = "node"
args = ["/abs/path/to/loometo/mcp/loometo-mcp.mjs"]
env = { LOOMETO_URL = "http://localhost:3005" }
```

**Cursor / Cline / other** — same `command` + `args` shape in their MCP config.

## 3. Ask it to build

> "Look at the canvas, then add a Character Board, a Location Board, three
> Image→Video nodes on kling-v3, and wire them into Outputs."

## Tools

| Tool | What it does |
|---|---|
| `snapshot` | Read the current canvas (nodes + edges) — call before building |
| `add_node` | Add a node (`type`, optional `x`/`y`/`data`) → returns id |
| `connect` | Wire `source` → `target` (id or displayName) |
| `set_param` | Set fields (prompt, model, aspect ratio…) via a `patch` object |
| `run_node` / `run_all` | Fire one node or the whole graph |
| `delete_node` / `clear` | Remove a node / wipe the canvas |
| `select` / `pulse` | Highlight or flash nodes so the user sees what you mean |
| `list_models` | Real, valid model slugs + params for a category (e.g. "Text to Video") |

Nodes are addressable by the **displayName** on the card (e.g. `char-board-1`),
not just the internal id — so the agent can say "run char-board-1."

## Notes

- The bridge is **localhost-only, no auth** — it's a local dev tool. Don't
  expose the Loometo port to the internet.
- No server running? Every tool returns a friendly "start Loometo first" error.

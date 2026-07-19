#!/usr/bin/env node
// Loometo MCP server — lets any MCP-capable agent (Claude Code, Codex,
// Cursor, Cline, …) drive the Loometo canvas in natural language.
//
// It is a THIN adapter: every tool call is forwarded as an HTTP request to
// a running Loometo dev server's canvas bridge (POST /api/canvas/op,
// GET /api/canvas/snapshot, GET /api/canvas/models). The browser tab that
// has Loometo open is subscribed to the bridge's SSE stream, so nodes
// appear and wire themselves live as the agent works.
//
// ZERO dependencies on purpose: raw JSON-RPC 2.0 over stdio + Node's
// built-in fetch (Node 18+). Nothing to install.
//
// Config (in the agent's MCP settings):
//   "loometo": { "command": "node", "args": ["<abs path>/mcp/loometo-mcp.mjs"] }
// Point it at a non-default server with env LOOMETO_URL (default :3005).

import { createInterface } from 'node:readline'

const BASE = (process.env.LOOMETO_URL || 'http://localhost:3005').replace(/\/$/, '')
const log = (...a) => process.stderr.write('[loometo-mcp] ' + a.join(' ') + '\n')

// ── bridge helpers ──────────────────────────────────────────────────────────
// Node ids look like `node_1234`; anything else is treated as a human
// displayName (e.g. "char-board-1"), which the bridge resolves for us.
const isId = v => /^node_\d+$/.test(String(v))
const asIdOrName = v => (isId(v) ? { id: v } : { name: v })
const asSrc = v => (isId(v) ? { source: v } : { sourceName: v })
const asTgt = v => (isId(v) ? { target: v } : { targetName: v })

async function postOp(payload) {
  let res
  try {
    res = await fetch(`${BASE}/api/canvas/op`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error(`Can't reach Loometo at ${BASE}. Start it first: npm run dev (in the Loometo folder), and open it in a browser tab.`)
  }
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.ok === false) throw new Error(j.error || `bridge HTTP ${res.status}`)
  return j
}

async function getJson(path) {
  let res
  try { res = await fetch(`${BASE}${path}`) }
  catch { throw new Error(`Can't reach Loometo at ${BASE}. Is the dev server running?`) }
  if (!res.ok) throw new Error(`bridge HTTP ${res.status}`)
  return res.json()
}

// ── tool registry ───────────────────────────────────────────────────────────
// Each tool: JSON Schema for the agent + a run() that hits the bridge and
// returns a plain-text result string.
const S = (props, required = []) => ({ type: 'object', properties: props, required })
const str = desc => ({ type: 'string', description: desc })
const num = desc => ({ type: 'number', description: desc })

const TOOLS = {
  add_node: {
    description: 'Add a node to the Loometo canvas. `type` is the node type (e.g. "promptNode", "textToImageNode", "imageToVideoNode", "characterBoardNode", "ttsNode", "outputNode"). Returns the new node id — use it (or the node\'s displayName shown on canvas) to wire and configure it.',
    schema: S({
      type: str('Node type id, e.g. textToImageNode, imageToVideoNode, characterBoardNode, ttsNode, outputNode'),
      x: num('Canvas x position (optional)'),
      y: num('Canvas y position (optional)'),
      data: { type: 'object', description: 'Initial field values, e.g. {"prompt":"a red bike"} or {"llm":"flux-2-pro"}' },
    }, ['type']),
    run: async a => {
      const r = await postOp({ op: 'add_node', type: a.type, position: (a.x != null && a.y != null) ? { x: a.x, y: a.y } : undefined, data: a.data })
      return `Added ${a.type} → id ${r.id}`
    },
  },
  connect: {
    description: 'Wire one node\'s output to another node\'s input. source/target accept either a node id (node_123) or the displayName shown on the card (e.g. "char-board-1"). Optionally pin sourceHandle/targetHandle when a node has multiple ports.',
    schema: S({
      source: str('Source node id or displayName'),
      target: str('Target node id or displayName'),
      sourceHandle: str('Source output handle id (optional)'),
      targetHandle: str('Target input handle id (optional)'),
    }, ['source', 'target']),
    run: async a => {
      const r = await postOp({ op: 'connect', ...asSrc(a.source), ...asTgt(a.target), sourceHandle: a.sourceHandle, targetHandle: a.targetHandle })
      return `Connected ${a.source} → ${a.target}${r.id ? ` (edge ${r.id})` : ''}`
    },
  },
  set_param: {
    description: 'Set fields on a node (prompt text, chosen model, aspect ratio, etc.). `node` is an id or displayName; `patch` is an object of field→value.',
    schema: S({
      node: str('Node id or displayName'),
      patch: { type: 'object', description: 'Fields to set, e.g. {"prompt":"golden hour", "llm":"kling-v3"}' },
    }, ['node', 'patch']),
    run: async a => {
      await postOp({ op: 'set_param', ...asIdOrName(a.node), patch: a.patch })
      return `Set ${Object.keys(a.patch || {}).join(', ')} on ${a.node}`
    },
  },
  run_node: {
    description: 'Run a single node (fires its generation). `node` is an id or displayName.',
    schema: S({ node: str('Node id or displayName') }, ['node']),
    run: async a => { await postOp({ op: 'run_node', ...asIdOrName(a.node) }); return `Running ${a.node}` },
  },
  run_all: {
    description: 'Run every runnable node on the canvas in dependency order.',
    schema: S({}),
    run: async () => { await postOp({ op: 'run_all' }); return 'Running all nodes' },
  },
  delete_node: {
    description: 'Delete a node (and its wires). `node` is an id or displayName.',
    schema: S({ node: str('Node id or displayName') }, ['node']),
    run: async a => { await postOp({ op: 'delete_node', ...asIdOrName(a.node) }); return `Deleted ${a.node}` },
  },
  clear: {
    description: 'Remove all nodes and edges from the canvas. Destructive.',
    schema: S({}),
    run: async () => { await postOp({ op: 'clear' }); return 'Canvas cleared' },
  },
  select: {
    description: 'Select a node (highlights it in the browser), or pass no node to deselect all.',
    schema: S({ node: str('Node id or displayName (omit to deselect all)') }),
    run: async a => { await postOp({ op: 'select', ...(a.node ? asIdOrName(a.node) : {}) }); return a.node ? `Selected ${a.node}` : 'Deselected all' },
  },
  pulse: {
    description: 'Briefly flash one or more nodes in the browser so the user can SEE which nodes you are talking about. Accepts a list of ids or displayNames.',
    schema: S({ nodes: { type: 'array', items: { type: 'string' }, description: 'Node ids or displayNames to flash' } }, ['nodes']),
    run: async a => {
      const names = (a.nodes || []).filter(v => !isId(v))
      const ids = (a.nodes || []).filter(isId)
      await postOp({ op: 'pulse', names, ids })
      return `Pulsed ${(a.nodes || []).join(', ')}`
    },
  },
  snapshot: {
    description: 'Read the current canvas: every node (id, type, displayName) and every edge. Use this to see what already exists before adding or wiring.',
    schema: S({}),
    run: async () => {
      const snap = await getJson('/api/canvas/snapshot')
      const nodes = (snap.nodes || []).map(n => ({ id: n.id, type: n.type, name: n.data?.displayName }))
      const edges = (snap.edges || []).map(e => ({ from: e.source, to: e.target }))
      return JSON.stringify({ nodes, edges }, null, 2)
    },
  },
  list_models: {
    description: 'List real, valid model slugs for a node. Filter by category (e.g. "Text to Video", "Text to Image"), family, or free-text q. Returns model names + their param schema so you can build a valid set_param patch.',
    schema: S({
      category: str('e.g. "Text to Video", "Text to Image", "Image to Video"'),
      family: str('Model family filter (optional)'),
      q: str('Free-text search (optional)'),
    }),
    run: async a => {
      const qs = new URLSearchParams()
      if (a.category) qs.set('category', a.category)
      if (a.family) qs.set('family', a.family)
      if (a.q) qs.set('q', a.q)
      const r = await getJson(`/api/canvas/models?${qs.toString()}`)
      const compact = (r.models || []).slice(0, 40).map(m => ({ name: m.name, category: m.category, family: m.family, params: Object.keys(m.params || {}) }))
      return JSON.stringify({ count: r.count, showing: compact.length, models: compact }, null, 2)
    },
  },
}

// ── JSON-RPC / MCP plumbing ─────────────────────────────────────────────────
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n')
const ok = (id, result) => send({ jsonrpc: '2.0', id, result })
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

async function handle(msg) {
  const { id, method, params } = msg
  // Notifications (no id) never get a response.
  if (id === undefined || id === null) return

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'loometo', version: '0.1.0' },
    })
  }
  if (method === 'ping') return ok(id, {})
  if (method === 'tools/list') {
    return ok(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.schema })),
    })
  }
  if (method === 'tools/call') {
    const tool = TOOLS[params?.name]
    if (!tool) return err(id, -32601, `Unknown tool: ${params?.name}`)
    try {
      const text = await tool.run(params.arguments || {})
      return ok(id, { content: [{ type: 'text', text }] })
    } catch (e) {
      // Report tool failures as content+isError so the agent can react,
      // per MCP convention (not a protocol-level error).
      return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true })
    }
  }
  return err(id, -32601, `Unknown method: ${method}`)
}

const rl = createInterface({ input: process.stdin })
rl.on('line', line => {
  const s = line.trim()
  if (!s) return
  let msg
  try { msg = JSON.parse(s) } catch { return log('bad JSON line dropped') }
  handle(msg).catch(e => log('handler error:', e.message))
})
log(`ready → bridging to ${BASE}`)

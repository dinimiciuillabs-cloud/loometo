// POST /api/canvas/op
// External callers (Claude Code via curl, n8n, scripts) submit canvas
// operations here. The op is assigned IDs as needed, emitted onto the bus,
// and the resulting IDs returned so the caller can chain follow-up ops.

import { NextRequest, NextResponse } from 'next/server'
import { emitOp, nextNodeId, nextEdgeId, getSnapshot, type CanvasOp } from '@/lib/canvas/bus'
import { guardLocalJson } from '@/lib/server/guard'

interface RawOp {
  op: string
  // pass-through fields for each op variant
  type?: string
  position?: { x: number; y: number }
  data?: Record<string, unknown>
  source?: string
  sourceName?: string
  target?: string
  targetName?: string
  sourceHandle?: string
  targetHandle?: string
  id?: string
  ids?: string[]
  name?: string          // human-readable displayName alternative to id
  names?: string[]
  patch?: Record<string, unknown>
  key?: string
  value?: unknown
}

// Resolve a displayName → internal node id via the latest snapshot.
// Returns undefined if no match. Case-insensitive.
function resolveNameToId(name: string): string | undefined {
  const snap = getSnapshot()
  const target = name.trim().toLowerCase()
  const match = snap.nodes.find(n => {
    const dn = n.data?.displayName
    return typeof dn === 'string' && dn.toLowerCase() === target
  })
  return match?.id
}

// For ops with an id field: accept either `id` (internal) or `name`
// (displayName). Returns the resolved id, or null if neither provided
// or `name` doesn't match any node.
function resolveId(body: RawOp): { id: string | null; usedName?: string } {
  if (body.id) return { id: body.id }
  if (body.name) {
    const id = resolveNameToId(body.name)
    return { id: id ?? null, usedName: body.name }
  }
  return { id: null }
}

export async function POST(req: NextRequest) {
  const guard = guardLocalJson(req)
  if (guard) return guard
  let body: RawOp
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }) }

  const op = normalize(body)
  if (!op) {
    // Be helpful: if the caller used `name` and it didn't resolve, say so
    // explicitly rather than the generic "Unknown op" — this was a real
    // silent-failure bug class before name-aware lookup landed.
    if (body.name && (body.op === 'set_param' || body.op === 'run_node' || body.op === 'delete_node' || body.op === 'select')) {
      const snap = getSnapshot()
      const known = snap.nodes
        .map(n => n.data?.displayName)
        .filter((x): x is string => typeof x === 'string')
      return NextResponse.json({
        ok: false,
        error: `No node found with displayName "${body.name}". Known names: ${known.join(', ') || '(none)'}`,
      }, { status: 404 })
    }
    return NextResponse.json({ ok: false, error: `Unknown op: ${body.op}` }, { status: 400 })
  }

  emitOp(op)
  // Surface new IDs in the response so the caller can chain follow-up ops.
  const idField =
    op.op === 'add_node' ? { id: op.id } :
    op.op === 'connect' ? { id: op.id } : {}
  return NextResponse.json({ ok: true, ...idField })
}

function normalize(b: RawOp): CanvasOp | null {
  switch (b.op) {
    case 'add_node':
      if (!b.type) return null
      return {
        op: 'add_node',
        type: b.type,
        position: b.position,
        data: b.data,
        id: b.id ?? nextNodeId(),
      }
    case 'connect': {
      // Allow source/target to be either id OR displayName via
      // sourceName/targetName. Resolve both to ids before emitting.
      const src = b.source ?? (b.sourceName ? resolveNameToId(b.sourceName) : undefined)
      const tgt = b.target ?? (b.targetName ? resolveNameToId(b.targetName) : undefined)
      if (!src || !tgt) return null
      return {
        op: 'connect',
        source: src,
        target: tgt,
        sourceHandle: b.sourceHandle,
        targetHandle: b.targetHandle,
        id: b.id ?? nextEdgeId(),
      }
    }
    case 'set_param': {
      const { id } = resolveId(b)
      if (!id) return null
      const patch: Record<string, unknown> =
        b.patch ?? (b.key !== undefined ? { [b.key]: b.value } : {})
      // Forward the original displayName too. The browser uses it as a
      // fallback when `id` doesn't resolve in its local Zustand (the
      // server snapshot can hold stale ids after a workflow reload or
      // id-collision fix). Without this, set_param silently no-ops.
      return { op: 'set_param', id, patch, name: b.name }
    }
    case 'delete_node': {
      const { id } = resolveId(b)
      if (!id) return null
      return { op: 'delete_node', id, name: b.name }
    }
    case 'delete_edge':
      if (!b.id) return null
      return { op: 'delete_edge', id: b.id }
    case 'clear':
      return { op: 'clear' }
    case 'run_node': {
      const { id } = resolveId(b)
      if (!id) return null
      return { op: 'run_node', id, name: b.name }
    }
    case 'run_all':
      return { op: 'run_all' }
    case 'pulse': {
      // Blue (or any external caller) addresses one or more nodes by
      // displayName / id and the browser pulses them so the user can
      // SEE which nodes are being referenced. Accepts: name, names[],
      // id, ids[]. Returns the resolved ids in the response.
      const names = b.names ?? (b.name ? [b.name] : [])
      const directIds = b.ids ?? (b.id ? [b.id] : [])
      const resolved: string[] = [...directIds]
      for (const nm of names) {
        const found = resolveNameToId(nm)
        if (found) resolved.push(found)
      }
      // `inspect` already triggers pulseNode on the browser via SSE.
      return { op: 'inspect', ids: resolved }
    }
    case 'select': {
      // select tolerates null (deselect-all)
      if (b.id || b.name) {
        const { id } = resolveId(b)
        return { op: 'select', id }
      }
      return { op: 'select', id: null }
    }
    default:
      return null
  }
}

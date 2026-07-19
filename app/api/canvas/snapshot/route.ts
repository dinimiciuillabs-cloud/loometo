// GET  /api/canvas/snapshot  → returns the latest mirror of the canvas
//                              (nodes + edges + selected ids).
// POST /api/canvas/snapshot  → the browser pushes its current state here
//                              whenever the Zustand store changes.

import { NextRequest, NextResponse } from 'next/server'
import { getSnapshot, setSnapshot, emitOp, type CanvasSnapshot } from '@/lib/canvas/bus'
import { guardLocal, guardLocalJson } from '@/lib/server/guard'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = guardLocal(req)
  if (guard) return guard
  const snap = getSnapshot()
  // Fire a visual ping so the user can see when Claude / a script is
  // looking at the canvas. Pulses every node briefly through the same
  // SSE channel as write ops.
  const ids = snap.nodes.map(n => n.id)
  if (ids.length > 0) emitOp({ op: 'inspect', ids })
  return NextResponse.json(snap)
}

export async function POST(req: NextRequest) {
  const guard = guardLocalJson(req)
  if (guard) return guard
  let body: Partial<CanvasSnapshot>
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }) }

  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    return NextResponse.json({ ok: false, error: 'Body must include nodes[] and edges[]' }, { status: 400 })
  }
  setSnapshot({
    nodes: body.nodes,
    edges: body.edges,
    updatedAt: Date.now(),
  })
  return NextResponse.json({ ok: true })
}

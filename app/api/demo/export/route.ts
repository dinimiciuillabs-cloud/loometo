// POST /api/demo/export
//
// Localhost-only. Dumps the current canvas snapshot (the same one the
// browser bridge keeps up to date) into /public/demos/<slug>.json as a
// demo payload that the /demo/[slug] page can load.
//
// Curl example:
//   curl -X POST http://localhost:3005/api/demo/export \
//     -H "Content-Type: application/json" \
//     -d '{"slug":"applegreen-ugc","name":"Applegreen UGC","description":"Three-clip pipeline"}'
//
// The route reads the snapshot from the in-memory bus (lib/canvas/bus.ts)
// which the CanvasBridge keeps fresh whenever nodes or edges change.

import { NextRequest, NextResponse } from 'next/server'
import { getSnapshot } from '@/lib/canvas/bus'
import { promises as fs } from 'fs'
import path from 'path'
import { guardLocalJson } from '@/lib/server/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Body {
  slug: string
  name?: string
  description?: string
  ctaUrl?: string
  ctaLabel?: string
}

function isLocalRequest(req: NextRequest): boolean {
  const host = req.headers.get('host') ?? ''
  const hostname = host.split(':')[0]
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

function sanitizeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export async function POST(req: NextRequest) {
  const guard = guardLocalJson(req)
  if (guard) return guard

  let body: Body
  try { body = (await req.json()) as Body }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }) }

  const slug = sanitizeSlug(body.slug || '')
  if (!slug) return NextResponse.json({ ok: false, error: 'slug is required' }, { status: 400 })

  const snap = getSnapshot()
  if (!snap.nodes.length) {
    return NextResponse.json({ ok: false, error: 'Canvas snapshot is empty — open Loometo in a browser tab first so the bridge can mirror the canvas to the server.' }, { status: 400 })
  }

  // Strip anything we don't want in a public demo. Generated URLs
  // (R2-hosted images/videos) are fine — they're already public. But
  // stripping `selected` keeps the dump clean.
  const payload = {
    name: body.name,
    description: body.description,
    ctaUrl: body.ctaUrl,
    ctaLabel: body.ctaLabel,
    exportedAt: new Date().toISOString(),
    nodes: snap.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })),
    edges: snap.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'accent',
    })),
  }

  const file = path.join(process.cwd(), 'public', 'demos', `${slug}.json`)
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: `Write failed: ${msg}` }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    slug,
    file: `/demos/${slug}.json`,
    nodeCount: payload.nodes.length,
    edgeCount: payload.edges.length,
    demoUrl: `/demo/${slug}`,
  })
}

// Convenience GET — lists existing demos so the user can see what's
// already on disk.
export async function GET(req: NextRequest) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: 'localhost only' }, { status: 403 })
  }
  const dir = path.join(process.cwd(), 'public', 'demos')
  try {
    const entries = await fs.readdir(dir)
    const demos = entries
      .filter(f => f.endsWith('.json'))
      .map(f => ({ slug: f.replace(/\.json$/, ''), url: `/demo/${f.replace(/\.json$/, '')}` }))
    return NextResponse.json({ ok: true, demos })
  } catch {
    return NextResponse.json({ ok: true, demos: [] })
  }
}

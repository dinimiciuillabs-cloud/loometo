// Server-side proxy for Google's Generative Language API.
//
// Why this exists: although Google's API technically permits browser-direct
// calls with ?key=API_KEY auth, that pattern leaks the key into the bundle
// and depends on Google's CORS posture continuing to allow our origin.
// Routing through this proxy keeps the key on the server (process.env.
// GOOGLE_API_KEY) and gives us one place to log/debug failures.
//
// More importantly: Google's Nano Banana accepts base64 inline_data, so
// going through this proxy lets us avoid the MuAPI signed-URL pattern
// entirely for image-edit nodes. The browser sends base64; the server
// forwards to Google; Google reads the bytes directly without any URL
// fetching.

import { NextRequest, NextResponse } from 'next/server'
import { guardLocalJson } from '@/lib/server/guard'

export const dynamic = 'force-dynamic'

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'

function isLocalRequest(req: NextRequest): boolean {
  const host = req.headers.get('host') ?? ''
  const hostname = host.split(':')[0]
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

interface Body {
  // Path under /v1beta/, e.g. "models/gemini-2.5-flash-image-preview:generateContent"
  // or "models/veo-3.1-generate-001:predictLongRunning" or "operations/<name>".
  path: string
  method?: 'GET' | 'POST'
  body?: unknown
}

export async function POST(req: NextRequest) {
  const jsonGuard = guardLocalJson(req)
  if (jsonGuard) return jsonGuard
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: 'Proxy is localhost-only' }, { status: 403 })
  }
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'GOOGLE_API_KEY missing in .env.local' }, { status: 500 })
  }

  let body: Body
  try { body = (await req.json()) as Body }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }) }
  if (!body.path) return NextResponse.json({ ok: false, error: 'Missing path' }, { status: 400 })

  const method = body.method ?? 'POST'
  // Paths can already carry a query string (e.g. files/x:download?alt=media).
  // Append the key with the right separator so we don't produce ?alt=media?key=...
  const cleanPath = body.path.replace(/^\//, '')
  const sep = cleanPath.includes('?') ? '&' : '?'
  const url = `${GOOGLE_BASE}/${cleanPath}${sep}key=${apiKey}`

  // Binary file downloads (Veo video output, Imagen file outputs, etc.)
  // come down as raw bytes — the JSON-as-text dance below corrupts them.
  // Detect file download paths and stream bytes straight through.
  const isFileDownload = /^files\/.+:download/.test(body.path.replace(/^\//, ''))

  try {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
    if (method === 'POST') init.body = JSON.stringify(body.body ?? {})
    const res = await fetch(url, init)

    if (isFileDownload) {
      const buf = await res.arrayBuffer()
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
      console.log(`[proxy/google ${method} ${body.path}] HTTP ${res.status} bytes=${buf.byteLength}`)
      return new NextResponse(buf, {
        status: res.status,
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=3600',
        },
      })
    }

    const text = await res.text()
    console.log(`[proxy/google ${method} ${body.path}] HTTP ${res.status}`)
    if (!res.ok) console.log(`  upstream body: ${text.slice(0, 600)}`)
    return new NextResponse(text, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: `Upstream fetch failed: ${message}` }, { status: 502 })
  }
}

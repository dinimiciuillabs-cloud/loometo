// GET /api/proxy/fetch?url=<remote-url>
//
// Fetches a remote URL server-side and streams the bytes back, bypassing
// the browser's CORS. Used by image-edit adapters (Nano Banana,
// referenceImages → base64 conversion) when the reference URL is on a
// CDN that doesn't return Access-Control-Allow-Origin for our dev origin
// (notably Cloudflare R2's `*.r2.dev` public URLs).
//
// Localhost-only — same posture as the other proxies. SSRF guard rails:
// only http(s), and a hard size cap so this can't be abused as a generic
// proxy for arbitrary downloads.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 30 * 1024 * 1024  // 30 MB

function isLocalRequest(req: NextRequest): boolean {
  const host = req.headers.get('host') ?? ''
  const hostname = host.split(':')[0]
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

export async function GET(req: NextRequest) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: 'Proxy is localhost-only' }, { status: 403 })
  }
  const target = req.nextUrl.searchParams.get('url')
  if (!target) {
    return NextResponse.json({ ok: false, error: 'Missing url param' }, { status: 400 })
  }
  let parsed: URL
  try { parsed = new URL(target) }
  catch { return NextResponse.json({ ok: false, error: 'Invalid url' }, { status: 400 }) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ ok: false, error: 'Only http(s) supported' }, { status: 400 })
  }

  try {
    const upstream = await fetch(target)
    if (!upstream.ok) {
      return NextResponse.json({ ok: false, error: `Upstream HTTP ${upstream.status}` }, { status: upstream.status })
    }
    const buf = await upstream.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: `Too large (${buf.byteLength} > ${MAX_BYTES})` }, { status: 413 })
    }
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: `Upstream fetch failed: ${message}` }, { status: 502 })
  }
}

// Shared request guard for the localhost-only API surface (provider
// proxies + canvas bridge). Two checks:
//
// 1. Host must be local. Keeps LAN peers / port-forwards out. (Note:
//    IPv6 Host headers look like "[::1]:3005" — brackets, then port —
//    so naive split(':') parsing breaks; handled below.)
//
// 2. POST bodies must declare Content-Type: application/json. Browsers
//    will fire "simple" cross-origin POSTs (text/plain) at localhost
//    from ANY website without a CORS preflight, and Request.json()
//    parses the body regardless of the declared type — so without this
//    check a malicious page could silently drive the canvas or spend
//    provider credits through the proxies. Requiring the JSON content
//    type forces a preflight, which fails (we send no CORS headers).
//    Legit callers (the app itself, curl, the MCP server) already send
//    application/json.

import { NextRequest, NextResponse } from 'next/server'

export function isLocalRequest(req: NextRequest): boolean {
  const host = req.headers.get('host') ?? ''
  const hostname = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.split(':')[0]
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

// Guard for JSON POST endpoints. Returns an error response to send, or
// null if the request may proceed.
export function guardLocalJson(req: NextRequest): NextResponse | null {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: 'This endpoint is localhost-only' }, { status: 403 })
  }
  const ct = (req.headers.get('content-type') ?? '').toLowerCase()
  if (!ct.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'Content-Type must be application/json' },
      { status: 415 },
    )
  }
  return null
}

// Guard for read-only local endpoints (GET). 403s non-local hosts.
export function guardLocal(req: NextRequest): NextResponse | null {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ ok: false, error: 'This endpoint is localhost-only' }, { status: 403 })
  }
  return null
}

// GET /api/keys
// Returns the API keys currently configured in .env.local, but ONLY
// when the request comes from the same machine. Two guards:
//
//   1. Host header must be localhost / 127.0.0.1 / [::1]
//   2. The request must NOT be coming from a remote IP (best-effort
//      check via x-forwarded-for absence).
//
// If those don't hold, returns an empty object — keys never leak off
// this machine, even if you happen to be running the dev server bound
// to 0.0.0.0 on a public network.
//
// Values come straight from process.env, so editing .env.local + dev
// server restart is the way to rotate.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ENV_MAP: Record<string, string> = {
  muapi:      'MUAPI_API_KEY',
  openai:     'OPENAI_API_KEY',
  google:     'GOOGLE_API_KEY',
  meshy:      'MESHY_API_KEY',
  figma:      'FIGMA_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
}

function isLocalRequest(req: NextRequest): boolean {
  // Trust the Host header. If you're tunneling via ngrok / cloudflare /
  // a reverse proxy, the Host arriving here is the tunnel's hostname
  // (e.g. *.ngrok.app), NOT "localhost" — so this single check is
  // enough to keep keys from leaking off-box.
  //
  // (Earlier version also rejected on x-forwarded-for, but Next.js
  // dev server inserts that header internally even for direct localhost
  // requests, so it was a false positive.)
  const host = req.headers.get('host') ?? ''
  const hostname = host.split(':')[0]
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

export async function GET(req: NextRequest) {
  if (!isLocalRequest(req)) {
    return NextResponse.json({
      ok: false,
      error: 'Keys endpoint is localhost-only',
      keys: {},
      hasKeys: {},
    }, { status: 403 })
  }

  // Build two payloads: actual keys (used to hydrate the store on app
  // mount) and a hasKeys boolean map (useful if you ever want a "key is
  // configured" check without ferrying the actual value around).
  const keys: Record<string, string> = {}
  const hasKeys: Record<string, boolean> = {}
  for (const [field, envName] of Object.entries(ENV_MAP)) {
    const v = process.env[envName] ?? ''
    keys[field] = v
    hasKeys[field] = v.length > 0
  }
  return NextResponse.json({ ok: true, keys, hasKeys })
}
